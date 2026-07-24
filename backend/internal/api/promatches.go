package api

import (
	"context"
	"net/http"
	"sort"
	"strings"
	"sync"
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
		// Historical series that aged out of the live board (e.g. a result row
		// on a team page): resolve on demand from GRID and cache hard once
		// finished so repeat views cost nothing.
		ctx := r.Context()
		cl := s.proMatches.Client()
		det, err := cachedTTL(s, ctx, cache.ProSeriesDetailKey(id), 15*time.Minute,
			func() (msWrap, error) {
				d, err := cl.FetchSeriesDetail(ctx, id)
				return msWrap{M: d}, err
			})
		if err != nil || det.M == nil {
			writeError(w, http.StatusNotFound, "series not found")
			return
		}
		if det.M.Status == "finished" && s.cache != nil {
			_ = s.cache.SetJSONTTL(ctx, cache.ProSeriesDetailKey(id), det, 24*time.Hour)
		}
		ms = *det.M
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
	setEdgeCache(w, 60*time.Second)
	writeJSON(w, http.StatusOK, s.buildMatchHistory(r.Context(), ms))
}

// seriesResultOf returns a cached-or-fetched series-result resolver
// (finished results re-cached for 12h, unfinished 3m).
func (s *Server) seriesResultOf(ctx context.Context, cl *grid.Client) func(string) *grid.SeriesResult {
	return func(id string) *grid.SeriesResult {
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
}

// prefetchResults warms the series-result cache for a set of ids with bounded
// concurrency (the Series State endpoint allows 180/min — six in flight keeps
// a cold page's ~20 lookups from running serially).
func prefetchResults(ids map[string]bool, resultOf func(string) *grid.SeriesResult) {
	sem := make(chan struct{}, 6)
	var wg sync.WaitGroup
	for id := range ids {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			_ = resultOf(id)
		}(id)
	}
	wg.Wait()
}

