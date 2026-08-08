package faceit

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/cs2tracker/server/internal/stats"
)

// Per-match statistics from the official Data API v4. This is the only source
// we have for ADR, kills-per-round and assists: FACEIT's frontend stat rows are
// positional and undocumented (i1/i6/i8/i10 are the only slots confirmed live),
// and guessing at the rest would print plausible but WRONG numbers, which for a
// stats tool is worse than printing nothing. The Data API names its fields.
//
// It takes two calls to get there, because v4 has no "recent stats for a
// player" endpoint — an earlier version of this file invented one, and every
// column it fed sat empty in production without a word in the logs. The
// documented route is:
//
//	GET /players/{id}/history?game=cs2   -> the match ids
//	GET /matches/{id}/stats              -> the scoreboard for one match
//
// so the cost is 1 + sample calls per player. That is why only a SAMPLE of
// recent matches is read rather than all thirty, why a finished match's board
// is cached for the life of the process (a played match never changes), and
// why the sample size travels with the numbers instead of being implied.

const (
	// Matches sampled per player. Each is a separate upstream call, so this
	// trades precision for a request budget that survives a ten-player room.
	recentSample = 5
	// Concurrent per-match fetches for one player.
	recentWorkers = 3
)

// RecentStats is a player's aggregate over their last few CS2 matches.
type RecentStats struct {
	// Matches is the SAMPLE size, not their match count — the caller reports
	// it so nobody reads a five-match average as a career figure.
	Matches    int     `json:"matches"`
	Kills      float64 `json:"kills"` // per match
	Deaths     float64 `json:"deaths"`
	Assists    float64 `json:"assists"`
	KD         float64 `json:"kd"`
	KR         float64 `json:"kr"` // kills per round
	ADR        float64 `json:"adr"`
	HSPct      float64 `json:"hsPct"`
	WinRatePct float64 `json:"winRatePct"`
	// Rating is HLTV Rating 1.0, computed with the same function the rest of
	// CSRun uses. Zero when FACEIT withheld the multi-kill columns it needs —
	// the formula is exact or it is absent, never approximated.
	Rating float64 `json:"rating"`
}

type historyResp struct {
	Items []struct {
		MatchID string `json:"match_id"`
	} `json:"items"`
}

