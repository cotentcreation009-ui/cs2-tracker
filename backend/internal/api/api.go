// Package api is the HTTP surface of the backend: player profiles, recent
// matches, match detail, vanity resolution, Steam refresh and demo ingest. It
// reads from Postgres (through db), uses Redis for a hot profile cache, talks to
// the Steam Web API for identity, and enqueues parse jobs rather than doing them
// on the request path.
package api

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/cs2tracker/server/internal/blob"
	"github.com/cs2tracker/server/internal/cache"
	"github.com/cs2tracker/server/internal/config"
	"github.com/cs2tracker/server/internal/db"
	"github.com/cs2tracker/server/internal/faceit"
	"github.com/cs2tracker/server/internal/leetify"
	"github.com/cs2tracker/server/internal/models"
	"github.com/cs2tracker/server/internal/queue"
	"github.com/cs2tracker/server/internal/steam"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"golang.org/x/sync/singleflight"
)

// Store is the persistence surface the HTTP handlers depend on. *db.DB satisfies
// it; depending on the interface (not the concrete type) lets the handlers be
// unit-tested with a fake, no Postgres required.
type Store interface {
	GetProfile(ctx context.Context, steamID uint64) (models.PlayerProfile, error)
	UpsertPlayer(ctx context.Context, p models.Player) error
	ListPlayerMatches(ctx context.Context, steamID uint64, limit, offset int) ([]models.PlayerMatchSummary, error)
	CountPlayerMatches(ctx context.Context, steamID uint64) (int, error)
	GetMatchDetail(ctx context.Context, matchID int64) (models.MatchDetail, error)
	GetWeaponStats(ctx context.Context, steamID uint64, limit int) ([]models.WeaponStat, error)
	GetMapStats(ctx context.Context, steamID uint64) ([]models.MapStat, error)
	ListTopPlayers(ctx context.Context, limit int) ([]models.LeaderboardEntry, error)
	SearchPlayers(ctx context.Context, query string, limit int) ([]models.PlayerHit, error)
	ListMatchKills(ctx context.Context, matchID int64) ([]models.Kill, error)
	InsertJob(ctx context.Context, j models.IngestJob) error
	GetJob(ctx context.Context, id string) (models.IngestJob, error)
	// Demo-analysis (user-uploaded replay) results.
	CreateDemoJob(ctx context.Context, id, clientIP, filename string, sizeBytes int64) error
	CreateDemoJobIfAbsent(ctx context.Context, id, clientIP string) (bool, error)
	SetDemoStatus(ctx context.Context, id, status, errMsg string) error
	GetDemoJob(ctx context.Context, id string) (db.DemoJobStatus, error)
	GetDemoData(ctx context.Context, id string) (data []byte, mapName string, err error)
	CountDemoJobsSince(ctx context.Context, t time.Time) (int, error)
	CountDemoJobsByIPSince(ctx context.Context, ip string, t time.Time) (int, error)
	Ping(ctx context.Context) error
}

// Server holds the API dependencies.
type Server struct {
	cfg     *config.Config
	db      Store
	steam   *steam.Client
	leetify *leetify.Client
	faceit  *faceit.Client
	queue   *queue.Queue
	cache   *cache.Cache
	blob    blob.Store // nil when direct (object-storage) upload is not configured
	log     *slog.Logger
	metrics *metrics
	// sf coalesces concurrent upstream fetches for the same key (cache stampede
	// protection) so a hot profile's TTL expiry triggers one fetch, not N.
	sf singleflight.Group
}

// negativeCacheTTL is how long a "no such profile" result is cached so repeated
// views of profile-less players don't keep hitting the upstream.
const negativeCacheTTL = 5 * time.Minute

// staleCacheTTL is how long a last-known-good copy is retained to serve when the
// upstream is failing (stale-on-error), well beyond the fresh TTL.
const staleCacheTTL = 24 * time.Hour

