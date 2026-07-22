package api

import (
	"net/http"
	"time"

	"github.com/cs2tracker/server/internal/grid"
	"github.com/go-chi/chi/v5"
)

// handleProMatches serves the live pro-match board: LIVE first, then UPCOMING;
// finished series excluded. When the GRID feature is disabled (no key and no
// mock) it reports {"enabled":false,"matches":[]} so the frontend hides the
// panel and nothing breaks pre-setup. The list is edge-cached ~5s.
func (s *Server) handleProMatches(w http.ResponseWriter, r *http.Request) {
	if s.proMatches == nil || !s.proMatches.Store().Enabled() {
		writeJSON(w, http.StatusOK, map[string]any{"enabled": false, "matches": []any{}})
		return
	}
	list, updatedAt := s.proMatches.Store().Board()
	if list == nil {
		list = []grid.MatchState{}
	}
	setEdgeCache(w, 5*time.Second)
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled":   true,
		"matches":   list,
		"updatedAt": updatedAt.UTC().Format(time.RFC3339),
	})
}

// handleProMatch serves a single series by id (including finished ones so a
// just-ended detail view still resolves). 404 when unknown or disabled.
func (s *Server) handleProMatch(w http.ResponseWriter, r *http.Request) {
	if s.proMatches == nil || !s.proMatches.Store().Enabled() {
		writeError(w, http.StatusNotFound, "pro matches not enabled")
		return
	}
	id := chi.URLParam(r, "seriesId")
	ms, ok := s.proMatches.Store().Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "series not found")
		return
	}
	setEdgeCache(w, 5*time.Second)
	writeJSON(w, http.StatusOK, ms)
}
