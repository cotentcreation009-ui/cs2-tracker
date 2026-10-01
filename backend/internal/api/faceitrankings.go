package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/cs2tracker/server/internal/cache"
	"github.com/cs2tracker/server/internal/faceit"
)

// GET /api/faceit/rankings?region=EU&limit=10 — the homepage's "Top FACEIT
// players" strip. FACEIT's published CS2 leaderboard for one region, enriched
// with each player's SteamID64 and avatar so a row can land on a CSRun profile.
//
// It costs FACEIT one rankings call per region per hour plus one identity
// lookup per player never seen before (identities are kept a week), and it
// costs Leetify nothing: this file never references s.leetify, and the test
// that pins it constructs the server with a nil Leetify client. The homepage
// used to spend five profile fetches on five hard-coded accounts per ISR
// regeneration — 2,076 Leetify requests in a day, 37% of the site's Leetify
// traffic — for a "featured" strip that was never top of anything.
//
// Caching is cachedStale: an hour fresh, a day stale. A FACEIT outage serves
// the last good board with stale=true and its real fetchedAt; only a gap with
// nothing to serve answers 503, and it answers no-store so neither Next nor
// Cloudflare can pin the absence. A ranking with zero legible rows is an
// error inside the fetch, never a fresh hour-long "empty" copy: a board that
// once existed is served stale over a blip to empty. A region with no board
// at all (AS, at the time of writing) is instead remembered as empty for ten
// minutes under the fresh key alone and served as the empty list the strip
// hides a pill for — six rankings calls an hour rather than one per homepage
// regeneration, and an Info line per miss rather than a Warn that reads like
// an outage.
//
// The route sits behind a 30 s timeout. The FACEIT client retries a transient
// failure three times on a 10 s timeout each, so a FACEIT that hangs rather
// than fails would run past that deadline with the stale twin still unread;
// the snapshot fetch is therefore budgeted (faceitTopRankingsBudget,
// faceitTopEnrichBudget) so a hang ends in the stale copy, or the 503, with
// time to spare.

const (
	// One FACEIT page per region: the pro board shows twenty, the homepage
	// ten, and both come out of the same snapshot.
	faceitTopRows     = 20
	faceitTopMaxLimit = 20
	// The leaderboard shifts continuously but nobody needs it to the minute;
	// an hour keeps a region with a board at one rankings call an hour.
	faceitTopFreshTTL = time.Hour
	faceitTopStaleTTL = 24 * time.Hour
	// A region FACEIT answers with no rows is remembered as empty this long,
	// the way a 404 identity is remembered below: long enough that an empty
	// region costs six calls an hour, short enough that one filling in shows
	// within minutes. Never the fresh hour — a blip to empty must not hide a
	// board for long — and never written to the stale twin.
	faceitTopEmptyTTL = 10 * time.Minute
	// A FACEIT id's Steam identity does not change; a week is a compromise
	// between re-asking and a renamed avatar lagging.
	faceitPlayerTTL     = 7 * 24 * time.Hour
	faceitPlayerMissTTL = 24 * time.Hour
	// How many identity lookups run at once. The FACEIT client paces itself
	// (4 in flight, 90 ms apart), so this only bounds our own goroutines.
	faceitEnrichWorkers = 4
)

// The two halves of the snapshot fetch, each bounded so the whole of it ends
// well inside the route's 30 s with the stale twin still readable afterwards:
// left to the client, a hang is three attempts on a 10 s timeout plus backoff,
// which is longer than the route has. Each budget covers the client's pacing
// wait as well as the request. Variables so a test can shorten them — proving
// that a hang ends in the stale copy must not take eight seconds a run.
var (
	faceitTopRankingsBudget = 8 * time.Second
	faceitTopEnrichBudget   = 12 * time.Second
)

var errEmptyRanking = errors.New("faceit rankings: no legible rows")

// faceitTopSnapshot is what the cache holds per region. FetchedAt is the
// moment FACEIT was ASKED, not when the response was written: a stale copy
// must be able to say how old it really is.
type faceitTopSnapshot struct {
	Region    string                `json:"region"`
	Rows      []faceit.RankedPlayer `json:"rows"`
	FetchedAt time.Time             `json:"fetchedAt"`
}

// faceitPlayerEntry is the per-player identity cache entry. Miss marks an id
// FACEIT answered 404 for, kept a day so the next refresh does not re-ask.
type faceitPlayerEntry struct {
	Identity *faceit.PlayerIdentity `json:"identity,omitempty"`
	Miss     bool                   `json:"miss,omitempty"`
}

