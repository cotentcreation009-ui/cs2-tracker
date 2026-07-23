package api

import (
	"context"
	"net/http"
	"sort"
	"time"

	"github.com/cs2tracker/server/internal/cache"
	"github.com/cs2tracker/server/internal/grid"
	"github.com/go-chi/chi/v5"
)

// cachedTTL is a cache-or-fetch with an explicit TTL (cachedExternal uses a
// fixed short TTL; history data changes slowly and must be cached hard to
// respect GRID's 20/min Central cap). Singleflight-coalesced per key.
func cachedTTL[T any](s *Server, ctx context.Context, key string, ttl time.Duration, fetch func() (T, error)) (T, error) {
	var v T
	if s.cache != nil {
		if hit, _ := s.cache.GetJSON(ctx, key, &v); hit {
			return v, nil
		}
	}
	res, err, _ := s.sf.Do(key, func() (any, error) { return fetch() })
	if err != nil {
		return v, err
	}
	out := res.(T)
	if s.cache != nil {
		_ = s.cache.SetJSONTTL(ctx, key, out, ttl)
	}
	return out, nil
}

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

// handleProMatchHistory returns recent-form + head-to-head for a series' two
// teams, resolved on demand and cached hard (team lists 30m, series results
// 12h finished / 3m unfinished). Loaded lazily by the detail page so it never
// blocks the live scoreboard.
func (s *Server) handleProMatchHistory(w http.ResponseWriter, r *http.Request) {
	if s.proMatches == nil || !s.proMatches.Store().Enabled() {
		writeJSON(w, http.StatusOK, map[string]any{"enabled": false})
		return
	}
	ms, ok := s.proMatches.Store().Get(chi.URLParam(r, "seriesId"))
	if !ok || len(ms.Teams) < 2 {
		writeJSON(w, http.StatusOK, map[string]any{"form": map[string]any{}, "h2h": []any{}})
		return
	}
	ctx := r.Context()
	cl := s.proMatches.Client()
	gte, lte := grid.PastWindow(time.Now())
	teamIDs := []string{ms.Teams[0].GridID, ms.Teams[1].GridID}

	// recent past series per team (cached 30m)
	recent := map[string][]grid.PastSeries{}
	for _, tid := range teamIDs {
		ps, err := cachedTTL(s, ctx, cache.ProTeamRecentKey(tid), 30*time.Minute,
			func() ([]grid.PastSeries, error) { return cl.RecentSeriesForTeam(ctx, tid, gte, lte) })
		if err == nil {
			recent[tid] = ps
		}
	}

	// resolve a series' result (cached: finished 12h, else 3m)
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

	type formEntry struct {
		SeriesID     string `json:"seriesId"`
		Date         string `json:"date"`
		Won          bool   `json:"won"`
		Score        [2]int `json:"score"` // [team, opponent]
		OpponentID   string `json:"opponentId"`
		OpponentName string `json:"opponentName"`
		OpponentLogo string `json:"opponentLogo,omitempty"`
	}
	type h2hEntry struct {
		SeriesID    string         `json:"seriesId"`
		Date        string         `json:"date"`
		WinnerID    string         `json:"winnerId,omitempty"`
		ScoreByTeam map[string]int `json:"scoreByTeam"`
	}

	form := map[string][]formEntry{}
	h2hSeen := map[string]bool{}
	var h2h []h2hEntry

	for _, tid := range teamIDs {
		for _, ps := range recent[tid] {
			if ps.ID == ms.SeriesID { // skip the match being viewed
				continue
			}
			// opponent in this past series
			var opp *grid.Team
			for i := range ps.Teams {
				if ps.Teams[i].GridID != tid {
					opp = &ps.Teams[i]
					break
				}
			}
			if opp == nil {
				continue
			}
			res := resultOf(ps.ID)
			if res == nil || !res.Finished || len(res.Teams) < 2 {
				continue
			}
			var mine, theirs int
			won := false
			winner := ""
			for _, rt := range res.Teams {
				if rt.Won {
					winner = rt.GridID
				}
				if rt.GridID == tid {
					mine = rt.Score
					won = rt.Won
				} else {
					theirs = rt.Score
				}
			}
			if len(form[tid]) < 5 {
				form[tid] = append(form[tid], formEntry{
					SeriesID: ps.ID, Date: ps.StartTime, Won: won,
					Score: [2]int{mine, theirs}, OpponentID: opp.GridID,
					OpponentName: opp.ShortName, OpponentLogo: opp.LogoUrl,
				})
			}
			// head-to-head: this past series is between the SAME two teams
			if opp.GridID == other(teamIDs, tid) && !h2hSeen[ps.ID] {
				h2hSeen[ps.ID] = true
				sb := map[string]int{}
				for _, rt := range res.Teams {
					sb[rt.GridID] = rt.Score
				}
				h2h = append(h2h, h2hEntry{SeriesID: ps.ID, Date: ps.StartTime, WinnerID: winner, ScoreByTeam: sb})
			}
		}
	}
	sort.SliceStable(h2h, func(i, j int) bool { return h2h[i].Date > h2h[j].Date })
	if len(h2h) > 5 {
		h2h = h2h[:5]
	}

	setEdgeCache(w, 60*time.Second)
	writeJSON(w, http.StatusOK, map[string]any{
		"teams": ms.Teams,
		"form":  form,
		"h2h":   h2h,
	})
}

// other returns the id in the pair that isn't tid.
func other(pair []string, tid string) string {
	for _, id := range pair {
		if id != tid {
			return id
		}
	}
	return ""
}