// /matches/{id}/stats — a scoreboard, nested rounds > teams > players.
type matchStatsResp struct {
	Rounds []struct {
		RoundStats map[string]string `json:"round_stats"`
		Teams      []struct {
			Players []struct {
				PlayerID string            `json:"player_id"`
				Stats    map[string]string `json:"player_stats"`
			} `json:"players"`
		} `json:"teams"`
	} `json:"rounds"`
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

// A finished match's scoreboard never changes, so it is cached on the client.
// Players in a room who queue together share matches, and without this each of
// them would refetch the same boards.
func (c *Client) matchBoard(ctx context.Context, matchID string) (*matchStatsResp, error) {
	c.boardMu.Lock()
	if b, ok := c.boardCache[matchID]; ok {
		c.boardMu.Unlock()
		return b, nil
	}
	c.boardMu.Unlock()

	var b matchStatsResp
	if err := c.get(ctx, "/matches/"+url.PathEscape(matchID)+"/stats", &b); err != nil {
		return nil, err
	}

	c.boardMu.Lock()
	if c.boardCache == nil {
		c.boardCache = map[string]*matchStatsResp{}
	}
	if len(c.boardCache) > 4000 { // crude ceiling, cleared wholesale
		c.boardCache = map[string]*matchStatsResp{}
	}
	c.boardCache[matchID] = &b
	c.boardMu.Unlock()
	return &b, nil
}

// RecentMatchStats aggregates a sample of a player's recent CS2 matches.
// Returns (nil, nil) when they have no readable history — an empty record is
// not an error. Requires an API key.
func (c *Client) RecentMatchStats(ctx context.Context, playerID string, limit int) (*RecentStats, error) {
	if c.apiKey == "" {
		return nil, ErrNoAPIKey
	}
	if playerID == "" {
		return nil, ErrNotFound
	}
	if limit <= 0 || limit > recentSample {
		limit = recentSample
	}

	q := url.Values{}
	q.Set("game", "cs2")
	q.Set("offset", "0")
	q.Set("limit", strconv.Itoa(limit))

	var hist historyResp
	if err := c.get(ctx, "/players/"+url.PathEscape(playerID)+"/history?"+q.Encode(), &hist); err != nil {
		return nil, fmt.Errorf("faceit history: %w", err)
	}
	if len(hist.Items) == 0 {
		// Not an error, but it IS the difference between "this player has no
		// history" and "we are asking the wrong question". Logged with the
		// distinction, because silence here looked identical to success.
		slog.Warn("faceit history returned no matches", "player", playerID)
		return nil, nil
	}

	type row struct {
		stats map[string]string
		round map[string]string
	}
	rows := make([]row, len(hist.Items))

	var wg sync.WaitGroup
	sem := make(chan struct{}, recentWorkers)
	for i, it := range hist.Items {
		if it.MatchID == "" {
			continue
		}
		wg.Add(1)
		go func(i int, mid string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			b, err := c.matchBoard(ctx, mid)
			if err != nil || b == nil {
				return // one unreadable board must not lose the others
			}
			for _, r := range b.Rounds {
				for _, t := range r.Teams {
					for _, p := range t.Players {
						if p.PlayerID == playerID && len(p.Stats) > 0 {
							rows[i] = row{stats: p.Stats, round: r.RoundStats}
							return
						}
					}
				}
			}
		}(i, it.MatchID)
	}
	wg.Wait()

	out := &RecentStats{}
	var kills, deaths, assists, rounds, adrSum, hsSum, wins float64
	var adrN, hsN, winN float64
	// Rounds with exactly N kills, for Rating 1.0. Every kill belongs to a
	// round classified by its kill count, so single-kill rounds follow from
	// the rest: k1 = kills - 2*k2 - 3*k3 - 4*k4 - 5*k5.
	var k2, k3, k4, k5, ratedRounds, ratedKills, ratedDeaths float64
	multiOK := true
	// kills counted ONLY from matches that also reported rounds — mixing kills
	// from roundless matches into the numerator inflates kills-per-round.
	var killsWithRounds float64

	for _, r := range rows {
		s := r.stats
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
		if w, ok := firstNum(s, "Result"); ok {
			winN++
			if w == 1 {
				wins++
			}
		}
		if h, ok := firstNum(s, "Headshots %"); ok {
			hsSum += h
			hsN++
		}
		if a, ok := firstNum(s, "ADR", "Average Damage per Round"); ok && a > 0 {
			adrSum += a
			adrN++
		}
		// Rounds live on the round_stats block, not the player's row.
		rd, okR := firstNum(r.round, "Rounds")
		if !okR {
			rd, okR = firstNum(s, "Rounds", "Rounds Played")
		}
		if okR && rd > 0 {
			rounds += rd
			killsWithRounds += k
			d2, ok2 := firstNum(s, "Double Kills")
			t3, ok3 := firstNum(s, "Triple Kills")
			q4, ok4 := firstNum(s, "Quadro Kills")
			p5, ok5 := firstNum(s, "Penta Kills")
			if ok2 && ok3 && ok4 && ok5 {
				k2 += d2
				k3 += t3
				k4 += q4
				k5 += p5
				ratedRounds += rd
				ratedKills += k
				ratedDeaths += d
			} else {
				multiOK = false
			}
		}
	}
	if out.Matches == 0 {
		// Boards came back but none of them yielded a usable row for this
		// player. That is either a player_id that never appears on the board,
		// or stat keys that are not named what we expect — and the two are
		// told apart by whether ANY row was found at all. The key names of the
		// first row we did see settle it in one look.
		var found int
		var sample []string
		for _, r := range rows {
			if len(r.stats) == 0 {
				continue
			}
			found++
			if sample == nil {
				for k := range r.stats {
					sample = append(sample, k)
				}
				sort.Strings(sample)
			}
		}
		slog.Warn("faceit per-match stats unusable",
			"player", playerID,
			"historyItems", len(hist.Items),
			"rowsMatchingPlayer", found,
			"firstRowKeys", strings.Join(sample, ","))
		return nil, nil
	}

	n := float64(out.Matches)
	out.Kills = kills / n
	out.Deaths = deaths / n
	out.Assists = assists / n
	if deaths > 0 {
		out.KD = kills / deaths
	}
	// Only report the rates we actually have values for — averaging a present
	// value across absent ones would understate every one of them.
	if winN > 0 {
		out.WinRatePct = wins / winN * 100
	}
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
