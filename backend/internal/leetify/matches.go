package leetify

// Match telemetry by share code.
//
// Since January 2026 Leetify's PROFILE endpoints answer only for accounts
// registered with them, which is roughly two thirds of the players people look
// up here. Their MATCH endpoints were never closed, and a match report carries
// a row for all ten players in the lobby — registration decides whose profile
// Leetify will serve, not whose data they collected. So a player Leetify will
// not describe directly can still be assembled from the matches they played,
// given the share codes.
//
// Share codes come from the game coordinator (a player's last ~8 matches, if
// their Steam game details are public) or from a third-party history. Both are
// keyed the same way here.
//
// Deliberate constraints, measured against the live API on 2026-08-25:
//
//   - Anonymous callers get exactly 10 requests per 60s per IP, with no
//     Retry-After and no rate headers. Hence the shared limiter below: this is
//     the whole process's budget, not per-request.
//   - A finished match never changes (byte-identical responses, stable weak
//     ETags) but conditional GETs are not honoured — no 304s. So a share code
//     is worth fetching exactly once, ever, and storing.
//   - Leetify's developer guidelines require attribution wherever this data is
//     shown, forbid rescaling or recalculating their metrics, and oblige us to
//     delete stored data that stops being available. Callers own those duties;
//     this package only fetches.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/time/rate"
)

// shareCodeRe matches Valve's share-code form, CSGO- plus five groups of five.
// Checked before spending a request: a malformed code cannot resolve, and the
// upstream answers 500 rather than 404 for a shape it does not recognise.
var shareCodeRe = regexp.MustCompile(`^CSGO(?:-[A-Za-z0-9]{5}){5}$`)

// ValidShareCode reports whether s is shaped like a Valve match share code.
func ValidShareCode(s string) bool { return shareCodeRe.MatchString(strings.TrimSpace(s)) }

// matchLimiter is the process-wide budget for match lookups.
//
// Measured ceiling is 10 requests per 60s per IP; this runs at 8/min with no
// burst so a page that fans out cannot spend the whole window in one go and
// leave the next visitor waiting a minute. It is package-level on purpose —
// the limit is enforced per IP upstream, so every Client on this box shares it.
var matchLimiter = rate.NewLimiter(rate.Every(time.Minute/8), 1)

// MatchPlayer is one player's row in a match report. Field names mirror
// Leetify's own so the values are never silently renamed or rescaled.
//
// Preaim, ReactionTime and AccuracyHead are the demo-derived tells that no
// scoreboard aggregator can supply, and the reason this endpoint is worth the
// trouble at all.
type MatchPlayer struct {
	Steam64ID string `json:"steam64_id"`
	Name      string `json:"name"`

	Preaim        float64 `json:"preaim"`        // degrees off target when a duel starts
	ReactionTime  float64 `json:"reaction_time"` // seconds
	AccuracyHead  float64 `json:"accuracy_head"` // share of HITS on the head
	Accuracy      float64 `json:"accuracy"`
	SprayAccuracy float64 `json:"spray_accuracy"`

	CounterStrafingGoodRatio float64 `json:"counter_strafing_shots_good_ratio"`

	LeetifyRating   float64 `json:"leetify_rating"`
	CTLeetifyRating float64 `json:"ct_leetify_rating"`
	TLeetifyRating  float64 `json:"t_leetify_rating"`

	TotalKills   int     `json:"total_kills"`
	TotalDeaths  int     `json:"total_deaths"`
	TotalAssists int     `json:"total_assists"`
	TotalHSKills int     `json:"total_hs_kills"`
	KDRatio      float64 `json:"kd_ratio"`
	DPR          float64 `json:"dpr"` // damage per round
	RoundsCount  int     `json:"rounds_count"`
	RoundsWon    int     `json:"rounds_won"`

	TradeKillsSuccessPct   float64 `json:"trade_kills_success_percentage"`
	TradedDeathsSuccessPct float64 `json:"traded_deaths_success_percentage"`
}

