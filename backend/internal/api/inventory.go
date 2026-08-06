package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/cs2tracker/server/internal/cache"
	"github.com/cs2tracker/server/internal/steaminv"
)

// refreshAfter is how old a stored snapshot has to be before we ask Steam
// again. Inventories change on the scale of days, and Steam's per-IP throttle
// is the scarce resource here — so a same-day snapshot is served without
// touching Steam at all.
const refreshAfter = 6 * time.Hour

// maxStaleAge caps how long a snapshot may stand in for a live read. Past this
// we would rather show nothing: a player who has since made their inventory
// private must stop appearing here, and a long Steam block must not turn our
// stored copy into an indefinite mirror of data they stopped sharing.
const maxStaleAge = 7 * 24 * time.Hour

// snapshotRetention is how long an unrefreshed snapshot is kept at all. Anything
// older is nobody's cache — it is just retained personal data.
const snapshotRetention = 90 * 24 * time.Hour

// handleInventory serves a player's CS2 skin-inventory showcase: items from
// Steam's public inventory endpoint, valued via Skinport's bulk price list.
//
// Steam throttles inventory reads per source IP, and every read the site makes
// leaves from the same VM — so the fetch is the last resort, not the first
// move. Order is: hot cache → stored snapshot (if recent enough) → a governed
// live read. When Steam turns us away we serve the stored snapshot flagged
// stale rather than failing, and only a player we have never read comes back
// unavailable — with an honest reason instead of a 500.
func (s *Server) handleInventory(w http.ResponseWriter, r *http.Request) {
	id, ok := steamIDParam(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid SteamID64")
		return
	}
	ctx := r.Context()
	key := cache.InventoryKey(id)

	if s.cache != nil {
		var hot steaminv.View
		if hit, _ := s.cache.GetJSON(ctx, key, &hot); hit {
			setEdgeCache(w, 10*time.Minute)
			writeJSON(w, http.StatusOK, &hot)
			return
		}
	}

	// A snapshot we read recently answers without spending Steam budget.
	snap, snapAt, hasSnap, err := s.db.GetInventorySnapshot(ctx, id)
	if err != nil {
		s.log.Warn("inventory snapshot read", "steam_id", id, "err", err)
	}
	if hasSnap && time.Since(snapAt) < refreshAfter {
		s.serveSnapshot(w, ctx, key, snap, snapAt, false)
		return
	}

	v, err, _ := s.sf.Do(key, func() (any, error) {
		view, err := steaminv.Build(ctx, s.invHTTP, id)
		if err != nil {
			return nil, err
		}
		if payload, mErr := json.Marshal(view); mErr == nil {
			if sErr := s.db.SaveInventorySnapshot(ctx, id, payload); sErr != nil {
				s.log.Warn("inventory snapshot save", "steam_id", id, "err", sErr)
			}
		}
		if s.cache != nil {
			_ = s.cache.SetJSONTTL(ctx, key, view, s.cfg.ExternalCacheTTL)
		}
		return view, nil
	})
	if err != nil {
		// Whatever went wrong upstream, a recent-enough copy beats an error
		// page — but only while it can still be called current.
		if hasSnap && time.Since(snapAt) < maxStaleAge {
			s.serveSnapshot(w, ctx, key, snap, snapAt, true)
			return
		}
		if !errors.Is(err, steaminv.ErrRateLimited) {
			s.log.Warn("steam inventory", "steam_id", id, "err", err)
		} else {
			// Throttled, and we have nothing stored. Hand the profile to the
			// backfill worker so this request still leaves the next one
			// something to serve — otherwise a busy profile can be asked for
			// forever and read never.
			s.invBackfill.enqueue(id)
		}
		retry := int(steaminv.RetryAfter().Round(time.Second).Seconds())
		if retry == 0 {
			retry = 60
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, &steaminv.View{
			Unavailable:   true,
			RetryAfterSec: retry,
		})
		return
	}

	setEdgeCache(w, 10*time.Minute)
	writeJSON(w, http.StatusOK, v)
}

// serveSnapshot answers from the stored copy, stamping it with its true age so
// the UI can say when it was read. stale marks a snapshot we would have liked
// to refresh but couldn't.
func (s *Server) serveSnapshot(w http.ResponseWriter, ctx context.Context, key string, payload []byte, at time.Time, stale bool) {
	var view steaminv.View
	if err := json.Unmarshal(payload, &view); err != nil {
		writeError(w, http.StatusInternalServerError, "inventory snapshot unreadable")
		return
	}
	view.FetchedAt = at.UTC().Format(time.RFC3339)
	view.Stale = stale
	if !stale && s.cache != nil {
		_ = s.cache.SetJSONTTL(ctx, key, &view, s.cfg.ExternalCacheTTL)
	}
	// Stale copies get a short edge TTL so a recovered Steam refreshes soon.
	if stale {
		setEdgeCache(w, time.Minute)
	} else {
		setEdgeCache(w, 10*time.Minute)
	}
	writeJSON(w, http.StatusOK, &view)
}