// NewServer wires a Server. cache and queue may be nil (caching/ingest then
// degrade gracefully); leetify/faceit clients may be nil or keyless (their
// panels are simply hidden).
func NewServer(cfg *config.Config, store Store, steamClient *steam.Client, leetifyClient *leetify.Client, faceitClient *faceit.Client, q *queue.Queue, c *cache.Cache, log *slog.Logger) *Server {
	return &Server{cfg: cfg, db: store, steam: steamClient, leetify: leetifyClient, faceit: faceitClient, queue: q, cache: c, log: log, metrics: &metrics{}}
}

// SetBlob attaches an object-storage backend, enabling browser-direct demo
// uploads. With no blob store set, the demo flow falls back to multipart upload.
func (s *Server) SetBlob(b blob.Store) { s.blob = b }

// Router builds the HTTP handler.
func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(s.requestLogger)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   s.cfg.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Content-Type", "X-Internal-Token"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	// When the backend is exposed on a public host (Fly.io), gate every route
	// except /api/health behind a shared secret so only the trusted frontend can
	// reach it — this is the access control, so the per-IP rate limiter (which is
	// spoofable via X-Forwarded-For on a directly-reachable origin, and would
	// otherwise throttle the single frontend egress) is skipped while it is on.
	gated := s.cfg.InternalAPISecret != ""

	// Prometheus metrics + the OpenAPI spec (gated when a secret is set).
	r.Group(func(r chi.Router) {
		if gated {
			r.Use(s.internalAuth)
		}
		r.Get("/metrics", s.handleMetrics)
		r.Get("/openapi.yaml", s.handleOpenAPI)
	})

	r.Route("/api", func(r chi.Router) {
		// Demo analysis: reached via the same-origin Next proxy (which adds the
		// internal token and forwards the real client IP), so it stays behind the
		// gate like everything else. It only differs in needing a long timeout for
		// large uploads; per-IP/global quota lives in the handlers. Results are
		// scoped to the uploader's private library and never feed shared stats.
		r.Group(func(r chi.Router) {
			r.Use(middleware.Timeout(15 * time.Minute))
			if gated {
				r.Use(s.internalAuth)
			}
			// Direct (object-storage) upload: sign a URL, then enqueue once the
			// browser has PUT the demo straight to the bucket. Falls back to the
			// through-server multipart path when GCS is not configured.
			r.Post("/demos/presign", s.handleDemoPresign)
			r.Post("/demos/parse", s.handleDemoParse)
			r.Post("/demos/upload", s.handleDemoUpload)
			r.Post("/demos/from-url", s.handleDemoFromURL)
			r.Post("/demos/analyze-match", s.handleDemoAnalyzeMatch)
			r.Get("/demos/{id}", s.handleDemoJob)
			r.Get("/demos/{id}/data", s.handleDemoData)
			r.Post("/ai/analyze", s.handleAiAnalyze)
		})

		// Everything else: 30s timeout, gated behind the internal token.
		r.Group(func(r chi.Router) {
			r.Use(middleware.Timeout(30 * time.Second))
			if gated {
				r.Use(s.internalAuth)
			}
			if s.cfg.RateLimitRPS > 0 && !gated {
				r.Use(newRateLimiter(s.cfg.RateLimitRPS, s.cfg.RateLimitBurst).middleware)
			}
			r.Get("/health", s.handleHealth)
			r.Get("/resolve", s.handleResolve)
			r.Get("/faceit/resolve", s.handleFaceitResolve)
			r.Get("/leaderboard", s.handleLeaderboard)
			r.Get("/search", s.handleSearch)

			r.Route("/players/{steamid}", func(r chi.Router) {
				r.Get("/", s.handleProfile)
				r.Post("/refresh", s.handleRefresh)
				r.Get("/matches", s.handlePlayerMatches)
				r.Get("/weapons", s.handleWeapons)
				r.Get("/maps", s.handleMaps)
				r.Get("/leetify", s.handleLeetify)
				r.Get("/teammates", s.handleLeetifyTeammates)
				r.Get("/faceit", s.handleFaceit)
				r.Get("/steam-stats", s.handleSteamStats)
				r.Get("/steam-extras", s.handleSteamExtras)
			})

			r.Get("/matches/{id}", s.handleMatch)
			r.Get("/matches/{id}/kills", s.handleMatchKills)
		})
	})

	return r
}

