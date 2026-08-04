package api

import (
	"net/http"
	"regexp"
	"time"

	"github.com/cs2tracker/server/internal/cache"
	"github.com/cs2tracker/server/internal/leetify"
	"github.com/go-chi/chi/v5"
)

// Leetify game ids are UUIDs; accept nothing broader before building a URL.
var gameIDRe = regexp.MustCompile(`^[0-9a-fA-F-]{8,40}$`)

// handleLeetifyGameStats serves one player's deep scoreboard line (ADR, KAST,
// HLTV-style rating, assists, MVPs, multi-kills) for one Leetify game —
// fetched on demand when a match row expands. A finished game never changes,
// so hits cache for a week; misses briefly, so typos and delisted games don't
// hammer upstream.
func (s *Server) handleLeetifyGameStats(w http.ResponseWriter, r *http.Request) {
	id, ok := steamIDParam(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid SteamID64")
		return
	}
	gameID := chi.URLParam(r, "gameId")
	if !gameIDRe.MatchString(gameID) {
		writeError(w, http.StatusBadRequest, "invalid game id")
		return
	}
	if s.leetify == nil {
		writeError(w, http.StatusServiceUnavailable, "leetify integration not configured")
		return
	}
	ctx := r.Context()
	key := cache.LeetifyGameKey(gameID, id)

	var v leetify.GameStats
	hit := false
	if s.cache != nil {
		hit, _ = s.cache.GetJSON(ctx, key, &v)
	}
	if !hit {
		res, err, _ := s.sf.Do(key, func() (any, error) {
			gs, err := s.leetify.GetGameStats(ctx, gameID, id)
			if err != nil {
				return leetify.GameStats{}, err
			}
			return *gs, nil
		})
		if err != nil {
			// includes ErrNotFound — negative-cache briefly either way
			if s.cache != nil {
				_ = s.cache.SetJSONTTL(ctx, key, leetify.GameStats{}, 30*time.Minute)
			}
			w.Header().Set("Cache-Control", "public, max-age=600, s-maxage=1800")
			writeJSON(w, http.StatusOK, leetify.GameStats{})
			return
		}
		v = res.(leetify.GameStats)
		if s.cache != nil {
			ttl := 7 * 24 * time.Hour
			if !v.Found {
				ttl = time.Hour
			}
			_ = s.cache.SetJSONTTL(ctx, key, v, ttl)
		}
	}

	w.Header().Set("Cache-Control", "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800")
	writeJSON(w, http.StatusOK, v)
}
