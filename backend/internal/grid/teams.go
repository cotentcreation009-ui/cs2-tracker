package grid

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// NamedTeam is the minimum GRID knows about an org: who they are, and the id
// everything else in this package is keyed by.
type NamedTeam struct {
	GridID string `json:"gridId"`
	Name   string `json:"name"`
}

// TeamsByName looks an org up in Central Data by name.
//
// This exists because the team index can otherwise only learn an id by seeing
// a side actually play: a top-20 team between events had no id, so its card
// linked nowhere. GRID documents this query for exactly this purpose.
//
// Deliberately selects {id name} only. The logo and colour fields are real on
// the team object we get through allSeries, but nothing public confirms they
// are selectable on this connection, and an unknown field fails the WHOLE
// query rather than returning a partial one. An id is all a link needs.
//
// The filter is a SUBSTRING match, so "Spirit" also returns "Spirit Academy" —
// callers must pick the right row rather than trusting the first.
func (c *Client) TeamsByName(ctx context.Context, name string) ([]NamedTeam, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, nil
	}
	// Inside the limiter, like every other Central call: this runs in the
	// background behind the spotlight and must not burst the poller past the
	// shared ~20/min ceiling.
	if err := c.centralLim.Wait(ctx); err != nil {
		return nil, err
	}
	// titleId is trusted-internal and interpolated like the schedule query
	// does; the name is caller-supplied and stays a variable. Without the
	// title filter, "Falcons" collides with their LoL and Valorant sides.
	// first: 50 is the documented maximum — the default of 10 silently
	// truncates, and a common substring can bury the real org past it.
	query := fmt.Sprintf(`query TeamByName($name: String!) {
  teams(first: 50, filter: { name: { contains: $name }, titleId: %q }) {
    edges { node { id name } }
  }
}`, c.getTitleID())

	body, err := c.postGraphQL(ctx, c.centralURL, query, map[string]any{"name": name})
	if err != nil {
		return nil, err
	}
	var resp struct {
		Data struct {
			Teams struct {
				Edges []struct {
					Node struct {
						ID   string `json:"id"`
						Name string `json:"name"`
					} `json:"node"`
				} `json:"edges"`
			} `json:"teams"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("grid: decode teams: %w", err)
	}
	out := make([]NamedTeam, 0, len(resp.Data.Teams.Edges))
	for _, e := range resp.Data.Teams.Edges {
		if e.Node.ID != "" && e.Node.Name != "" {
			out = append(out, NamedTeam{GridID: e.Node.ID, Name: e.Node.Name})
		}
	}
	return out, nil
}
