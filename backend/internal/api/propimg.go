package api

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/cs2tracker/server/internal/cache"
	"github.com/go-chi/chi/v5"
)

// handleProPlayerImage serves a pro player's photo (resolved by nickname from
// Liquipedia, CC BY-SA) as raw image bytes. Cached in Redis for 14 days
// (misses 3 days) and edge-cached for a week, so Liquipedia sees at most one
// resolution per player per fortnight regardless of traffic. Cold lookups run
// behind a 1-req/2s limiter — photos on a fresh team page fill in
// progressively, which the frontend treats as an enhancement over the
// initials avatar.
func (s *Server) handleProPlayerImage(w http.ResponseWriter, r *http.Request) {
	if s.lp == nil {
		writeError(w, http.StatusNotFound, "player images not enabled")
		return
	}
	nick := strings.TrimSpace(chi.URLParam(r, "nick"))
	if nick == "" || len(nick) > 48 || strings.ContainsAny(nick, "/\\#<>|") {
		writeError(w, http.StatusNotFound, "unknown player")
		return
	}
	// Hard budget: lookups queue on the Liquipedia limiter, and a page's worth
	// of misses must never leave a request hanging for tens of seconds.
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	key := cache.ProPlayerImgKey(nick)

	type img struct {
		Mime string `json:"mime"`
		Data []byte `json:"data"`
	}
	var v img
	hit := false
	if s.cache != nil {
		hit, _ = s.cache.GetJSON(ctx, key, &v)
	}
	if !hit {
		res, err, _ := s.sf.Do(key, func() (any, error) {
			p, err := s.lp.PlayerPhoto(ctx, nick)
			if err != nil {
				return img{}, err
			}
			out := img{}
			if p != nil {
				out = img{Mime: p.Mime, Data: p.Data}
			}
			return out, nil
		})
		if err != nil {
			s.log.Warn("liquipedia photo lookup failed", "nick", nick, "err", err)
			// negative-cache errors briefly so failing lookups (e.g. this IP
			// being rate-limited) don't add latency or upstream load on every
			// page view; the browser-side resolver takes over meanwhile
			if s.cache != nil {
				_ = s.cache.SetJSONTTL(ctx, key, img{}, 30*time.Minute)
			}
			w.Header().Set("Cache-Control", "public, max-age=600, s-maxage=1800")
			writeError(w, http.StatusNotFound, "unknown player")
			return
		}
		v = res.(img)
		if s.cache != nil {
			ttl := 14 * 24 * time.Hour
			if len(v.Data) == 0 {
				ttl = 3 * 24 * time.Hour // negative cache: no page / no photo yet
			}
			_ = s.cache.SetJSONTTL(ctx, key, v, ttl)
		}
	}

	if len(v.Data) == 0 {
		w.Header().Set("Cache-Control", "public, max-age=3600, s-maxage=21600")
		writeError(w, http.StatusNotFound, "no photo")
		return
	}
	mime := v.Mime
	if mime == "" {
		mime = "image/jpeg"
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(v.Data)
}
