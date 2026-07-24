package grid

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// PastSeries is a lightweight Central-Data record of a past series (identity +
// schedule only; results come from SeriesResult).
type PastSeries struct {
	ID          string `json:"id"`
	StartTime   string `json:"startTime"`
	FormatShort string `json:"formatShort"`
	Tournament  string `json:"tournament,omitempty"`
	Teams       []Team `json:"teams"`
}

// SeriesResultTeam is one team's final line in a series result.
type SeriesResultTeam struct {
	GridID  string       `json:"gridId"`
	Name    string       `json:"name"`
	Score   int          `json:"score"`
	Won     bool         `json:"won"`
	Players []PlayerLine `json:"players,omitempty"` // aggregated across the series' maps
}

// PlayerLine is one player's aggregated K/A/D across a series (for recent-form
// player stats on upcoming matches).
type PlayerLine struct {
	Nick    string `json:"nick"`
	Kills   int    `json:"kills"`
	Assists int    `json:"assists"`
	Deaths  int    `json:"deaths"`
}

// SeriesResult is the outcome of a (finished) series — maps won per team,
// plus per-player lines and the series' total round count (for KPR).
type SeriesResult struct {
	Finished bool               `json:"finished"`
	Rounds   int                `json:"rounds"`
	Teams    []SeriesResultTeam `json:"teams"`
}

func teamRecentQuery(titleID string) string {
	return fmt.Sprintf(`query TeamRecent($tid: ID!, $gte: String!, $lte: String!) {
  allSeries(first: 15,
    filter: { titleId: %q, teamId: $tid, types: [ESPORTS], startTimeScheduled: { gte: $gte, lte: $lte } },
    orderBy: StartTimeScheduled, orderDirection: DESC) {
    edges { node {
      id startTimeScheduled
      format { nameShortened }
      tournament { name }
      teams { baseInfo { id name nameShortened logoUrl colorPrimary colorSecondary } }
    } }
  }
}`, titleID)
}

const seriesResultQuery = `query SeriesResult($id: ID!) {
  seriesState(id: $id) {
    finished
    teams { id name score won }
    games { started finished
      teams { id score players { name kills deaths killAssistsReceived } } }
  }
}`

// RecentSeriesForTeam returns a team's most-recent past series (DESC) within
// [gte, lte]. Schedule/identity only — no results.
func (c *Client) RecentSeriesForTeam(ctx context.Context, teamID, gte, lte string) ([]PastSeries, error) {
	if err := c.centralLim.Wait(ctx); err != nil {
		return nil, err
	}
	body, err := c.postGraphQL(ctx, c.centralURL, teamRecentQuery(c.getTitleID()),
		map[string]any{"tid": teamID, "gte": gte, "lte": lte})
	if err != nil {
		return nil, err
	}
	var resp struct {
		Data struct {
			AllSeries struct {
				Edges []struct {
					Node struct {
						ID                 string `json:"id"`
						StartTimeScheduled string `json:"startTimeScheduled"`
						Format             *struct {
							NameShortened string `json:"nameShortened"`
						} `json:"format"`
						Tournament *struct {
							Name string `json:"name"`
						} `json:"tournament"`
						Teams []struct {
							BaseInfo *struct {
								ID             string `json:"id"`
								Name           string `json:"name"`
								NameShortened  string `json:"nameShortened"`
								LogoUrl        string `json:"logoUrl"`
								ColorPrimary   string `json:"colorPrimary"`
								ColorSecondary string `json:"colorSecondary"`
							} `json:"baseInfo"`
						} `json:"teams"`
					} `json:"node"`
				} `json:"edges"`
			} `json:"allSeries"`
		} `json:"data"`
	}
	if err := decodeGQL(body, &resp); err != nil {
		return nil, err
	}
	out := make([]PastSeries, 0, len(resp.Data.AllSeries.Edges))
	for _, e := range resp.Data.AllSeries.Edges {
		n := e.Node
		ps := PastSeries{ID: n.ID, StartTime: n.StartTimeScheduled}
		if n.Format != nil {
			ps.FormatShort = n.Format.NameShortened
		}
		if n.Tournament != nil {
			ps.Tournament = n.Tournament.Name
		}
		for _, t := range n.Teams {
			if t.BaseInfo == nil {
				continue
			}
			ps.Teams = append(ps.Teams, Team{
				GridID:         t.BaseInfo.ID,
				Name:           t.BaseInfo.Name,
				ShortName:      shortOr(t.BaseInfo.NameShortened, t.BaseInfo.Name),
				LogoUrl:        realLogo(t.BaseInfo.LogoUrl),
				ColorPrimary:   t.BaseInfo.ColorPrimary,
				ColorSecondary: t.BaseInfo.ColorSecondary,
			})
		}
		out = append(out, ps)
	}
	return out, nil
}

