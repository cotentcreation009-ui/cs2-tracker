package faceit

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/cs2tracker/server/internal/stats"
)

// Per-match statistics from the official Data API v4. This is the only source
// we have for ADR, kills-per-round and assists: FACEIT's frontend stats rows
// are positional and undocumented (i1/i6/i8/i10 are the only slots confirmed
// live), and guessing at the rest would print plausible but wrong numbers,
// which for a stats tool is worse than printing nothing. The Data API names
// its fields, so this is verifiable.
//
// The catch is the mirror image of elohistory.go: the Data API carries no
// per-match elo, and the frontend API carries no ADR. Each is used for what it
// actually has.

// RecentStats is a player's aggregate over their last N CS2 matches.
type RecentStats struct {
	Matches    int
	Kills      float64 // per match
	Deaths     float64 // per match
	Assists    float64 // per match
	KD         float64
	KR         float64 // kills per round
	ADR        float64
	HSPct      float64
	WinRatePct float64
	// HLTV Rating 1.0, computed with the same function the rest of CSRun uses.
	// Zero when FACEIT withheld the multi-kill columns it needs — the formula
	// is exact or it is absent, never approximated.
	Rating float64
}

// statsItem is one match in the Data API's stats feed. Every value arrives as
// a string, and the key set differs between CS:GO-era and CS2 matches, so each
// field is looked up under the names FACEIT has actually used.
type statsItem struct {
	Stats map[string]string `json:"stats"`
}

// name kept distinct from statsResp in faceit.go, which is the LIFETIME shape
type matchStatsResp struct {
	Items []statsItem `json:"items"`
}

// firstNum returns the first key that is present and parses as a number.
func firstNum(m map[string]string, keys ...string) (float64, bool) {
	for _, k := range keys {
		v, ok := m[k]
		if !ok || strings.TrimSpace(v) == "" {
			continue
		}
		f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
		if err == nil {
			return f, true
		}
	}
	return 0, false
}

// RecentMatchStats aggregates a player's last `limit` CS2 matches. Returns
// (nil, nil) when the player has no rated CS2 history — an empty record is not
// an error. Requires an API key.
func (c *Client) RecentMatchStats(ctx context.Context, playerID string, limit int) (*RecentStats, error) {
	if c.apiKey == "" {
		return nil, ErrNoAPIKey
	}
	if playerID == "" {
		return nil, ErrNotFound
	}
	if limit <= 0 || limit > 100 {
		limit = 30
	}

	q := url.Values{}
	q.Set("offset", "0")
	q.Set("limit", strconv.Itoa(limit))

	var resp matchStatsResp
	path := fmt.Sprintf("/players/%s/games/cs2/stats?%s", url.PathEscape(playerID), q.Encode())
	if err := c.get(ctx, path, &resp); err != nil {
		return nil, err
	}
	if len(resp.Items) == 0 {
		return nil, nil
	}

	out := &RecentStats{}
	var kills, deaths, assists, rounds, adrSum, hsSum, wins float64
	var adrN, hsN float64
	// Rounds with exactly N kills, for Rating 1.0. Every kill belongs to a
	// round classified by its kill count, so single-kill rounds follow from
	// the rest: k1 = kills - 2*k2 - 3*k3 - 4*k4 - 5*k5.
	var k2, k3, k4, k5, ratedRounds, ratedKills, ratedDeaths float64
	multiOK := true
	// kills counted ONLY from rows that also reported rounds — mixing kills
	// from roundless rows into the numerator inflates kills-per-round, which
	// is exactly what the test caught.
	var killsWithRounds float64

	for _, it := range resp.Items {
		s := it.Stats
		if len(s) == 0 {
			continue
		}
		k, okK := firstNum(s, "Kills")
		d, okD := firstNum(s, "Deaths")
		if !okK || !okD {
			continue
		}
		out.Matches++
		kills += k
		deaths += d
		if a, ok := firstNum(s, "Assists"); ok {
			assists += a
		}
		// FACEIT has shipped this as "Rounds" and, on CS2 items, as
		// "Rounds Played"; either is fine, neither is guessed at.
		if r, ok := firstNum(s, "Rounds", "Rounds Played"); ok && r > 0 {
			rounds += r
			killsWithRounds += k
		}
		if a, ok := firstNum(s, "ADR", "Average Damage per Round"); ok && a > 0 {
			adrSum += a
			adrN++
		}
		if r, ok := firstNum(s, "Rounds", "Rounds Played"); ok && r > 0 {
			d2, ok2 := firstNum(s, "Double Kills")
			t3, ok3 := firstNum(s, "Triple Kills")
			q4, ok4 := firstNum(s, "Quadro Kills")
			p5, ok5 := firstNum(s, "Penta Kills")
			if ok2 && ok3 && ok4 && ok5 {
				k2 += d2
				k3 += t3
				k4 += q4
				k5 += p5
				ratedRounds += r
				ratedKills += k
				ratedDeaths += d
			} else {
				multiOK = false
			}
		}
		if h, ok := firstNum(s, "Headshots %"); ok {
			hsSum += h
			hsN++
		}
		if w, ok := firstNum(s, "Result"); ok && w == 1 {
			wins++
		}
	}
	if out.Matches == 0 {
		return nil, nil
	}

	n := float64(out.Matches)
	out.Kills = kills / n
	out.Deaths = deaths / n
	out.Assists = assists / n
	out.WinRatePct = wins / n * 100
	if deaths > 0 {
		out.KD = kills / deaths
	}
	// Only report the rates we actually have rounds/values for — averaging a
	// present value across absent ones would understate every one of them.
	if rounds > 0 {
		out.KR = killsWithRounds / rounds
	}
	if adrN > 0 {
		out.ADR = adrSum / adrN
	}
	if hsN > 0 {
		out.HSPct = hsSum / hsN
	}
	if multiOK && ratedRounds > 0 {
		k1 := ratedKills - 2*k2 - 3*k3 - 4*k4 - 5*k5
		if k1 >= 0 {
			out.Rating = stats.Rating1(
				int(ratedKills), int(ratedDeaths), int(ratedRounds),
				int(k1), int(k2), int(k3), int(k4), int(k5),
			)
		}
	}
	return out, nil
}