func (s *Server) handleFaceitRankings(w http.ResponseWriter, r *http.Request) {
	region, ok := faceit.RegionCode(r.URL.Query().Get("region"))
	if !ok {
		writeError(w, http.StatusBadRequest, "unknown region")
		return
	}
	limit := clampInt(queryInt(r, "limit", 10), 1, faceitTopMaxLimit)
	if s.faceit == nil || !s.faceit.HasKey() {
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, map[string]any{
			"enabled": false, "region": region, "players": []faceit.RankedPlayer{},
		})
		return
	}

	ctx := r.Context()
	key := cache.FaceitTopKey(region)
	snap, stale, err := cachedStale(s.kv(), &s.sf, ctx, key,
		faceitTopFreshTTL, faceitTopStaleTTL, s.log,
		func() (faceitTopSnapshot, error) {
			asked := time.Now().UTC()
			rctx, cancelRankings := context.WithTimeout(ctx, faceitTopRankingsBudget)
			defer cancelRankings()
			rows, err := s.faceit.Rankings(rctx, region, faceitTopRows)
			if err != nil {
				return faceitTopSnapshot{}, err
			}
			if len(rows) == 0 {
				return faceitTopSnapshot{}, errEmptyRanking
			}
			ectx, cancelEnrich := context.WithTimeout(ctx, faceitTopEnrichBudget)
			defer cancelEnrich()
			s.enrichRanked(ectx, rows)
			return faceitTopSnapshot{Region: region, Rows: rows, FetchedAt: asked}, nil
		})
	switch {
	case err == nil:
	case errors.Is(err, errEmptyRanking):
		// FACEIT answered and nobody is ranked there, and cachedStale found
		// no earlier board to serve instead. That is an answer, not an
		// outage: remember it briefly under the fresh key — the stale twin,
		// should a real board ever be written, stays that board — and serve
		// the empty list the strip hides a pill for. Info, once per miss: a
		// quiet region is not a broken one.
		snap = faceitTopSnapshot{Region: region, Rows: []faceit.RankedPlayer{}, FetchedAt: time.Now().UTC()}
		if kv := s.kv(); kv != nil {
			_ = kv.SetJSONTTL(ctx, key, snap, faceitTopEmptyTTL)
		}
		s.log.Info("faceit rankings: empty region", "region", region, "rememberedFor", faceitTopEmptyTTL)
	default:
		s.log.Warn("faceit rankings: unavailable", "region", region, "err", err)
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Retry-After", "300")
		writeError(w, http.StatusServiceUnavailable, "FACEIT's leaderboard is unavailable right now")
		return
	}

	rows := snap.Rows
	if len(rows) > limit {
		rows = rows[:limit]
	}
	if rows == nil {
		rows = []faceit.RankedPlayer{}
	}
	// A stale answer is still an answer, but a short edge life so a recovered
	// FACEIT shows through within the minute rather than five; the same for
	// an empty region, so one that fills in is not hidden five minutes longer.
	if stale || len(rows) == 0 {
		setEdgeCache(w, time.Minute)
	} else {
		setEdgeCache(w, 5*time.Minute)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled":   true,
		"region":    region,
		"players":   rows,
		"fetchedAt": snap.FetchedAt.Format(time.RFC3339),
		"stale":     stale,
	})
}

// enrichRanked fills each row's SteamID64 and avatar from FACEIT's player
// object, through the per-player identity cache. Called only inside the
// snapshot fetch — once per region per hour, never on a cache hit — so a
// cold start costs at most a hundred paced calls across the five regions and
// about none afterwards. Any failure leaves that row as the leaderboard gave
// it; a row is never dropped for lacking a Steam account.
func (s *Server) enrichRanked(ctx context.Context, rows []faceit.RankedPlayer) {
	if s.faceit == nil || len(rows) == 0 {
		return
	}
	var wg sync.WaitGroup
	sem := make(chan struct{}, faceitEnrichWorkers)
	var mu sync.Mutex
	resolved := 0
	for i := range rows {
		if rows[i].PlayerID == "" {
			continue
		}
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			id := s.faceitIdentity(ctx, rows[i].PlayerID)
			if id == nil {
				return
			}
			mu.Lock()
			defer mu.Unlock()
			if rows[i].SteamID64 == "" && id.SteamID64 > 0 {
				rows[i].SteamID64 = strconv.FormatUint(id.SteamID64, 10)
			}
			if rows[i].Avatar == "" && id.Avatar != "" {
				rows[i].Avatar = id.Avatar
			}
			if id.SteamID64 > 0 || id.Avatar != "" {
				resolved++
			}
		}(i)
	}
	wg.Wait()
	if resolved == 0 {
		// Same caveat rankings.go carries: /players/{id} has not been read
		// against the live API from a dev box. If every lookup comes back
		// without a Steam id or an avatar, the field names are the first
		// suspect, and a quietly link-less strip looks exactly like a quiet
		// region.
		s.log.Warn("faceit rankings: enrichment resolved nothing",
			"rows", len(rows), "expect", "games.cs2.game_player_id or steam_id_64, avatar")
	}
}

// faceitIdentity is one player's identity through the week-long cache: a
// cached identity or miss answers without a request; otherwise FACEIT is
// asked once and the answer (or its 404) is remembered. nil when unknown.
func (s *Server) faceitIdentity(ctx context.Context, playerID string) *faceit.PlayerIdentity {
	key := cache.FaceitPlayerKey(playerID)
	if s.cache != nil {
		var e faceitPlayerEntry
		if hit, _ := s.cache.GetJSON(ctx, key, &e); hit {
			if e.Miss {
				return nil
			}
			return e.Identity
		}
	}
	id, err := s.faceit.PlayerByID(ctx, playerID)
	if errors.Is(err, faceit.ErrNotFound) {
		if s.cache != nil {
			_ = s.cache.SetJSONTTL(ctx, key, faceitPlayerEntry{Miss: true}, faceitPlayerMissTTL)
		}
		return nil
	}
	if err != nil {
		// Rate limit, outage, bad key: not remembered, so the next refresh
		// asks again. Debug, not Warn — twenty of these per blip is noise.
		s.log.Debug("faceit rankings: identity lookup failed", "playerId", playerID, "err", err)
		return nil
	}
	if s.cache != nil {
		_ = s.cache.SetJSONTTL(ctx, key, faceitPlayerEntry{Identity: id}, faceitPlayerTTL)
	}
	return id
}
