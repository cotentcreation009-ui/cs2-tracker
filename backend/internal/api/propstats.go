package api

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/cs2tracker/server/internal/cache"
	"github.com/cs2tracker/server/internal/grid"
	"github.com/go-chi/chi/v5"
)

// statWindows are the GRID TimeRangeFilter windows the player drill-down
// compares, oldest-coverage last.
var statWindows = []struct{ Key, Label string }{
	{"LAST_WEEK", "Last week"},
	{"LAST_MONTH", "Last month"},
	{"LAST_3_MONTHS", "Last 3 months"},
	{"LAST_YEAR", "Last 12 months"},
}

// handleProPlayerStats serves a player's official GRID aggregates across all
// comparison windows (the click-a-player drill-down). Each (player, window)
// cell is cached 12h — a warm player costs zero upstream calls, a cold one
// costs four stats-feed calls fetched concurrently.
func (s *Server) handleProPlayerStats(w http.ResponseWriter, r *http.Request) {
	if s.proMatches == nil || !s.proMatches.Store().Enabled() {
		writeJSON(w, http.StatusOK, map[string]any{"enabled": false})
		return
	}
	pid := strings.TrimSpace(chi.URLParam(r, "playerId"))
	if pid == "" || len(pid) > 24 {
		writeError(w, http.StatusNotFound, "unknown player")
		return
	}
	ctx := r.Context()
	cl := s.proMatches.Client()

	type windowRow struct {
		Window string            `json:"window"`
		Label  string            `json:"label"`
		Stats  *grid.PlayerStats `json:"stats"` // null = no tracked data
	}
	rows := make([]windowRow, len(statWindows))
	errs := make([]bool, len(statWindows))
	var wg sync.WaitGroup
	for i, win := range statWindows {
		rows[i] = windowRow{Window: win.Key, Label: win.Label}
		wg.Add(1)
		go func(i int, key string) {
			defer wg.Done()
			fetch := func() (psWrap, error) {
				return cachedTTL(s, ctx, cache.ProPlayerStatsKey(pid, key), 12*time.Hour,
					func() (psWrap, error) {
						st, err := cl.PlayerCareerStats(ctx, pid, key)
						return psWrap{S: st}, err
					})
			}
			wrapped, err := fetch()
			if err != nil { // one retry — a transient miss otherwise renders a dash row
				time.Sleep(400 * time.Millisecond)
				wrapped, err = fetch()
			}
			if err == nil {
				rows[i].Stats = wrapped.S
			} else {
				errs[i] = true
			}
		}(i, win.Key)
	}
	wg.Wait()

	hasAny := false
	clean := true
	for i, row := range rows {
		if row.Stats != nil {
			hasAny = true
		}
		if errs[i] {
			clean = false
		}
	}
	// never let a partially-errored response sit at the edge for 10 minutes
	if clean {
		setEdgeCache(w, 10*time.Minute)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled": true,
		"any":     hasAny,
		"windows": rows,
	})
}