// buildMatchHistory assembles lineups + recent form + head-to-head for a
// series. Everything is cache-backed, and cold paths fan out concurrently
// (both teams at once, bounded result/stat prefetches) — also called by the
// background prewarmer so users rarely see a cold build.
func (s *Server) buildMatchHistory(ctx context.Context, ms grid.MatchState) map[string]any {
	cl := s.proMatches.Client()
	gte, lte := grid.PastWindow(time.Now())
	teamIDs := []string{ms.Teams[0].GridID, ms.Teams[1].GridID}

	// recent past series + roster per team, both teams concurrently (the
	// Central limiter's burst covers the four calls)
	recent := map[string][]grid.PastSeries{}
	rosterOf := map[string][]grid.RosterPlayer{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, tid := range teamIDs {
		wg.Add(1)
		go func(tid string) {
			defer wg.Done()
			ps, err := cachedTTL(s, ctx, cache.ProTeamRecentKey(tid), 30*time.Minute,
				func() ([]grid.PastSeries, error) { return cl.RecentSeriesForTeam(ctx, tid, gte, lte) })
			ro, _ := cachedTTL(s, ctx, cache.ProTeamRosterKey(tid), 6*time.Hour,
				func() ([]grid.RosterPlayer, error) { return cl.TeamRoster(ctx, tid) })
			mu.Lock()
			if err == nil {
				recent[tid] = ps
			}
			rosterOf[tid] = ro
			mu.Unlock()
		}(tid)
	}
	wg.Wait()

	resultOf := s.seriesResultOf(ctx, cl)

	// warm every needed series result in parallel before the serial pass
	need := map[string]bool{}
	for _, tid := range teamIDs {
		for _, ps := range recent[tid] {
			if ps.ID != ms.SeriesID {
				need[ps.ID] = true
			}
		}
	}
	prefetchResults(need, resultOf)

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

	// Lineups: current roster (Central players query, cached 6h) with OFFICIAL
	// per-player aggregates from GRID's Statistics Feed (verified available on
	// Open Access; cached 12h). Falls back to stats aggregated from the same
	// cached series results the form uses when a player has no official data.
	rosters := map[string][]proPlayerRow{}
	for _, tid := range teamIDs {
		agg := aggregateTeamPlayers(recent[tid], ms.SeriesID, tid, resultOf)
		rosters[tid] = buildPlayerRows(s, ctx, cl, rosterOf[tid], agg, "LAST_3_MONTHS", 7)
	}

	return map[string]any{
		"teams":   ms.Teams,
		"form":    form,
		"h2h":     h2h,
		"rosters": rosters,
	}
}

// proPlayerRow is one lineup/team-page player row: official GRID aggregates
// (src "grid") or the recent-series fallback (src "agg"); recent stand-ins
// not on the published roster carry inRoster=false.
type proPlayerRow struct {
	ID       string  `json:"id,omitempty"` // GRID player id (roster players only)
	Nick     string  `json:"nick"`
	InRoster bool    `json:"inRoster"`
	Src      string  `json:"src"` // "grid" | "agg" | ""
	Series   int     `json:"series"`
	Maps     int     `json:"maps"`
	Kills    int     `json:"kills"`
	Deaths   int     `json:"deaths"`
	Assists  int     `json:"assists,omitempty"`
	KD       float64 `json:"kd"`
	AvgKills float64 `json:"avgKills"`
	KPR      float64 `json:"kpr,omitempty"`
	FKPct    float64 `json:"fkPct"`
	WinPct   float64 `json:"winPct"`
}

type playerAgg struct {
	nick                    string // display casing as seen on scoreboards
	series, k, d, a, rounds int
}

// aggregateTeamPlayers folds a team's cached recent series results into
// per-player K/D/A + round totals (the fallback stats source).
func aggregateTeamPlayers(recent []grid.PastSeries, skipID, tid string, resultOf func(string) *grid.SeriesResult) map[string]*playerAgg {
	byNick := map[string]*playerAgg{}
	for _, ps := range recent {
		if ps.ID == skipID {
			continue
		}
		res := resultOf(ps.ID)
		if res == nil || !res.Finished {
			continue
		}
		for _, rt := range res.Teams {
			if rt.GridID != tid {
				continue
			}
			for _, pl := range rt.Players {
				// scoreboard names and Central roster nicks disagree on casing
				// ("Atarax1a" vs "atarax1a") — key case-insensitively so a
				// roster player never doubles as their own stand-in
				lk := strings.ToLower(pl.Nick)
				a := byNick[lk]
				if a == nil {
					a = &playerAgg{nick: pl.Nick}
					byNick[lk] = a
				}
				a.series++
				a.k += pl.Kills
				a.d += pl.Deaths
				a.a += pl.Assists
				a.rounds += res.Rounds
			}
		}
	}
	return byNick
}

// msWrap makes a nil *MatchState cacheable through cachedTTL's generics.
type msWrap struct {
	M *grid.MatchState `json:"m"`
}

// psWrap makes a nil *PlayerStats cacheable through cachedTTL's generics.
type psWrap struct {
	S *grid.PlayerStats `json:"s"`
}

// buildPlayerRows merges the roster with official stats (window = a GRID
// TimeRangeFilter enum name), falling back to the recent-series aggregates.
func buildPlayerRows(s *Server, ctx context.Context, cl *grid.Client, roster []grid.RosterPlayer, agg map[string]*playerAgg, window string, limit int) []proPlayerRow {
	// official stats per player, fetched concurrently — the stats limiter
	// still paces the upstream, but cache hits and HTTP overlap instead of
	// queueing serially (this was the bulk of a cold page's wait)
	rowsArr := make([]proPlayerRow, len(roster))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)
	for i, rp := range roster {
		rowsArr[i] = proPlayerRow{ID: rp.ID, Nick: rp.Nick, InRoster: true}
		if rp.ID == "" {
			continue
		}
		wg.Add(1)
		go func(i int, rp grid.RosterPlayer) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			w, err := cachedTTL(s, ctx, cache.ProPlayerStatsKey(rp.ID, window), 12*time.Hour,
				func() (psWrap, error) {
					st, err := cl.PlayerCareerStats(ctx, rp.ID, window)
					return psWrap{S: st}, err
				})
			// official rows with zero kills AND deaths are data gaps on GRID's
			// side (e.g. maps counted but no player lines) — fall through
			if err == nil && w.S != nil && w.S.Kills+w.S.Deaths > 0 {
				st := w.S
				row := &rowsArr[i]
				row.Src = "grid"
				row.Series = st.SeriesCount
				row.Maps = st.Maps
				row.Kills = st.Kills
				row.Deaths = st.Deaths
				row.KD = st.KD
				row.AvgKills = st.AvgKills
				row.FKPct = st.FirstKillPct
				row.WinPct = st.MapWinPct
			}
		}(i, rp)
	}
	wg.Wait()

	var rows []proPlayerRow
	seen := map[string]bool{}
	for i, rp := range roster {
		row := rowsArr[i]
		if row.Src == "" {
			if a := agg[strings.ToLower(rp.Nick)]; a != nil && a.k+a.d > 0 {
				fillAggRow(&row, a)
			}
		}
		rows = append(rows, row)
		seen[strings.ToLower(rp.Nick)] = true
	}
	// recent stand-ins who played 2+ of the team's recent series (with real
	// data — coaches/observers appear in GRID player lists with 0K 0D)
	for lk, a := range agg {
		if seen[lk] || a.series < 2 || a.k+a.d == 0 {
			continue
		}
		row := proPlayerRow{Nick: a.nick, InRoster: false}
		fillAggRow(&row, a)
		rows = append(rows, row)
	}
	// GRID sometimes carries the same player under two nick spellings
	// ("910" and "910-") — merge rows whose nicks differ only by trailing
	// punctuation, keeping the record with more play and the clean spelling.
	normNick := func(n string) string {
		return strings.TrimRight(strings.ToLower(strings.TrimSpace(n)), "-_.~")
	}
	idx := map[string]int{}
	deduped := rows[:0]
	for _, row := range rows {
		k := normNick(row.Nick)
		if k == "" {
			k = strings.ToLower(row.Nick)
		}
		if j, ok := idx[k]; ok {
			cur := &deduped[j]
			better := row.Maps > cur.Maps || (row.Maps == cur.Maps && row.Kills > cur.Kills)
			if better {
				if strings.ToLower(cur.Nick) == k { // keep the clean display nick
					row.Nick = cur.Nick
				}
				row.InRoster = row.InRoster || cur.InRoster
				*cur = row
			} else if strings.ToLower(row.Nick) == k {
				cur.Nick = row.Nick
			}
			continue
		}
		idx[k] = len(deduped)
		deduped = append(deduped, row)
	}
	rows = deduped

	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].InRoster != rows[j].InRoster {
			return rows[i].InRoster
		}
		return rows[i].Kills > rows[j].Kills
	})
	if len(rows) > limit {
		rows = rows[:limit]
	}
	return rows
}

func fillAggRow(row *proPlayerRow, a *playerAgg) {
	row.Src = "agg"
	row.Series = a.series
	row.Maps = 0
	row.Kills = a.k
	row.Deaths = a.d
	row.Assists = a.a
	if a.d > 0 {
		row.KD = float64(a.k) / float64(a.d)
	} else {
		row.KD = float64(a.k)
	}
	if a.rounds > 0 {
		row.KPR = float64(a.k) / float64(a.rounds)
	}
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