// internalAuth gates the API behind InternalAPISecret. /api/health is exempt so
// platform health checks (which can't easily send a custom header) still work.
func (s *Server) internalAuth(next http.Handler) http.Handler {
	secret := []byte(s.cfg.InternalAPISecret)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/health" {
			next.ServeHTTP(w, r)
			return
		}
		got := []byte(r.Header.Get("X-Internal-Token"))
		if subtle.ConstantTimeCompare(got, secret) != 1 {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// --- handlers ---------------------------------------------------------------

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	// Public readiness probe (exempt from the internal-auth gate so platform
	// health checks work). A healthy API must be able to reach Postgres. The
	// payload is deliberately minimal — no key/DB/queue posture is leaked.
	code := http.StatusOK
	overall := "ok"
	if s.db != nil {
		if err := s.db.Ping(r.Context()); err != nil {
			code = http.StatusServiceUnavailable
			overall = "degraded"
		}
	}
	writeJSON(w, code, map[string]any{"status": overall, "time": time.Now().UTC()})
}

// handleResolve maps a vanity name or raw SteamID64 to a SteamID64.
func (s *Server) handleResolve(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		q = r.URL.Query().Get("vanity")
	}
	if q == "" {
		writeError(w, http.StatusBadRequest, "missing 'q' (vanity name or SteamID64)")
		return
	}
	id, err := s.steam.ResolveSteamID(r.Context(), q)
	if errors.Is(err, steam.ErrNoAPIKey) {
		writeError(w, http.StatusServiceUnavailable, "vanity resolution needs a Steam API key; pass a SteamID64 instead")
		return
	}
	if errors.Is(err, steam.ErrNotFound) {
		writeError(w, http.StatusNotFound, "could not resolve that name")
		return
	}
	if err != nil {
		s.serverError(w, "resolve", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"steamId64": strconv.FormatUint(id, 10)})
}

func (s *Server) handleLeaderboard(w http.ResponseWriter, r *http.Request) {
	limit := clampInt(queryInt(r, "limit", 25), 1, 100)
	players, err := s.db.ListTopPlayers(r.Context(), limit)
	if err != nil {
		s.serverError(w, "leaderboard", err)
		return
	}
	if players == nil {
		players = []models.LeaderboardEntry{}
	}
	setEdgeCache(w, s.cfg.CacheTTL)
	writeJSON(w, http.StatusOK, map[string]any{"players": players})
}

// handleSearch returns known players whose name/vanity matches a query, for
// search autocomplete. Requires >=2 chars; returns an empty list otherwise.
func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(q) < 2 {
		writeJSON(w, http.StatusOK, map[string]any{"players": []models.PlayerHit{}})
		return
	}
	limit := clampInt(queryInt(r, "limit", 8), 1, 20)
	hits, err := s.db.SearchPlayers(r.Context(), q, limit)
	if err != nil {
		s.serverError(w, "search", err)
		return
	}
	if hits == nil {
		hits = []models.PlayerHit{}
	}
	setEdgeCache(w, s.cfg.CacheTTL)
	writeJSON(w, http.StatusOK, map[string]any{"players": hits})
}

func (s *Server) handleProfile(w http.ResponseWriter, r *http.Request) {
	id, ok := steamIDParam(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid SteamID64")
		return
	}

	// Hot path: serve from cache.
	if s.cache != nil {
		var cached models.PlayerProfile
		if hit, _ := s.cache.GetJSON(r.Context(), cache.ProfileKey(id), &cached); hit {
			setEdgeCache(w, s.cfg.CacheTTL)
			writeJSON(w, http.StatusOK, cached)
			return
		}
	}

	prof, err := s.db.GetProfile(r.Context(), id)
	if errors.Is(err, db.ErrNotFound) {
		// We have never seen this player. Try to hydrate identity from Steam so
		// the profile page still works the first time it is visited.
		hydrated, herr := s.hydrateFromSteam(r.Context(), id)
		if herr != nil {
			writeError(w, http.StatusNotFound, "player not found")
			return
		}
		prof = hydrated
	} else if err != nil {
		s.serverError(w, "get profile", err)
		return
	}

	if s.cache != nil {
		_ = s.cache.SetJSON(r.Context(), cache.ProfileKey(id), prof)
	}
	setEdgeCache(w, s.cfg.CacheTTL)
	writeJSON(w, http.StatusOK, prof)
}