// SeriesResult fetches a series' outcome (maps won per team, finished flag).
func (c *Client) SeriesResult(ctx context.Context, id string) (*SeriesResult, error) {
	body, err := c.postGraphQL(ctx, c.seriesURL, seriesResultQuery, map[string]any{"id": id})
	if err != nil {
		return nil, err
	}
	var resp struct {
		Data struct {
			SeriesState *struct {
				Finished bool `json:"finished"`
				Teams    []struct {
					ID    string `json:"id"`
					Name  string `json:"name"`
					Score int    `json:"score"`
					Won   bool   `json:"won"`
				} `json:"teams"`
				Games []struct {
					Started  bool `json:"started"`
					Finished bool `json:"finished"`
					Teams    []struct {
						ID      string `json:"id"`
						Score   int    `json:"score"`
						Players []struct {
							Name    string `json:"name"`
							Kills   int    `json:"kills"`
							Deaths  int    `json:"deaths"`
							Assists int    `json:"killAssistsReceived"`
						} `json:"players"`
					} `json:"teams"`
				} `json:"games"`
			} `json:"seriesState"`
		} `json:"data"`
	}
	if err := decodeGQL(body, &resp); err != nil {
		return nil, err
	}
	ss := resp.Data.SeriesState
	if ss == nil {
		return &SeriesResult{}, nil
	}
	res := &SeriesResult{Finished: ss.Finished}
	// per-player aggregation across the series' started maps + total rounds
	type agg struct{ k, a, d int }
	byTeam := map[string]map[string]*agg{}
	for _, g := range ss.Games {
		if !g.Started {
			continue
		}
		for _, gt := range g.Teams {
			res.Rounds += gt.Score
			m := byTeam[gt.ID]
			if m == nil {
				m = map[string]*agg{}
				byTeam[gt.ID] = m
			}
			for _, pl := range gt.Players {
				if pl.Name == "" {
					continue
				}
				a := m[pl.Name]
				if a == nil {
					a = &agg{}
					m[pl.Name] = a
				}
				a.k += pl.Kills
				a.a += pl.Assists
				a.d += pl.Deaths
			}
		}
	}
	for _, t := range ss.Teams {
		rt := SeriesResultTeam{GridID: t.ID, Name: t.Name, Score: t.Score, Won: t.Won}
		for nick, a := range byTeam[t.ID] {
			rt.Players = append(rt.Players, PlayerLine{Nick: nick, Kills: a.k, Assists: a.a, Deaths: a.d})
		}
		res.Teams = append(res.Teams, rt)
	}
	return res, nil
}

// seriesMetaQuery resolves ONE series' identity from Central Data — used for
// historical series that have aged out of the live board's window.
const seriesMetaQuery = `query SeriesMeta($id: ID!) {
  series(id: $id) {
    id startTimeScheduled
    format { name nameShortened }
    tournament { id name nameShortened logoUrl }
    teams { baseInfo { id name nameShortened logoUrl colorPrimary colorSecondary } }
  }
}`

