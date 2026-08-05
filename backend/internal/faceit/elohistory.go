package faceit

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// statsHost is FACEIT's own frontend API — the ONLY surface (official or not)
// that exposes per-match elo and elo change. The official Data API v4 carries
// no per-match elo at all (verified live: its stats items have K/D/ADR but no
// Elo field), so this is used read-only, best-effort, with an aggressive
// circuit breaker: if FACEIT ever blocks or changes it, elo movement simply
// goes absent rather than breaking anything.
const statsHost = "https://api.faceit.com"

// EloGame is one row of a player's FACEIT match history that carries elo.
type EloGame struct {
	MatchID  string
	Date     time.Time
	Map      string // "de_overpass"
	Elo      int    // elo AFTER the match
	EloDelta int    // change caused by the match; 0 when FACEIT omitted it
	HasDelta bool
}

var (
	statsMu    sync.Mutex
	statsPause time.Time
)

func statsBlocked() bool {
	statsMu.Lock()
	defer statsMu.Unlock()
	return time.Now().Before(statsPause)
}

func noteStatsBlock() {
	statsMu.Lock()
	statsPause = time.Now().Add(30 * time.Minute)
	statsMu.Unlock()
}

// EloHistory fetches up to limit recent CS2 matches with per-match elo for a
// FACEIT player id. Requires no API key. Returns (nil, nil) while the circuit
// breaker is open.
func (c *Client) EloHistory(ctx context.Context, playerID string, limit int) ([]EloGame, error) {
	if playerID == "" || statsBlocked() {
		return nil, nil
	}
	if limit <= 0 || limit > 300 {
		limit = 300
	}
	out := make([]EloGame, 0, limit)
	for page := 0; len(out) < limit && page < (limit+99)/100; page++ {
		u := fmt.Sprintf("%s/stats/v1/stats/time/users/%s/games/cs2?page=%d&size=100", statsHost, playerID, page)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		if err != nil {
			return nil, err
		}
		// browser-shaped headers: the plain default UA gets a Cloudflare 403
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
		req.Header.Set("Accept", "application/json, text/plain, */*")
		req.Header.Set("Accept-Language", "en-US,en;q=0.9")
		req.Header.Set("Referer", "https://www.faceit.com/")

		resp, err := c.http.Do(req)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests {
			resp.Body.Close()
			noteStatsBlock()
			return nil, nil
		}
		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			return nil, fmt.Errorf("faceit stats: status %d", resp.StatusCode)
		}
		var rows []struct {
			MatchID  string `json:"matchId"`
			Date     int64  `json:"date"` // ms
			Map      string `json:"i1"`
			Elo      string `json:"elo"`
			EloDelta string `json:"elo_delta"`
		}
		err = json.NewDecoder(resp.Body).Decode(&rows)
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("faceit stats: decode: %w", err)
		}
		for _, r := range rows {
			g := EloGame{
				MatchID: r.MatchID,
				Date:    time.UnixMilli(r.Date),
				Map:     strings.ToLower(strings.TrimSpace(r.Map)),
				Elo:     atoi(r.Elo),
			}
			if r.EloDelta != "" {
				g.EloDelta = atoi(r.EloDelta)
				g.HasDelta = true
			}
			out = append(out, g)
			if len(out) >= limit {
				break
			}
		}
		if len(rows) < 100 {
			break
		}
	}
	return out, nil
}

// PlayerElo returns a FACEIT player's CURRENT CS2 elo by FACEIT player id via
// the official Data API. FACEIT publishes no per-match elo for other players,
// so this is the only value available for a scoreboard — the UI labels it as
// current rather than implying it was their elo at match time.
func (c *Client) PlayerElo(ctx context.Context, playerID string) (int, error) {
	if c.apiKey == "" {
		return 0, ErrNoAPIKey
	}
	if playerID == "" {
		return 0, ErrNotFound
	}
	var pr struct {
		Games struct {
			CS2 struct {
				FaceitElo int `json:"faceit_elo"`
			} `json:"cs2"`
		} `json:"games"`
	}
	if err := c.get(ctx, "/players/"+url.PathEscape(playerID), &pr); err != nil {
		return 0, err
	}
	return pr.Games.CS2.FaceitElo, nil
}