func (s *Server) handleRefresh(w http.ResponseWriter, r *http.Request) {
	id, ok := steamIDParam(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid SteamID64")
		return
	}
	if !s.steam.HasKey() {
		writeError(w, http.StatusServiceUnavailable, "Steam API key not configured")
		return
	}
	prof, err := s.hydrateFromSteam(r.Context(), id)
	if errors.Is(err, steam.ErrNotFound) {
		writeError(w, http.StatusNotFound, "Steam profile not found or private")
		return
	}
	if err != nil {
		s.serverError(w, "refresh", err)
		return
	}
	if s.cache != nil {
		_ = s.cache.Delete(r.Context(), cache.ProfileKey(id))
	}
	writeJSON(w, http.StatusOK, prof)
}

func (s *Server) handleSteamStats(w http.ResponseWriter, r *http.Request) {
	id, ok := steamIDParam(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid SteamID64")
		return
	}
	if !s.steam.HasKey() {
		writeError(w, http.StatusServiceUnavailable, "Steam API key not configured")
		return
	}
	gs, err := s.steam.GetUserStatsForGame(r.Context(), steam.AppIDCS2, id)
	if errors.Is(err, steam.ErrNotFound) {
		writeError(w, http.StatusNotFound, "no CS2 stats (profile private or never played)")
		return
	}
	if err != nil {
		s.serverError(w, "steam stats", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"steamId64": strconv.FormatUint(id, 10),
		"gameName":  gs.GameName,
		"stats":     gs.Stats,
	})
}

// handleSteamExtras returns the CS2 friend code (deterministic from the id, no
// key needed) plus best-effort friends count and Steam level (require a key and
// a public profile/friends list; 0 otherwise).
func (s *Server) handleSteamExtras(w http.ResponseWriter, r *http.Request) {
	id, ok := steamIDParam(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid SteamID64")
		return
	}
	out, _, err := cachedExternal(s, r.Context(), cache.SteamExtrasKey(id),
		func() (map[string]any, error) {
			o := map[string]any{
				"steamId64":        strconv.FormatUint(id, 10),
				"friendCode":       steam.FriendCode(id),
				"friends":          0,
				"steamLevel":       0,
				"personaState":     -1, // -1 = unknown; 0 = offline, >0 = online/away/busy
				"visibility":       0,  // 0 = unknown; 1 = private, 3 = public
				"vacBanned":        false,
				"numberOfVacBans":  0,
				"numberOfGameBans": 0,
				"daysSinceLastBan": 0,
				"economyBan":       "none",
			}
			if s.steam.HasKey() {
				// Independent calls — run them concurrently (write to locals to
				// avoid a concurrent map write, then assign).
				var wg sync.WaitGroup
				var friends, level int
				var personaState, visibility = -1, 0
				var bans steam.PlayerBans
				wg.Add(4)
				go func() {
					defer wg.Done()
					if n, e := s.steam.GetFriendCount(r.Context(), id); e == nil {
						friends = n
					}
				}()
				go func() {
					defer wg.Done()
					if lvl, e := s.steam.GetSteamLevel(r.Context(), id); e == nil {
						level = lvl
					}
				}()
				go func() {
					defer wg.Done()
					if sums, e := s.steam.GetPlayerSummaries(r.Context(), id); e == nil && len(sums) > 0 {
						personaState = sums[0].PersonaState
						visibility = sums[0].CommunityVisibilityState
					}
				}()
				go func() {
					defer wg.Done()
					if b, e := s.steam.GetPlayerBans(r.Context(), id); e == nil {
						bans = b
					}
				}()
				wg.Wait()
				o["friends"] = friends
				o["steamLevel"] = level
				o["personaState"] = personaState
				o["visibility"] = visibility
				o["vacBanned"] = bans.VACBanned
				o["numberOfVacBans"] = bans.NumberOfVACBans
				o["numberOfGameBans"] = bans.NumberOfGameBans
				o["daysSinceLastBan"] = bans.DaysSinceLastBan
				o["economyBan"] = bans.EconomyBan
			}
			return o, nil
		})
	if err != nil {
		s.serverError(w, "steam extras", err)
		return
	}
	setEdgeCache(w, s.cfg.ExternalCacheTTL)
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handlePlayerMatches(w http.ResponseWriter, r *http.Request) {
	id, ok := steamIDParam(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid SteamID64")
		return
	}
	limit := clampInt(queryInt(r, "limit", 20), 1, 100)
	offset := clampInt(queryInt(r, "offset", 0), 0, 1_000_000)

	matches, err := s.db.ListPlayerMatches(r.Context(), id, limit, offset)
	if err != nil {
		s.serverError(w, "player matches", err)
		return
	}
	if matches == nil {
		matches = []models.PlayerMatchSummary{}
	}
	total, cerr := s.db.CountPlayerMatches(r.Context(), id)
	if cerr != nil {
		total = len(matches) + offset // best-effort fallback
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"matches": matches, "limit": limit, "offset": offset, "total": total,
	})
}

