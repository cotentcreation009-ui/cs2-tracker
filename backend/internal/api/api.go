// Package api is the HTTP surface of the backend: player profiles, recent
// matches, match detail, vanity resolution, Steam refresh and demo ingest. It
// reads from Postgres (through db), uses Redis for a hot profile cache, talks to
// the Steam Web API for identity, and enqueues parse jobs rather than doing them
// on the request path.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/cs2tracker/server/internal/cache"
	"github.com/cs2tracker/server/internal/config"
	"github.com/cs2tracker/server/internal/db"
	"github.com/cs2tracker/server/internal/models"
	"github.com/cs2tracker/server/internal/queue"
	"github.com/cs2tracker/server/internal/steam"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

// Server holds the API dependencies.
type Server struct {
	cfg   *config.Config
	db    *db.DB
	steam *steam.Client
	queue *queue.Queue
	cache *cache.Cache
	log   *slog.Logger
}

// NewServer wires a Server. cache and queue may be nil (caching/ingest then
// degrade gracefully).
func NewServer(cfg *config.Config, database *db.DB, steamClient *steam.Client, q *queue.Queue, c *cache.Cache, log *slog.Logger) *Server {
	return &Server{cfg: cfg, db: database, steam: steamClient, queue: q, cache: c, log: log}
}

// Router builds the HTTP handler.
func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   s.cfg.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Content-Type"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Route("/api", func(r chi.Router) {
		r.Get("/health", s.handleHealth)
		r.Get("/resolve", s.handleResolve)
		r.Get("/leaderboard", s.handleLeaderboard)

		r.Route("/players/{steamid}", func(r chi.Router) {
			r.Get("/", s.handleProfile)
			r.Post("/refresh", s.handleRefresh)
			r.Get("/matches", s.handlePlayerMatches)
			r.Get("/weapons", s.handleWeapons)
			r.Get("/maps", s.handleMaps)
			r.Get("/steam-stats", s.handleSteamStats)
		})

		r.Get("/matches/{id}", s.handleMatch)
		r.Get("/matches/{id}/kills", s.handleMatchKills)
		r.Post("/ingest/demo", s.handleIngest)
		r.Get("/jobs/{id}", s.handleJob)
		r.Get("/queue", s.handleQueueDepth)
	})

	return r
}

// --- handlers ---------------------------------------------------------------

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	status := map[string]any{
		"status":      "ok",
		"steamApiKey": s.cfg.HasSteamKey(),
		"time":        time.Now().UTC(),
	}
	if s.queue != nil {
		if depth, err := s.queue.Depth(r.Context()); err == nil {
			status["queueDepth"] = depth
		}
	}
	writeJSON(w, http.StatusOK, status)
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
	writeJSON(w, http.StatusOK, map[string]any{"players": players})
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
			writeError(w, http.StatusNotFound, "player not tracked yet — ingest a demo or add a Steam API key to hydrate identity")
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
	writeJSON(w, http.StatusOK, map[string]any{"matches": matches, "limit": limit, "offset": offset})
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

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