// FetchSeriesMeta fetches a single series' schedule identity (teams, format,
// tournament). Returns nil when the series is unknown.
func (c *Client) FetchSeriesMeta(ctx context.Context, id string) (*MatchState, error) {
	if err := c.centralLim.Wait(ctx); err != nil {
		return nil, err
	}
	body, err := c.postGraphQL(ctx, c.centralURL, seriesMetaQuery, map[string]any{"id": id})
	if err != nil {
		return nil, err
	}
	var resp struct {
		Data struct {
			Series *centralNode `json:"series"`
		} `json:"data"`
	}
	if err := decodeGQL(body, &resp); err != nil {
		return nil, err
	}
	if resp.Data.Series == nil || resp.Data.Series.ID == "" {
		return nil, nil
	}
	ms := normalizeSchedule(*resp.Data.Series)
	return &ms, nil
}

// FetchSeriesDetail assembles a full MatchState for a series that isn't in the
// live store (a historical result the user clicked into): Central identity +
// Series State scoreboards. Returns nil when GRID doesn't know the series.
func (c *Client) FetchSeriesDetail(ctx context.Context, id string) (*MatchState, error) {
	ms, err := c.FetchSeriesMeta(ctx, id)
	if err != nil {
		return nil, err
	}
	if ms == nil {
		return nil, nil
	}
	ss, err := c.FetchSeriesState(ctx, id)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	if ss != nil {
		applySeriesState(ms, ss, time.Now())
	} else if t, perr := time.Parse(time.RFC3339, ms.StartScheduled); perr == nil && time.Since(t) > 6*time.Hour {
		// no live state and the series was scheduled hours ago — it's over
		ms.Status = "finished"
	}
	return ms, nil
}

// rosterQuery lists a team's current players (Open Access permits id+nickname
// only — image/nationality are PERMISSION_DENIED on this tier).
const rosterQuery = `query Roster($tid: ID) {
  players(first: 12, filter: { teamIdFilter: { id: $tid } }) {
    edges { node { id nickname } }
  }
}`

// RosterPlayer is one player on a team's current roster (Open Access exposes
// id + nickname only).
type RosterPlayer struct {
	ID   string `json:"id"`
	Nick string `json:"nick"`
}

// TeamRoster returns a team's current roster (player ids + nicknames).
func (c *Client) TeamRoster(ctx context.Context, teamID string) ([]RosterPlayer, error) {
	if err := c.centralLim.Wait(ctx); err != nil {
		return nil, err
	}
	body, err := c.postGraphQL(ctx, c.centralURL, rosterQuery, map[string]any{"tid": teamID})
	if err != nil {
		return nil, err
	}
	var resp struct {
		Data struct {
			Players struct {
				Edges []struct {
					Node struct {
						ID       string `json:"id"`
						Nickname string `json:"nickname"`
					} `json:"node"`
				} `json:"edges"`
			} `json:"players"`
		} `json:"data"`
	}
	if err := decodeGQL(body, &resp); err != nil {
		return nil, err
	}
	var out []RosterPlayer
	for _, e := range resp.Data.Players.Edges {
		if e.Node.Nickname != "" {
			out = append(out, RosterPlayer{ID: e.Node.ID, Nick: e.Node.Nickname})
		}
	}
	return out, nil
}

// PlayerStats is GRID's official aggregated statistics for one player over a
// time window (Statistics Feed — verified available on Open Access).
type PlayerStats struct {
	SeriesCount  int     `json:"seriesCount"`
	SeriesWinPct float64 `json:"seriesWinPct"`
	Maps         int     `json:"maps"`
	MapWinPct    float64 `json:"mapWinPct"`
	Kills        int     `json:"kills"`
	Deaths       int     `json:"deaths"`
	Assists      int     `json:"assists"`
	AvgKills     float64 `json:"avgKills"` // per map
	MaxKills     int     `json:"maxKills"`
	KD           float64 `json:"kd"`
	FirstKillPct float64 `json:"firstKillPct"` // % of maps with the first kill
	Rounds       int     `json:"rounds"`       // round segments played
	RoundWinPct  float64 `json:"roundWinPct"`  // % of rounds won
	KPR          float64 `json:"kpr"`          // kills per round
}