func (s *Server) handleWeapons(w http.ResponseWriter, r *http.Request) {
	id, ok := steamIDParam(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid SteamID64")
		return
	}
	limit := clampInt(queryInt(r, "limit", 12), 1, 50)
	weapons, err := s.db.GetWeaponStats(r.Context(), id, limit)
	if err != nil {
		s.serverError(w, "weapon stats", err)
		return
	}
	if weapons == nil {
		weapons = []models.WeaponStat{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"weapons": weapons})
}

// handleLeetify fetches a player's Leetify profile, shown live with attribution.
// A short Redis cache (ExternalCacheTTL) coalesces repeat views so we don't
// re-hit Leetify on every request — important under load. NOTE: confirm a short
// transient cache is compatible with Leetify's terms before commercial use.
func (s *Server) handleLeetify(w http.ResponseWriter, r *http.Request) {
	id, ok := steamIDParam(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid SteamID64")
		return
	}
	if s.leetify == nil {
		writeError(w, http.StatusServiceUnavailable, "leetify integration not configured")
		return
	}
	prof, notFound, err := cachedExternal(s, r.Context(), cache.LeetifyKey(id),
		func() (*leetify.Profile, error) { return s.leetify.GetProfile(r.Context(), id) })
	if notFound {
		writeError(w, http.StatusNotFound, "no Leetify profile for this player")
		return
	}
	if err != nil {
		s.serverError(w, "leetify profile", err)
		return
	}
	setEdgeCache(w, s.cfg.ExternalCacheTTL)
	writeJSON(w, http.StatusOK, prof)
}

