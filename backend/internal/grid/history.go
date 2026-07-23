package grid

import (
	"context"
	"fmt"
	"time"
)

// PastSeries is a lightweight Central-Data record of a past series (identity +
// schedule only; results come from SeriesResult).
type PastSeries struct {
	ID          string `json:"id"`
	StartTime   string `json:"startTime"`
	FormatShort string `json:"formatShort"`
	Teams       []Team `json:"teams"`
}

// SeriesResultTeam is one team's final line in a series result.
type SeriesResultTeam struct {
	GridID string `json:"gridId"`
	Name   string `json:"name"`
	Score  int    `json:"score"`
	Won    bool   `json:"won"`
}

// SeriesResult is the outcome of a (finished) series — maps won per team.
type SeriesResult struct {
	Finished bool               `json:"finished"`
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
      teams { baseInfo { id name nameShortened logoUrl colorPrimary colorSecondary } }
    } }
  }
}`, titleID)
}

const seriesResultQuery = `query SeriesResult($id: ID!) {
  seriesState(id: $id) { finished teams { id name score won } }
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
	for _, t := range ss.Teams {
		res.Teams = append(res.Teams, SeriesResultTeam{GridID: t.ID, Name: t.Name, Score: t.Score, Won: t.Won})
	}
	return res, nil
}

// pastWindow returns the [gte, lte] RFC3339 strings for "recent history": the
// last 120 days up to now.
func PastWindow(now time.Time) (string, string) {
	return now.Add(-120 * 24 * time.Hour).UTC().Format(time.RFC3339),
		now.UTC().Format(time.RFC3339)
}
