package api

import (
	"context"
	"net/http"
	"regexp"
	"strconv"
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
			s.fillScoreboardAvatars(ctx, gs)
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

// fillScoreboardAvatars decorates a game's scoreboard with Steam avatars —
// one bulk summaries call for all ten players, best-effort (no Steam key or a
// Steam hiccup just leaves the board avatar-less). Cached with the board.
func (s *Server) fillScoreboardAvatars(ctx context.Context, gs *leetify.GameStats) {
	if s.steam == nil || len(gs.Scoreboard) == 0 {
		return
	}
	ids := make([]uint64, 0, 10)
	for _, t := range gs.Scoreboard {
		for _, p := range t.Players {
			if id, err := strconv.ParseUint(p.SteamID, 10, 64); err == nil && id > 0 {
				ids = append(ids, id)
			}
		}
	}
	if len(ids) == 0 {
		return
	}
	sums, err := s.steam.GetPlayerSummaries(ctx, ids...)
	if err != nil {
		return
	}
	avatar := make(map[string]string, len(sums))
	for _, su := range sums {
		if su.AvatarMedium != "" {
			avatar[strconv.FormatUint(su.SteamID, 10)] = su.AvatarMedium
		} else if su.Avatar != "" {
			avatar[strconv.FormatUint(su.SteamID, 10)] = su.Avatar
		}
	}
	for ti := range gs.Scoreboard {
		for pi := range gs.Scoreboard[ti].Players {
			p := &gs.Scoreboard[ti].Players[pi]
			p.Avatar = avatar[p.SteamID]
		}
	}
}