// handleLeetifyTeammates resolves the player's frequent recent teammates
// (Leetify v3's recent_teammates, <=5 ids) into ranked rows: name, winrate,
// average Leetify rating over their recent matches, and K/D when the legacy
// enrichment provides it. Every per-friend profile fetch rides the same cache
// as the profile page, so a warm view costs zero upstream calls.
func (s *Server) handleLeetifyTeammates(w http.ResponseWriter, r *http.Request) {
	id, ok := steamIDParam(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid SteamID64")
		return
	}
	if s.leetify == nil {
		writeError(w, http.StatusServiceUnavailable, "leetify integration not configured")
		return
	}
	prof, notFound, err := cachedExternal(s, r.Context(), cache.LeetifyKey(id),
		func() (*leetify.Profile, error) { return s.leetify.GetProfile(r.Context(), id) })
	if notFound || err != nil || prof == nil {
		if err != nil && !notFound {
			s.serverError(w, "leetify profile", err)
			return
		}
		setEdgeCache(w, s.cfg.ExternalCacheTTL)
		writeJSON(w, http.StatusOK, map[string]any{"teammates": []any{}})
		return
	}

	type row struct {
		Steam64ID       string  `json:"steam64_id"`
		Name            string  `json:"name"`
		MatchesTogether int      `json:"matches_together"`
		Winrate         float64  `json:"winrate"`
		Rating          *float64 `json:"rating"` // overall Leetify rating; null = unknown (can be negative)
		KD              float64  `json:"kd,omitempty"`
		TotalMatches    int      `json:"total_matches"`
	}
	rows := make([]*row, len(prof.RecentTeammates))
	var wg sync.WaitGroup
	for i, tm := range prof.RecentTeammates {
		fid, perr := strconv.ParseUint(tm.Steam64ID, 10, 64)
		if perr != nil {
			continue
		}
		wg.Add(1)
		go func(i int, tm leetify.RecentTeammate, fid uint64) {
			defer wg.Done()
			fr := &row{Steam64ID: tm.Steam64ID, MatchesTogether: tm.RecentMatchesCount}
			fp, fnf, ferr := cachedExternal(s, r.Context(), cache.LeetifyKey(fid),
				func() (*leetify.Profile, error) { return s.leetify.GetProfile(r.Context(), fid) })
			if ferr == nil && !fnf && fp != nil {
				fr.Name = fp.Name
				fr.Winrate = fp.Winrate
				fr.KD = fp.KD
				fr.TotalMatches = fp.TotalMatches
				// Rating = the OVERALL Leetify rating (ranks.leetify — the same
				// scale the profile page / CheatMeter show), not the per-match
				// rating delta (which averages to a near-zero, unrecognizable
				// number). ranks.leetify can be negative (below-average
				// players), so key off PRESENCE, not sign. Fall back to the
				// ×100 per-match average only when ranks.leetify is absent/null.
				var rkm map[string]json.RawMessage
				if len(fp.Ranks) > 0 {
					_ = json.Unmarshal(fp.Ranks, &rkm)
				}
				if raw, ok := rkm["leetify"]; ok && string(raw) != "null" {
					var v float64
					if json.Unmarshal(raw, &v) == nil {
						fr.Rating = &v
					}
				}
				if fr.Rating == nil {
					if n := len(fp.RecentMatches); n > 0 {
						sum := 0.0
						for _, m := range fp.RecentMatches {
							sum += m.LeetifyRating
						}
						v := (sum / float64(n)) * 100
						fr.Rating = &v
					}
				}
			}
			rows[i] = fr
		}(i, tm, fid)
	}
	wg.Wait()
	out := make([]*row, 0, len(rows))
	for _, fr := range rows {
		if fr != nil {
			out = append(out, fr)
		}
	}
	setEdgeCache(w, s.cfg.ExternalCacheTTL)
	writeJSON(w, http.StatusOK, map[string]any{"teammates": out})
}

// handleFaceit fetches a player's live FACEIT profile (CS2 skill level, elo and
// lifetime stats). Like Leetify it is fetched real-time and never stored; the
// FaceitPanel renders it with attribution. Needs FACEIT_API_KEY.
func (s *Server) handleFaceit(w http.ResponseWriter, r *http.Request) {
	id, ok := steamIDParam(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid SteamID64")
		return
	}
	if s.faceit == nil || !s.faceit.HasKey() {
		writeError(w, http.StatusServiceUnavailable, "faceit integration not configured (set FACEIT_API_KEY)")
		return
	}
	prof, notFound, err := cachedExternal(s, r.Context(), cache.FaceitKey(id),
		func() (*faceit.Profile, error) { return s.faceit.GetProfile(r.Context(), id) })
	if notFound {
		writeError(w, http.StatusNotFound, "no FACEIT profile for this player")
		return
	}
	if err != nil {
		s.serverError(w, "faceit profile", err)
		return
	}
	setEdgeCache(w, s.cfg.ExternalCacheTTL)
	writeJSON(w, http.StatusOK, prof)
}

