package api

import (
	"net/http"
	"time"

	"github.com/cs2tracker/server/internal/cache"
	"github.com/cs2tracker/server/internal/steaminv"
)

// handleInventory serves a player's CS2 skin-inventory showcase: items from
// Steam's public inventory endpoint, valued via Skinport's bulk price list.
// Steam rate-limits this endpoint per IP aggressively, so hits cache for
// ExternalCacheTTL and rate-limit errors fall back to the stale copy
// transparently (cachedExternal keeps a 24h last-known-good).
func (s *Server) handleInventory(w http.ResponseWriter, r *http.Request) {
	id, ok := steamIDParam(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid SteamID64")
		return
	}
	v, _, err := cachedExternal(s, r.Context(), cache.InventoryKey(id),
		func() (*steaminv.View, error) { return steaminv.Build(r.Context(), s.invHTTP, id) })
	if err != nil {
		s.serverError(w, "steam inventory", err)
		return
	}
	setEdgeCache(w, 10*time.Minute)
	writeJSON(w, http.StatusOK, v)
}
