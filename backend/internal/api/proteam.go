package api

import (
	"net/http"
	"time"

	"github.com/cs2tracker/server/internal/cache"
	"github.com/cs2tracker/server/internal/grid"
	"github.com/go-chi/chi/v5"
)

// handleProTeam serves an HLTV-style team page: identity, roster with
// aggregated per-player stats, recent record/streak and the results list —
// all assembled from the SAME cached GRID lookups the match-history panel
// uses (roster 6h, recent list 30m, finished results 12h).
//
// Note: GRID's Statistics Feed (true career stats) is not entitled on Open
// Access, so player stats here are aggregates over the team's recent tracked
// series (~120 days) — labelled as such in the UI.
func (s *Server) handleProTeam(w http.ResponseWriter, r *http.Request) {
	if s.proMatches == nil || !s.proMatches.Store().Enabled() {
		writeJSON(w, http.StatusOK, map[string]any{"enabled": false})
		return
	}
	tid := chi.URLParam(r, "teamId")
	if tid == "" {
		writeError(w, http.StatusBadRequest, "missing team id")
		return
	}
	ctx := r.Context()
	cl := s.proMatches.Client()
	gte, lte := grid.PastWindow(time.Now())

	roster, _ := cachedTTL(s, ctx, cache.ProTeamRosterKey(tid), 6*time.Hour,
		func() ([]grid.RosterPlayer, error) { return cl.TeamRoster(ctx, tid) })
	recent, err := cachedTTL(s, ctx, cache.ProTeamRecentKey(tid), 30*time.Minute,
		func() ([]grid.PastSeries, error) { return cl.RecentSeriesForTeam(ctx, tid, gte, lte) })
	if err != nil && len(roster) == 0 {
		writeError(w, http.StatusNotFound, "team not found")
		return
	}

	resultOf := func(id string) *grid.SeriesResult {
		res, err := cachedTTL(s, ctx, cache.ProSeriesResultKey(id), 3*time.Minute,
			func() (*grid.SeriesResult, error) { return cl.SeriesResult(ctx, id) })
		if err != nil || res == nil {
			return nil
		}
		if res.Finished && s.cache != nil {
			_ = s.cache.SetJSONTTL(ctx, cache.ProSeriesResultKey(id), res, 12*time.Hour)
		}
		return res
	}

	// team identity from its own past-series entries (no extra upstream call)
	var team grid.Team
	team.GridID = tid
	for _, ps := range recent {
		for _, t := range ps.Teams {
			if t.GridID == tid {
				team = t
			}
		}
		if team.Name != "" {
			break
		}
	}

	type resultRow struct {
		SeriesID   string    `json:"seriesId"`
		Date       string    `json:"date"`
		Won        bool      `json:"won"`
		Score      [2]int    `json:"score"`
		Opponent   grid.Team `json:"opponent"`
		Tournament string    `json:"tournament,omitempty"`
		Format     string    `json:"format,omitempty"`
	}
	var results []resultRow
	wins, losses := 0, 0
	streak, streakDone := 0, false
	streakWon := false

	for _, ps := range recent {
		res := resultOf(ps.ID)
		if res == nil || !res.Finished {
			continue
		}
		var opp grid.Team
		var mine, theirs int
		won := false
		for i := range ps.Teams {
			if ps.Teams[i].GridID != tid {
				opp = ps.Teams[i]
			}
		}
		for _, rt := range res.Teams {
			if rt.GridID == tid {
				mine, won = rt.Score, rt.Won
			} else {
				theirs = rt.Score
			}
		}
		if won {
			wins++
		} else {
			losses++
		}
		if !streakDone {
			if streak == 0 {
				streakWon = won
				streak = 1
			} else if won == streakWon {
				streak++
			} else {
				streakDone = true
			}
		}
		results = append(results, resultRow{SeriesID: ps.ID, Date: ps.StartTime, Won: won, Score: [2]int{mine, theirs}, Opponent: opp, Tournament: ps.Tournament, Format: ps.FormatShort})
	}

	agg := aggregateTeamPlayers(recent, "", tid, resultOf)
	players := buildPlayerRows(s, ctx, cl, roster, agg, "LAST_YEAR", 10)

	setEdgeCache(w, 120*time.Second)
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled": true,
		"team":    team,
		"record":  map[string]any{"wins": wins, "losses": losses, "streak": streak, "streakWon": streakWon},
		"players": players,
		"results": results,
	})
}