// handleFaceitResolve maps a FACEIT nickname to its SteamID64 — the browser
// extension uses it to turn a match-room player into a StatRun profile lookup.
func (s *Server) handleFaceitResolve(w http.ResponseWriter, r *http.Request) {
	nick := strings.TrimSpace(r.URL.Query().Get("nickname"))
	if nick == "" {
		writeError(w, http.StatusBadRequest, "missing 'nickname'")
		return
	}
	if s.faceit == nil || !s.faceit.HasKey() {
		writeError(w, http.StatusServiceUnavailable, "faceit integration not configured (set FACEIT_API_KEY)")
		return
	}
	id, err := s.faceit.ResolveNickname(r.Context(), nick)
	if errors.Is(err, faceit.ErrNotFound) || errors.Is(err, faceit.ErrNoAPIKey) {
		writeError(w, http.StatusNotFound, "no CS2 SteamID for that FACEIT nickname")
		return
	}
	if err != nil {
		s.serverError(w, "faceit resolve", err)
		return
	}
	setEdgeCache(w, s.cfg.ExternalCacheTTL)
	writeJSON(w, http.StatusOK, map[string]string{"steamId64": strconv.FormatUint(id, 10)})
}

func (s *Server) handleMaps(w http.ResponseWriter, r *http.Request) {
	id, ok := steamIDParam(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid SteamID64")
		return
	}
	maps, err := s.db.GetMapStats(r.Context(), id)
	if err != nil {
		s.serverError(w, "map stats", err)
		return
	}
	if maps == nil {
		maps = []models.MapStat{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"maps": maps})
}

func (s *Server) handleMatchKills(w http.ResponseWriter, r *http.Request) {
	mid, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid match id")
		return
	}
	kills, err := s.db.ListMatchKills(r.Context(), mid)
	if err != nil {
		s.serverError(w, "match kills", err)
		return
	}
	if kills == nil {
		kills = []models.Kill{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"kills": kills})
}

func (s *Server) handleMatch(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	mid, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid match id")
		return
	}
	detail, err := s.db.GetMatchDetail(r.Context(), mid)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, "match not found")
		return
	}
	if err != nil {
		s.serverError(w, "match detail", err)
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

type ingestRequest struct {
	DemoPath  string `json:"demoPath"`
	DemoURL   string `json:"demoUrl"`
	ShareCode string `json:"shareCode"`
	Source    string `json:"source"`
}

func (s *Server) handleIngest(w http.ResponseWriter, r *http.Request) {
	if s.queue == nil {
		writeError(w, http.StatusServiceUnavailable, "queue not configured")
		return
	}
	var req ingestRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.DemoPath == "" && req.DemoURL == "" && req.ShareCode == "" {
		writeError(w, http.StatusBadRequest, "provide one of demoPath, demoUrl or shareCode")
		return
	}
	source := req.Source
	if source == "" {
		source = "local"
	}
	job, err := s.queue.Enqueue(r.Context(), queue.Job{
		Type:      queue.JobParseDemo,
		Source:    source,
		DemoPath:  req.DemoPath,
		DemoURL:   req.DemoURL,
		ShareCode: req.ShareCode,
	})
	if err != nil {
		s.serverError(w, "enqueue", err)
		return
	}

	// Record the job so the caller can poll its status. Tracking is best-effort:
	// a failed insert must not lose the already-queued work.
	if err := s.db.InsertJob(r.Context(), models.IngestJob{
		ID:        job.ID,
		Type:      string(job.Type),
		Status:    models.JobQueued,
		Source:    source,
		DemoPath:  req.DemoPath,
		DemoURL:   req.DemoURL,
		ShareCode: req.ShareCode,
	}); err != nil {
		s.log.Warn("could not record job", "jobId", job.ID, "err", err)
	}

	writeJSON(w, http.StatusAccepted, map[string]string{
		"jobId":     job.ID,
		"status":    models.JobQueued,
		"statusUrl": "/api/jobs/" + job.ID,
	})
}

func (s *Server) handleJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	job, err := s.db.GetJob(r.Context(), id)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}
	if err != nil {
		s.serverError(w, "get job", err)
		return
	}
	writeJSON(w, http.StatusOK, job)
}

func (s *Server) handleQueueDepth(w http.ResponseWriter, r *http.Request) {
	if s.queue == nil {
		writeError(w, http.StatusServiceUnavailable, "queue not configured")
		return
	}
	depth, err := s.queue.Depth(r.Context())
	if err != nil {
		s.serverError(w, "queue depth", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"depth": depth})
}

// --- helpers ----------------------------------------------------------------