// Match is one match report: the ten rows plus enough context to date and
// attribute it.
type Match struct {
	ID                string        `json:"id"` // Leetify's own match id, for View-on-Leetify links
	FinishedAt        string        `json:"finished_at"`
	DataSource        string        `json:"data_source"`          // matchmaking | faceit | hltv
	DataSourceMatchID string        `json:"data_source_match_id"` // the share code, for matchmaking
	MapName           string        `json:"map_name"`
	HasBannedPlayer   bool          `json:"has_banned_player"`
	TeamScores        []TeamScore   `json:"team_scores"`
	Stats             []MatchPlayer `json:"stats"`
}

// TeamScore is one side's final score. Sides are identified by Source's team
// numbers (2 = T, 3 = CT), not by index.
type TeamScore struct {
	TeamNumber int `json:"team_number"`
	Score      int `json:"score"`
}

// Scoreline returns the two scores highest first, or 0,0 when absent.
func (m *Match) Scoreline() (int, int) {
	if len(m.TeamScores) < 2 {
		return 0, 0
	}
	a, b := m.TeamScores[0].Score, m.TeamScores[1].Score
	if b > a {
		return b, a
	}
	return a, b
}

// Player returns the row for one SteamID64. A match we fetched for one player
// carries the other nine as well, so callers should store every row rather
// than discarding the rest of the lobby.
func (m *Match) Player(steam64 uint64) (*MatchPlayer, bool) {
	want := strconv.FormatUint(steam64, 10)
	for i := range m.Stats {
		if m.Stats[i].Steam64ID == want {
			return &m.Stats[i], true
		}
	}
	return nil, false
}

// FinishedTime parses FinishedAt, or the zero time when it is absent/unparseable.
func (m *Match) FinishedTime() time.Time {
	t, err := time.Parse(time.RFC3339, m.FinishedAt)
	if err != nil {
		return time.Time{}
	}
	return t
}

// MatchByShareCode fetches the match report for a Valve share code.
//
// Returns ErrNotFound when Leetify has no report for it — which happens when
// nobody in that lobby was a Leetify user, so the match was never processed.
// That is a normal answer, not a failure: roughly one match in twenty on the
// sample measured so far.
func (c *Client) MatchByShareCode(ctx context.Context, shareCode string) (*Match, error) {
	code := strings.TrimSpace(shareCode)
	if !ValidShareCode(code) {
		return nil, fmt.Errorf("leetify: malformed share code")
	}
	return c.match(ctx, "/v2/matches/matchmaking/"+url.PathEscape(code))
}

// MatchByID fetches a match report by Leetify's own match id.
func (c *Client) MatchByID(ctx context.Context, matchID string) (*Match, error) {
	id := strings.TrimSpace(matchID)
	if id == "" || strings.ContainsAny(id, "/?#") {
		return nil, fmt.Errorf("leetify: malformed match id")
	}
	return c.match(ctx, "/v2/matches/"+url.PathEscape(id))
}

func (c *Client) match(ctx context.Context, path string) (*Match, error) {
	// Wait for budget BEFORE the request. A 429 here costs the same minute as
	// waiting politely, and burning the window makes every other caller wait.
	if err := matchLimiter.Wait(ctx); err != nil {
		return nil, err
	}
	req, err := c.newReq(ctx, c.baseURL+path)
	if err != nil {
		return nil, err
	}
	resp, err := c.doWithRetry(req)
	if err != nil {
		return nil, fmt.Errorf("leetify: match request failed: %w", err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case 200:
		var m Match
		if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
			return nil, fmt.Errorf("leetify: decode match: %w", err)
		}
		if len(m.Stats) == 0 {
			return nil, ErrNotFound
		}
		return &m, nil
	case 404:
		return nil, ErrNotFound
	case 500:
		// The route is generic and unguarded upstream: a code Leetify has no
		// record of comes back as a 500 rather than a 404. Treat it as absent,
		// not as an outage to retry — retrying only spends the rate budget.
		return nil, ErrNotFound
	default:
		return nil, fmt.Errorf("leetify: match: unexpected status %d", resp.StatusCode)
	}
}

// newTestLimiter returns an unrestricted limiter. Tests swap it in so they do
// not wait on the real 8/min budget.
func newTestLimiter() *rate.Limiter { return rate.NewLimiter(rate.Inf, 1) }
