package faceit

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strconv"
	"strings"
)

// FACEIT's public CS2 leaderboard:
//
//	GET /rankings/games/cs2/regions/{region}?offset=0&limit=N
//
// This is the one FACEIT surface that answers "who is actually at the top right
// now" without a player id to start from. It has NOT been exercised against the
// live API from a dev machine (no key here), so everything below assumes the
// documented shape is approximately right and refuses to guess when it isn't:
// a row we cannot read is dropped, never emitted half-filled. A leaderboard
// showing "0 elo" next to real numbers is worse than a shorter leaderboard.

// ErrBadRegion means the caller asked for a region FACEIT does not publish a
// ranking for. Exported so the HTTP layer can answer 400 rather than 500 —
// this is the one failure here caused by the request, not by FACEIT.
var ErrBadRegion = errors.New("faceit: unknown region")

// The regions FACEIT publishes CS2 rankings for. This doubles as the allowlist:
// the value that reaches the URL is always the constant from this table, never
// the caller's string, so nothing user-supplied can steer the path.
var rankingRegions = map[string]string{
	"EU":  "EU",
	"NA":  "NA",
	"SA":  "SA",
	"AS":  "AS",
	"OCE": "OCE",
}

// defaultRankingRegion is what an unspecified region means. EU is FACEIT's
// largest CS2 region by some distance, so it is the least surprising default.
const defaultRankingRegion = "EU"

// maxRankingLimit is FACEIT's page cap for this endpoint; asking for more is an
// error upstream rather than a bigger page.
const maxRankingLimit = 100

// RankedPlayer is one row of the FACEIT CS2 leaderboard.
type RankedPlayer struct {
	PlayerID   string `json:"playerId"`
	Nickname   string `json:"nickname"`
	Country    string `json:"country"`
	Position   int    `json:"position"`
	Elo        int    `json:"elo"`
	SkillLevel int    `json:"skillLevel"`
	Avatar     string `json:"avatar,omitempty"`
	FaceitURL  string `json:"faceitUrl,omitempty"`
}

// rankingsResp mirrors the documented payload. Each numeric field is listed
// under every name FACEIT plausibly uses, because a rename upstream should cost
// one column rather than the whole page.
type rankingsResp struct {
	Start int           `json:"start"`
	Items []rankingItem `json:"items"`
}

type rankingItem struct {
	PlayerID string `json:"player_id"`
	ID       string `json:"id"` // alternate spelling seen on other v4 collections
	Nickname string `json:"nickname"`
	Country  string `json:"country"`

	// Undocumented on this collection, but FACEIT returns an avatar on every
	// other player-shaped payload. Read it if it is there and ignore it if it
	// is not — a portrait is the difference between a card and a coloured box.
	Avatar string `json:"avatar"`

	Position  flexInt `json:"position"`
	FaceitElo flexInt `json:"faceit_elo"`
	Elo       flexInt `json:"elo"`
	GameSkill flexInt `json:"game_skill_level"`
	Skill     flexInt `json:"skill_level"`
}

// flexInt accepts a JSON number OR a quoted one. Every other FACEIT stat
// surface we read hands back its numbers as strings (see statsResp), and this
// endpoint is unverified from here — decoding straight into int would fail the
// entire page over a single quoted value. Anything unparseable stays zero and
// is caught by the row checks below instead of aborting the decode.
type flexInt int

func (f *flexInt) UnmarshalJSON(b []byte) error {
	s := strings.TrimSpace(strings.Trim(strings.TrimSpace(string(b)), `"`))
	if s == "" || s == "null" {
		return nil
	}
	if n, err := strconv.Atoi(s); err == nil {
		*f = flexInt(n)
		return nil
	}
	if v, err := strconv.ParseFloat(s, 64); err == nil {
		*f = flexInt(v)
	}
	return nil
}

// Rankings returns the top players of a FACEIT CS2 region, best first. region
// is one of EU, NA, SA, AS, OCE (empty means EU); limit is clamped to 1..100.
// Rows FACEIT returns in a shape we cannot read are skipped rather than
// emitted with zeroes, so a short list means "this is what was legible".
func (c *Client) Rankings(ctx context.Context, region string, limit int) ([]RankedPlayer, error) {
	if c.apiKey == "" {
		return nil, ErrNoAPIKey
	}
	want := strings.ToUpper(strings.TrimSpace(region))
	if want == "" {
		want = defaultRankingRegion
	}
	code, ok := rankingRegions[want]
	if !ok {
		return nil, fmt.Errorf("%w %q (want one of AS, EU, NA, OCE, SA)", ErrBadRegion, region)
	}
	if limit < 1 {
		limit = 1
	}
	if limit > maxRankingLimit {
		limit = maxRankingLimit
	}

	q := url.Values{}
	q.Set("offset", "0")
	q.Set("limit", strconv.Itoa(limit))

	var rr rankingsResp
	if err := c.get(ctx, "/rankings/games/cs2/regions/"+code+"?"+q.Encode(), &rr); err != nil {
		return nil, err
	}

	out := make([]RankedPlayer, 0, len(rr.Items))
	var dropped int
	for i, it := range rr.Items {
		// No nickname means no player we can name or link — the row would
		// render as an anonymous gap in the table.
		if it.Nickname = strings.TrimSpace(it.Nickname); it.Nickname == "" {
			dropped++
			continue
		}
		elo := int(it.FaceitElo)
		if elo == 0 {
			elo = int(it.Elo)
		}
		// Elo IS the ranking. A zero here means the field was renamed or
		// withheld, and printing "0 elo" beside 3800 reads as a real number.
		if elo <= 0 {
			dropped++
			continue
		}
		skill := int(it.GameSkill)
		if skill == 0 {
			skill = int(it.Skill)
		}
		id := it.PlayerID
		if id == "" {
			id = it.ID
		}
		pos := int(it.Position)
		if pos <= 0 {
			// Derived from the payload itself, not invented: the endpoint
			// returns a rank-ordered page beginning at start, so a row's
			// position is where it sits in that order.
			pos = rr.Start + i + 1
		}
		out = append(out, RankedPlayer{
			PlayerID:   id,
			Nickname:   it.Nickname,
			Country:    strings.ToLower(strings.TrimSpace(it.Country)),
			Avatar:     strings.TrimSpace(it.Avatar),
			Position:   pos,
			Elo:        elo,
			SkillLevel: skill,
			// PathEscape, because nicknames legitimately contain spaces, "#"
			// and "/" — all of which silently break the link unescaped.
			FaceitURL: "https://www.faceit.com/en/players/" + url.PathEscape(it.Nickname),
		})
	}
	if dropped > 0 {
		// Logged rather than swallowed: if FACEIT renames a field, a quietly
		// short leaderboard looks exactly like a quiet region. GetProfile's
		// recent-stats block learned that the expensive way.
		slog.Warn("faceit rankings: unreadable rows skipped",
			"region", code, "dropped", dropped, "kept", len(out))
	}
	return out, nil
}