// hydrateFromSteam fetches identity from the Steam Web API, upserts it, and
// returns the (possibly empty-career) profile.
func (s *Server) hydrateFromSteam(ctx context.Context, id uint64) (models.PlayerProfile, error) {
	summaries, err := s.steam.GetPlayerSummaries(ctx, id)
	if err != nil {
		return models.PlayerProfile{}, err
	}
	if len(summaries) == 0 {
		return models.PlayerProfile{}, steam.ErrNotFound
	}
	su := summaries[0]
	player := models.Player{
		SteamID64:   su.SteamID,
		PersonaName: su.PersonaName,
		AvatarURL:   su.AvatarFull,
		ProfileURL:  su.ProfileURL,
		CountryCode: su.LocCountryCode,
	}
	// timecreated is only present for public profiles.
	if !su.TimeCreated.IsZero() {
		t := su.TimeCreated
		player.SteamCreatedAt = &t
	}
	if err := s.db.UpsertPlayer(ctx, player); err != nil {
		return models.PlayerProfile{}, err
	}
	return s.db.GetProfile(ctx, id)
}

func (s *Server) serverError(w http.ResponseWriter, op string, err error) {
	s.log.Error("api error", "op", op, "err", err)
	writeError(w, http.StatusInternalServerError, "internal error")
}

func steamIDParam(r *http.Request) (uint64, bool) {
	return steam.ParseSteamID64(chi.URLParam(r, "steamid"))
}

func queryInt(r *http.Request, key string, def int) int {
	v := r.URL.Query().Get(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// cachedExternal serves a live third-party payload with Redis caching, negative
// caching, singleflight coalescing and stale-on-error. Order: positive cache hit
// → negative cache hit (returns notFound) → one upstream fetch per key (shared by
// all concurrent callers). On success it writes both a fresh copy (ExternalCacheTTL)
// and a long-lived "stale" copy; ErrNotFound is cached briefly as negative; any
// other upstream failure falls back to the last-known-good stale copy so a slow/
// down provider degrades to minutes-old data rather than a missing panel.
func cachedExternal[T any](s *Server, ctx context.Context, key string, fetch func() (T, error)) (T, bool, error) {
	var zero T
	missKey := key + ":miss"
	staleKey := key + ":stale"
	if s.cache != nil {
		var cached T
		if hit, _ := s.cache.GetJSON(ctx, key, &cached); hit {
			return cached, false, nil
		}
		var miss bool
		if hit, _ := s.cache.GetJSON(ctx, missKey, &miss); hit && miss {
			return zero, true, nil
		}
	}

	v, err, _ := s.sf.Do(key, func() (any, error) {
		val, err := fetch()
		if err != nil {
			return nil, err
		}
		if s.cache != nil {
			_ = s.cache.SetJSONTTL(ctx, key, val, s.cfg.ExternalCacheTTL)
			_ = s.cache.SetJSONTTL(ctx, staleKey, val, staleCacheTTL)
		}
		return val, nil
	})
	if err != nil {
		if errors.Is(err, leetify.ErrNotFound) || errors.Is(err, faceit.ErrNotFound) {
			if s.cache != nil {
				_ = s.cache.SetJSONTTL(ctx, missKey, true, negativeCacheTTL)
			}
			return zero, true, nil
		}
		// Upstream slow/down: fall back to the last-known-good copy if we have one.
		if s.cache != nil {
			var stale T
			if hit, _ := s.cache.GetJSON(ctx, staleKey, &stale); hit {
				s.log.Warn("serving stale upstream data", "key", key, "err", err)
				return stale, false, nil
			}
		}
		return zero, false, err
	}
	return v.(T), false, nil
}

// setEdgeCache marks a successful read cacheable by a CDN (Cloudflare) for ttl,
// with stale-while-revalidate so repeat traffic is absorbed at the edge instead
// of hitting the origin. Must be called before WriteHeader (i.e. before writeJSON).
func setEdgeCache(w http.ResponseWriter, ttl time.Duration) {
	secs := strconv.Itoa(int(ttl.Seconds()))
	w.Header().Set("Cache-Control", "public, max-age=0, s-maxage="+secs+", stale-while-revalidate=60")
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