const playerStatsQuery = `query PlayerStats($pid: ID!, $w: TimeRangeFilter!) {
  playerStatistics(playerId: $pid, filter: { timeWindow: $w }) {
    series { count won { value count percentage } }
    game { count won { value count percentage } kills { sum avg max } deaths { sum avg }
      killAssistsReceived { sum } firstKill { value count percentage } }
    segment { type count won { value count percentage } }
  }
}`

// PlayerCareerStats fetches official aggregates for a player. window is a
// TimeRangeFilter enum name (LAST_3_MONTHS, LAST_YEAR, …). Returns nil (no
// error) when the player has no data in the window.
func (c *Client) PlayerCareerStats(ctx context.Context, playerID, window string) (*PlayerStats, error) {
	if err := c.statsLim.Wait(ctx); err != nil {
		return nil, err
	}
	body, err := c.postGraphQL(ctx, c.statsURL, playerStatsQuery, map[string]any{"pid": playerID, "w": window})
	if err != nil {
		return nil, err
	}
	type bucket struct {
		Value      bool    `json:"value"`
		Count      int     `json:"count"`
		Percentage float64 `json:"percentage"`
	}
	var resp struct {
		Data struct {
			PlayerStatistics *struct {
				Series struct {
					Count int      `json:"count"`
					Won   []bucket `json:"won"`
				} `json:"series"`
				Game struct {
					Count int      `json:"count"`
					Won   []bucket `json:"won"`
					Kills struct {
						Sum int     `json:"sum"`
						Avg float64 `json:"avg"`
						Max int     `json:"max"`
					} `json:"kills"`
					Deaths struct {
						Sum int     `json:"sum"`
						Avg float64 `json:"avg"`
					} `json:"deaths"`
					KillAssistsReceived struct {
						Sum int `json:"sum"`
					} `json:"killAssistsReceived"`
					FirstKill []bucket `json:"firstKill"`
				} `json:"game"`
				Segment []struct {
					Type  string   `json:"type"`
					Count int      `json:"count"`
					Won   []bucket `json:"won"`
				} `json:"segment"`
			} `json:"playerStatistics"`
		} `json:"data"`
	}
	if err := decodeGQL(body, &resp); err != nil {
		return nil, err
	}
	ps := resp.Data.PlayerStatistics
	if ps == nil || (ps.Game.Count == 0 && ps.Series.Count == 0) {
		return nil, nil
	}
	// buckets are unordered — select the value==true entry explicitly
	pct := func(bs []bucket) float64 {
		for _, b := range bs {
			if b.Value {
				return b.Percentage
			}
		}
		return 0
	}
	out := &PlayerStats{
		SeriesCount:  ps.Series.Count,
		SeriesWinPct: pct(ps.Series.Won),
		Maps:         ps.Game.Count,
		MapWinPct:    pct(ps.Game.Won),
		Kills:        ps.Game.Kills.Sum,
		Deaths:       ps.Game.Deaths.Sum,
		Assists:      ps.Game.KillAssistsReceived.Sum,
		AvgKills:     ps.Game.Kills.Avg,
		MaxKills:     ps.Game.Kills.Max,
		FirstKillPct: pct(ps.Game.FirstKill),
	}
	for _, seg := range ps.Segment {
		if seg.Type == "round" {
			out.Rounds = seg.Count
			out.RoundWinPct = pct(seg.Won)
		}
	}
	if out.Deaths > 0 {
		out.KD = float64(out.Kills) / float64(out.Deaths)
	} else {
		out.KD = float64(out.Kills)
	}
	if out.Rounds > 0 {
		out.KPR = float64(out.Kills) / float64(out.Rounds)
	}
	return out, nil
}

// pastWindow returns the [gte, lte] RFC3339 strings for "recent history": the
// last 120 days up to now.
func PastWindow(now time.Time) (string, string) {
	return now.Add(-120 * 24 * time.Hour).UTC().Format(time.RFC3339),
		now.UTC().Format(time.RFC3339)
}
