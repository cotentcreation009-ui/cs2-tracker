package api

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/cs2tracker/server/internal/cache"
	"github.com/cs2tracker/server/internal/liquipedia"
	"github.com/go-chi/chi/v5"
)

// handleProPlayerCard serves a player's Liquipedia identity card (real name,
// country, role, birth date, current team) by nickname. Same discipline as
// photos: Redis 14 days (misses 3 days), edge-cached a day, cold lookups
// behind the 1-req/2s Liquipedia limiter — cards fill in progressively and
// the UI treats them as an enhancement over the bare nickname.
func (s *Server) handleProPlayerCard(w http.ResponseWriter, r *http.Request) {
	if s.lp == nil {
		writeError(w, http.StatusNotFound, "player cards not enabled")
		return
	}
	nick := strings.TrimSpace(chi.URLParam(r, "nick"))
	if nick == "" || len(nick) > 48 || strings.ContainsAny(nick, "/\\#<>|") {
		writeError(w, http.StatusNotFound, "unknown player")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	key := cache.ProPlayerCardKey(nick)

	var v liquipedia.PlayerInfo
	hit := false
	if s.cache != nil {
		hit, _ = s.cache.GetJSON(ctx, key, &v)
	}
	if !hit {
		res, err, _ := s.sf.Do(key, func() (any, error) {
			info, err := s.lp.PlayerInfo(ctx, nick)
			if err != nil {
				return liquipedia.PlayerInfo{}, err
			}
			return *info, nil
		})
		if err != nil {
			s.log.Warn("liquipedia player card lookup failed", "nick", nick, "err", err)
			if s.cache != nil {
				// NOT ctx: the usual failure here is ctx's own 5s deadline
				// expiring, and writing the negative entry through a dead
				// context silently drops it — so the next request for the
				// same nick spent another 5s and a rate-limiter slot
				// rediscovering the same failure, forever. Measured: the
				// same uncached nick cost 5165ms then 5075ms back to back.
				wctx, wcancel := context.WithTimeout(context.WithoutCancel(r.Context()), 2*time.Second)
				_ = s.cache.SetJSONTTL(wctx, key, liquipedia.PlayerInfo{}, 30*time.Minute)
				wcancel()
			}
			w.Header().Set("Cache-Control", "public, max-age=600, s-maxage=1800")
			writeJSON(w, http.StatusOK, liquipedia.PlayerInfo{})
			return
		}
		v = res.(liquipedia.PlayerInfo)
		if s.cache != nil {
			ttl := 14 * 24 * time.Hour
			if !v.Found {
				ttl = 3 * 24 * time.Hour
			}
			_ = s.cache.SetJSONTTL(ctx, key, v, ttl)
		}
	}

	w.Header().Set("Cache-Control", "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800")
	writeJSON(w, http.StatusOK, v)
}
