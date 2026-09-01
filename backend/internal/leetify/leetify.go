// Package leetify is a small client for Leetify's public CS API
// (https://api-public.cs-prod.leetify.com). It fetches a player's profile by
// SteamID64 — Leetify-computed ratings and stats derived from their own demo
// corpus, so we can show real matchmaking/Premier numbers for accounts we have
// not parsed ourselves.
//
// Per Leetify's developer guidelines the data is fetched live (never stored),
// presented as-is, and surfaced with attribution in the UI.
package leetify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ErrNotFound means Leetify has no (public) profile for the SteamID.
var ErrNotFound = errors.New("leetify: profile not found")

// maxRecentMatches caps the recent-match list we surface. Kept generous so the
// Premier-vs-FACEIT split can find a player's FACEIT games even when they last
// queued it a while back (they may sit deep in a Premier-heavy history).
const maxRecentMatches = 200

// Client talks to the Leetify public API.
type Client struct {
	baseURL   string
	legacyURL string // legacy fallback host (api.leetify.com)
	apiKey    string // optional; self-serve keys raise the rate tier
	http      *http.Client
}

// Option customises a Client.
type Option func(*Client)

// WithHTTPClient injects a custom HTTP client (used in tests).
func WithHTTPClient(h *http.Client) Option { return func(c *Client) { c.http = h } }

// WithLegacyURL overrides the legacy fallback host (used in tests).
func WithLegacyURL(u string) Option {
	return func(c *Client) { c.legacyURL = strings.TrimRight(u, "/") }
}

// New builds a Client. baseURL defaults are set by the caller from config.
func New(baseURL, apiKey string, opts ...Option) *Client {
	c := &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		// The site's own internal host. api.leetify.com — the old default —
		// was an undocumented alias Leetify shut off without notice on
		// 2026-09-01; this host serves the same legacy routes and is what
		// their match pages themselves call.
		legacyURL: "https://api.cs-prod.leetify.com",
		apiKey:    apiKey,
		http:      &http.Client{Timeout: 10 * time.Second},
	}
	for _, o := range opts {
		o(c)
	}
	return c
}

// newReq builds an authenticated GET. Leetify runs a self-serve key programme
// (leetify.com/app/developer); their spec takes the raw key as the value of
// either the Authorization or _leetify_key header — NOT a Bearer token. Keyless
// still works, on a stricter per-IP rate tier.
func (c *Client) newReq(ctx context.Context, u string) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	if c.apiKey != "" {
		req.Header.Set("_leetify_key", c.apiKey)
	}
	return req, nil
}

// Rating is Leetify's skill-rating breakdown (their metric, shown as-is).
type Rating struct {
	Aim         float64 `json:"aim"`
	Positioning float64 `json:"positioning"`
	Utility     float64 `json:"utility"`
	Clutch      float64 `json:"clutch"`
	Opening     float64 `json:"opening"`
	CTLeetify   float64 `json:"ct_leetify"`
	TLeetify    float64 `json:"t_leetify"`
}

// Stats is a curated subset of Leetify's aim/utility/trading micro-stats.
type Stats struct {
	AccuracyHead            float64 `json:"accuracy_head"`
	AccuracyEnemySpotted    float64 `json:"accuracy_enemy_spotted"`
	Preaim                  float64 `json:"preaim"`
	ReactionTimeMs          float64 `json:"reaction_time_ms"`
	SprayAccuracy           float64 `json:"spray_accuracy"`
	CounterStrafingRatio    float64 `json:"counter_strafing_good_shots_ratio"`
	CTOpeningDuelSuccessPct float64 `json:"ct_opening_duel_success_percentage"`
	TOpeningDuelSuccessPct  float64 `json:"t_opening_duel_success_percentage"`
	TradeKillsSuccessPct    float64 `json:"trade_kills_success_percentage"`
	TradedDeathsSuccessPct  float64 `json:"traded_deaths_success_percentage"`
	TradeKillOppsPerRound   float64 `json:"trade_kill_opportunities_per_round"`
	FlashbangHitFoePerFlash float64 `json:"flashbang_hit_foe_per_flashbang"`
	FlashbangLeadingToKill  float64 `json:"flashbang_leading_to_kill"`
	HEFoesDamageAvg         float64 `json:"he_foes_damage_avg"`
	UtilityOnDeathAvg       float64 `json:"utility_on_death_avg"`
}

// RecentMatch is one row of Leetify's recent-match list (most recent first).
// The per-match aim/mechanics fields back the expandable "inspect" row.
// Kills/Deaths/Elo come from the LEGACY endpoint (v3 doesn't expose them) and
// are merged in by game id — 0/absent when the legacy fetch had no data.
type RecentMatch struct {
	ID            string  `json:"id"`
	FinishedAt    string  `json:"finished_at"`
	DataSource    string  `json:"data_source"` // matchmaking | premier | faceit | ...
	Outcome       string  `json:"outcome"`     // win | loss | tie
	MapName       string  `json:"map_name"`
	LeetifyRating float64 `json:"leetify_rating"`
	Score         []int   `json:"score"`
	Rank          int     `json:"rank"`      // FACEIT level / Premier rating / Competitive rank (per RankType)
	RankType      int     `json:"rank_type"` // 11 = Premier (Rank is the rating), 12 = Competitive; 0 when absent

	Kills  int `json:"kills,omitempty"`
	Deaths int `json:"deaths,omitempty"`
	// Elo is the FACEIT elo recorded with the game (legacy endpoint only).
	Elo int `json:"elo,omitempty"`
	// RankBefore / RankDelta describe the rating movement this game caused.
	// Rank is the rating AFTER the game (verified: the newest rated Premier
	// game equals the profile's current rating), so RankBefore is the rating
	// carried out of the immediately preceding game in the same queue and
	// RankDelta is their difference — Premier rating points (rank_type 11) or
	// FACEIT elo. Both are zero/nil unless that preceding game is ALSO rated,
	// so a delta never silently spans games whose rating Leetify didn't record.
	RankBefore int  `json:"rank_before,omitempty"`
	RankDelta  *int `json:"rank_delta,omitempty"`

	Preaim               float64 `json:"preaim"`
	ReactionTimeMs       float64 `json:"reaction_time_ms"`
	AccuracyHead         float64 `json:"accuracy_head"`
	AccuracyEnemySpotted float64 `json:"accuracy_enemy_spotted"`
	SprayAccuracy        float64 `json:"spray_accuracy"`
}

// Profile is the subset of Leetify's /v3/profile we surface. Ranks is passed
// through verbatim since its shape is platform-specific.
type Profile struct {
	Name           string            `json:"name"`
	Steam64ID      string            `json:"steam64_id"`
	TotalMatches   int               `json:"total_matches"`
	Winrate        float64           `json:"winrate"`
	PrivacyMode    string            `json:"privacy_mode"`
	FirstMatchDate string            `json:"first_match_date"`
	Bans           []json.RawMessage `json:"bans"`
	Rating         Rating            `json:"rating"`
	Stats          Stats             `json:"stats"`
	Ranks          json.RawMessage   `json:"ranks"`
	// KD + AvgPartySize came from the legacy profile endpoint's per-match
	// data (v3 doesn't expose them, so they're 0/omitted there); PeakPremier is
	// the highest Premier rating seen across the match list (both sources).
	KD           float64 `json:"kd,omitempty"`
	AvgPartySize float64 `json:"avg_party_size,omitempty"`
	PeakPremier  int     `json:"peak_premier,omitempty"`
	// RecentTeammates passes through v3's frequent-teammates list (≤5 ids the
	// player queued with most in the recent window; legacy endpoint lacks it).
	RecentTeammates []RecentTeammate `json:"recent_teammates,omitempty"`
	// RecentMatches is capped on read to keep the payload small.
	RecentMatches []RecentMatch `json:"recent_matches"`
	// FaceitMatches is EVERY FACEIT match (not just the recent window), so the
	// Premier-vs-FACEIT split can still find a player's FACEIT games when they
	// last queued FACEIT far back in a Premier-heavy history. FACEIT is rare, so
	// carrying the full set is cheap.
	FaceitMatches []RecentMatch `json:"faceit_matches,omitempty"`
	// PremierMatches is the mirror for Premier (rank_type 11) — a FACEIT-heavy
	// player's Premier games fall out of the v3 window just the same, so the
	// split needs the dedicated list for BOTH sides.
	PremierMatches []RecentMatch `json:"premier_matches,omitempty"`
}

// RecentTeammate is one entry of v3's recent_teammates list.
type RecentTeammate struct {
	Steam64ID          string `json:"steam64_id"`
	RecentMatchesCount int    `json:"recent_matches_count"`
}

// maxFaceitMatches caps the dedicated FACEIT list (plenty for the split).
const maxFaceitMatches = 200

// v3MatchWindow is the fixed size of the /v3/profile recent-match window (the
// public API caps it here — limit/offset/paging are all ignored). When v3
// returns a FULL window there is older history it can't reach, so we complete
// the FACEIT list from the legacy endpoint (which returns every game).
const v3MatchWindow = 100

// faceitOnly returns the FACEIT matches (data_source "faceit") from a list.
func faceitOnly(ms []RecentMatch) []RecentMatch {
	out := make([]RecentMatch, 0, 16)
	for _, m := range ms {
		if m.DataSource == "faceit" {
			out = append(out, m)
			if len(out) >= maxFaceitMatches {
				break
			}
		}
	}
	return out
}

// premierOnly returns the Premier matches (rank_type 11) from a list.
func premierOnly(ms []RecentMatch) []RecentMatch {
	out := make([]RecentMatch, 0, 16)
	for _, m := range ms {
		if m.RankType == 11 {
			out = append(out, m)
			if len(out) >= maxFaceitMatches {
				break
			}
		}
	}
	return out
}

// peakPremier returns the highest Premier rating (rank_type 11) in a match list.
func peakPremier(ms []RecentMatch) int {
	peak := 0
	for _, m := range ms {
		if m.RankType == 11 && m.Rank > peak {
			peak = m.Rank
		}
	}
	return peak
}

// rankedQueue returns the ladder a game's rating belongs to and the rating it
// left the player on ("" when the game carries no comparable rating).
// Competitive skill groups are PER MAP in CS2, so each map is its own ladder —
// a Dust2 rank change must never be computed against a Vertigo game.
func rankedQueue(m *RecentMatch) (string, int) {
	switch {
	case m.RankType == 11: // Premier — Rank is the CS Rating
		return "premier", m.Rank
	case m.DataSource == "faceit": // FACEIT — Rank is the LEVEL, Elo is the number that moves
		return "faceit", m.Elo
	case m.RankType == 12: // Competitive skill group (0/out-of-range = unranked → breaks the chain)
		v := 0
		if m.Rank >= 1 && m.Rank <= 18 {
			v = m.Rank
		}
		return "comp:" + strings.ToLower(m.MapName), v
	}
	return "", 0
}

// computeRankDeltas fills RankBefore/RankDelta on a most-recent-first list by
// walking it oldest-first and tracking, per queue, the rating the previous
// game in that queue ended on. Leetify records the rating for most but not all
// games; when it's missing the chain is deliberately broken (prev = 0) so a
// later game never reports a swing that actually accumulated over several
// games. Competitive (rank_type 12) has no numeric ladder and is skipped.
func computeRankDeltas(ms []RecentMatch) {
	prev := map[string]int{}
	for i := len(ms) - 1; i >= 0; i-- {
		m := &ms[i]
		m.RankBefore = 0
		m.RankDelta = nil
		q, after := rankedQueue(m)
		if q == "" {
			continue
		}
		if after > 0 {
			if before := prev[q]; before > 0 {
				d := after - before
				m.RankBefore = before
				m.RankDelta = &d
			}
		}
		// unrated game (after == 0) resets the chain — the next rated game
		// has nothing trustworthy to compare against
		prev[q] = after
	}
}

// FaceitEloGame is a per-match elo point from FACEIT's own history (fetched
// by the faceit package), used to enrich faceit rows here.
type FaceitEloGame struct {
	Date     time.Time
	Map      string // "de_overpass"
	Elo      int    // after the match
	Delta    int
	HasDelta bool
}

// ApplyFaceitElo overwrites faceit rows' elo movement with FACEIT's OWN
// per-match numbers — authoritative, unlike the chained Leetify-legacy elo
// (which is null on recent games). Rows match on map + closest finish time
// within 30 minutes; unmatched rows keep whatever the chain derived.
func (p *Profile) ApplyFaceitElo(hist []FaceitEloGame) {
	if len(hist) == 0 {
		return
	}
	apply := func(ms []RecentMatch) {
		for i := range ms {
			m := &ms[i]
			if m.DataSource != "faceit" {
				continue
			}
			at, err := time.Parse(time.RFC3339, m.FinishedAt)
			if err != nil {
				continue
			}
			var best *FaceitEloGame
			bestGap := 30 * time.Minute
			for j := range hist {
				g := &hist[j]
				if g.Elo <= 0 || !strings.EqualFold(g.Map, m.MapName) {
					continue
				}
				gap := at.Sub(g.Date)
				if gap < 0 {
					gap = -gap
				}
				if gap < bestGap {
					bestGap = gap
					best = g
				}
			}
			if best == nil {
				continue
			}
			m.Elo = best.Elo
			if best.HasDelta {
				d := best.Delta
				m.RankDelta = &d
				m.RankBefore = best.Elo - best.Delta
			}
		}
	}
	apply(p.RecentMatches)
	apply(p.FaceitMatches)
}

func transientStatus(code int) bool {
	switch code {
	case http.StatusTooManyRequests, http.StatusBadGateway,
		http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return true
	}
	return false
}

// doWithRetry performs req with one bounded retry on transient failures (network
// error or 429/502/503/504), with a short ctx-aware backoff.
func (c *Client) doWithRetry(req *http.Request) (*http.Response, error) {
	const attempts = 2
	var resp *http.Response
	var err error
	for i := 0; i < attempts; i++ {
		resp, err = c.http.Do(req)
		if err == nil && !transientStatus(resp.StatusCode) {
			return resp, nil
		}
		if i == attempts-1 {
			return resp, err
		}
		if resp != nil {
			resp.Body.Close()
		}
		t := time.NewTimer(time.Duration(200*(i+1)) * time.Millisecond)
		select {
		case <-req.Context().Done():
			t.Stop()
			return nil, req.Context().Err()
		case <-t.C:
		}
	}
	return resp, err
}

// GetProfile fetches a player's Leetify profile by SteamID64.
func (c *Client) GetProfile(ctx context.Context, steam64 uint64) (*Profile, error) {
	q := url.Values{}
	q.Set("steam64_id", strconv.FormatUint(steam64, 10))
	u := c.baseURL + "/v3/profile?" + q.Encode()

	req, err := c.newReq(ctx, u)
	if err != nil {
		return nil, err
	}

	resp, err := c.doWithRetry(req)
	if err != nil {
		return nil, fmt.Errorf("leetify: request failed: %w", err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		var p Profile
		if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
			return nil, fmt.Errorf("leetify: decode: %w", err)
		}
		// Platform lists before capping recent_matches, so v3 surfaces all it has.
		p.FaceitMatches = faceitOnly(p.RecentMatches)
		p.PremierMatches = premierOnly(p.RecentMatches)
		if len(p.RecentMatches) > maxRecentMatches {
			p.RecentMatches = p.RecentMatches[:maxRecentMatches]
		}
		p.PeakPremier = peakPremier(p.RecentMatches)
		computeRankDeltas(p.RecentMatches)
		computeRankDeltas(p.FaceitMatches)
		computeRankDeltas(p.PremierMatches)
		return &p, nil
	case http.StatusNotFound:
		// Since Leetify's Jan 2026 policy, /v3 is the whole public surface for
		// profiles: it serves REGISTERED accounts only, and the old
		// api.leetify.com/api/profile/id/ fallback that quietly served everyone
		// else was withdrawn upstream around July 2026 (404 for every account,
		// including registered ones). A 404 here is therefore the final answer,
		// and retrying the dead endpoint only made every miss pay for a second
		// round trip.
		return nil, ErrNotFound
	default:
		return nil, fmt.Errorf("leetify: unexpected status %d", resp.StatusCode)
	}
}

// GameStats is the curated per-player slice of Leetify's per-game payload
// (legacy /api/games/{id}): the numbers the recent-match list can't carry from
// the profile feed — real ADR (their dpr), KAST, the HLTV-style rating,
// assists, MVPs and multi-kill counts. Fetched on demand when a row expands
// and cached hard by the caller — a finished game never changes.
type GameStats struct {
	Found       bool    `json:"found"`
	ADR         float64 `json:"adr,omitempty"`
	KASTPct     float64 `json:"kast_pct,omitempty"`
	Rating      float64 `json:"rating,omitempty"` // HLTV-style rating, computed by Leetify
	Kills       int     `json:"kills,omitempty"`
	Deaths      int     `json:"deaths,omitempty"`
	Assists     int     `json:"assists,omitempty"`
	MVPs        int     `json:"mvps,omitempty"`
	Multi2K     int     `json:"multi_2k,omitempty"`
	Multi3K     int     `json:"multi_3k,omitempty"`
	Multi4K     int     `json:"multi_4k,omitempty"`
	Multi5K     int     `json:"multi_5k,omitempty"`
	SurvivedPct float64 `json:"survived_pct,omitempty"`
	// Scoreboard is the full 10-player board, the viewer's team first, each
	// team's players sorted by rating.
	Scoreboard []ScoreTeam `json:"scoreboard,omitempty"`
}

// ScoreTeam is one side of a game's scoreboard.
type ScoreTeam struct {
	Score   int        `json:"score"`
	Players []ScoreRow `json:"players"`
}

// ScoreRow is one player's line on a game's scoreboard. Avatar is filled by
// the API layer (one bulk Steam summaries call for the whole board). The aim
// block feeds a per-player hover breakdown — Leetify has no per-game "aim
// rating", so the components are surfaced instead of inventing a number.
type ScoreRow struct {
	Name    string  `json:"name"`
	SteamID string  `json:"steam_id,omitempty"`
	Avatar  string  `json:"avatar,omitempty"`
	Kills   int     `json:"kills"`
	Deaths  int     `json:"deaths"`
	Assists int     `json:"assists"`
	ADR     float64 `json:"adr"`
	Rating  float64 `json:"rating"`
	HSPct   float64 `json:"hs_pct"`
	KASTPct float64 `json:"kast_pct,omitempty"`
	Impact  float64 `json:"impact"` // Leetify's per-game rating (raw fraction, can be negative)
	MVPs    int     `json:"mvps,omitempty"`
	Multi2K int     `json:"m2k,omitempty"`
	Multi3K int     `json:"m3k,omitempty"`
	Multi4K int     `json:"m4k,omitempty"`
	Multi5K int     `json:"m5k,omitempty"`
	// aim components
	Preaim     float64 `json:"preaim,omitempty"`
	ReactionMs float64 `json:"reaction_ms,omitempty"`
	SprayPct   float64 `json:"spray_pct,omitempty"`
	CSPct      float64 `json:"cs_pct,omitempty"` // counter-strafing good-shots %
	// context flags
	Leaver bool `json:"leaver,omitempty"`
	Party  int  `json:"party,omitempty"` // 1..n — players sharing a number queued together; 0 = solo
	Me     bool `json:"me,omitempty"`
	// the player's ladder standing AT MATCH TIME, from the game's own
	// matchmakingGameStats / faceitGameStats blocks: Premier rating or comp
	// skill group (with the pre-game value when the game changed it), or the
	// FACEIT level. Zero when the lobby was unrated.
	RankType    int `json:"rank_type,omitempty"` // 11 = Premier, 12 = Competitive
	RankAfter   int `json:"rank_after,omitempty"`
	RankBefore  int `json:"rank_before,omitempty"`
	FaceitLevel int `json:"faceit_level,omitempty"`
	// FaceitPlayerID lets the API layer look up this player's elo; FaceitElo is
	// filled there (FACEIT publishes only a CURRENT elo per player, never the
	// value at match time, so the UI labels it as such).
	FaceitPlayerID string `json:"-"`
	FaceitElo      int    `json:"faceit_elo,omitempty"`
}

// GetGameStats fetches one game's scoreboard and returns the row for steam64.
// Found=false (no error) when the game exists but that player isn't on it.
func (c *Client) GetGameStats(ctx context.Context, gameID string, steam64 uint64) (*GameStats, error) {
	u := c.legacyURL + "/api/games/" + url.PathEscape(gameID)
	req, err := c.newReq(ctx, u)
	if err != nil {
		return nil, err
	}

	resp, err := c.doWithRetry(req)
	if err != nil {
		return nil, fmt.Errorf("leetify game stats: request failed: %w", err)
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusNotFound:
		return nil, ErrNotFound
	default:
		return nil, fmt.Errorf("leetify game stats: unexpected status %d", resp.StatusCode)
	}

	var payload struct {
		Parties []struct {
			Party     int    `json:"party"`
			Steam64ID string `json:"steam64Id"`
		} `json:"parties"`
		MMStats []struct {
			Steam64ID   string `json:"steam64Id"`
			Rank        int    `json:"rank"`
			OldRank     int    `json:"oldRank"`
			RankType    int    `json:"rankType"`
			RankChanged bool   `json:"rankChanged"`
		} `json:"matchmakingGameStats"`
		FaceitStats []struct {
			Steam64ID      string `json:"steam64Id"`
			FaceitRank     int    `json:"faceitRank"`
			FaceitPlayerID string `json:"faceitPlayerId"`
		} `json:"faceitGameStats"`
		PlayerStats []struct {
			Steam64ID   string  `json:"steam64Id"`
			Name        string  `json:"name"`
			TeamNumber  int     `json:"initialTeamNumber"` // 2 / 3
			DPR         float64 `json:"dpr"`
			KAST        float64 `json:"kast"` // 0..1 fraction
			HLTVRating  float64 `json:"hltvRating"`
			HSP         float64 `json:"hsp"` // 0..1 fraction
			Leetify     float64 `json:"leetifyRating"`
			TotalKills  int     `json:"totalKills"`
			TotalDeaths int     `json:"totalDeaths"`
			Assists     int     `json:"totalAssists"`
			MVPs        int     `json:"mvps"`
			Multi2K     int     `json:"multi2k"`
			Multi3K     int     `json:"multi3k"`
			Multi4K     int     `json:"multi4k"`
			Multi5K     int     `json:"multi5k"`
			Survived    float64 `json:"roundsSurvivedPercentage"` // 0..1 fraction
			Preaim      float64 `json:"preaim"`
			Reaction    float64 `json:"reactionTime"` // seconds
			Spray       float64 `json:"sprayAccuracy"`
			CSRatio     float64 `json:"counterStrafingShotsGoodRatio"`
			IsLeaver    bool    `json:"isLeaver"`
			// per-side rounds WON by this player's team — summed, this IS the
			// team's score, attributed to the right team by construction
			// (the top-level teamScores array's order does not reliably match
			// initialTeamNumber: real case read "13–1 win" on the row while
			// the board said the opponents got 13)
			CTRoundsWon int `json:"ctRoundsWon"`
			TRoundsWon  int `json:"tRoundsWon"`
		} `json:"playerStats"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("leetify game stats: decode: %w", err)
	}
	sid := strconv.FormatUint(steam64, 10)

	// party groups: renumber the raw ids to 1..n. Leetify OMITS solo players
	// from the parties array and numbers real parties from ZERO — party 0 is a
	// genuine stack, not "no party" (verified: a game's party-0 members were
	// teammates, and a user's full five-stack arrived labeled 0 and lost its
	// dots when 0 was skipped). Only sub-2-member entries are dropped.
	partySize := map[int]int{}
	for _, pt := range payload.Parties {
		partySize[pt.Party]++
	}
	partyNum := map[string]int{}
	partyIdx := map[int]int{}
	for _, pt := range payload.Parties {
		if partySize[pt.Party] < 2 {
			continue
		}
		if _, ok := partyIdx[pt.Party]; !ok {
			partyIdx[pt.Party] = len(partyIdx) + 1
		}
		partyNum[pt.Steam64ID] = partyIdx[pt.Party]
	}

	// per-player ladder standing at match time
	type mmRank struct{ rank, oldRank, rankType int }
	mmOf := map[string]mmRank{}
	for _, m := range payload.MMStats {
		mmOf[m.Steam64ID] = mmRank{m.Rank, m.OldRank, m.RankType}
	}
	levelOf := map[string]int{}
	faceitIDOf := map[string]string{}
	for _, f := range payload.FaceitStats {
		levelOf[f.Steam64ID] = f.FaceitRank
		faceitIDOf[f.Steam64ID] = f.FaceitPlayerID
	}

	// full board: teamNumber → rows; the viewer's team renders first
	byTeam := map[int]*ScoreTeam{}
	teamNums := []int{}
	myTeam := 0
	out := &GameStats{}
	for _, p := range payload.PlayerStats {
		t, ok := byTeam[p.TeamNumber]
		if !ok {
			t = &ScoreTeam{}
			byTeam[p.TeamNumber] = t
			teamNums = append(teamNums, p.TeamNumber)
		}
		// every player on a team should agree; max() shrugs off a zeroed row
		if s := p.CTRoundsWon + p.TRoundsWon; s > t.Score {
			t.Score = s
		}
		row := ScoreRow{
			Name:       p.Name,
			SteamID:    p.Steam64ID,
			Kills:      p.TotalKills,
			Deaths:     p.TotalDeaths,
			Assists:    p.Assists,
			ADR:        p.DPR,
			Rating:     p.HLTVRating,
			HSPct:      p.HSP * 100,
			KASTPct:    p.KAST * 100,
			Impact:     p.Leetify,
			MVPs:       p.MVPs,
			Multi2K:    p.Multi2K,
			Multi3K:    p.Multi3K,
			Multi4K:    p.Multi4K,
			Multi5K:    p.Multi5K,
			Preaim:     p.Preaim,
			ReactionMs: p.Reaction * 1000,
			SprayPct:   p.Spray * 100,
			CSPct:      p.CSRatio * 100,
			Leaver:     p.IsLeaver,
			Party:      partyNum[p.Steam64ID],
		}
		if mm, ok := mmOf[p.Steam64ID]; ok && mm.rank > 0 {
			row.RankType = mm.rankType
			row.RankAfter = mm.rank
			if mm.oldRank > 0 && mm.oldRank != mm.rank {
				row.RankBefore = mm.oldRank
			}
		}
		row.FaceitLevel = levelOf[p.Steam64ID]
		row.FaceitPlayerID = faceitIDOf[p.Steam64ID]
		if p.Steam64ID == sid {
			row.Me = true
			myTeam = p.TeamNumber
			out.Found = true
			out.ADR = p.DPR
			out.KASTPct = p.KAST * 100
			out.Rating = p.HLTVRating
			out.Kills = p.TotalKills
			out.Deaths = p.TotalDeaths
			out.Assists = p.Assists
			out.MVPs = p.MVPs
			out.Multi2K = p.Multi2K
			out.Multi3K = p.Multi3K
			out.Multi4K = p.Multi4K
			out.Multi5K = p.Multi5K
			out.SurvivedPct = p.Survived * 100
		}
		t.Players = append(t.Players, row)
	}
	// viewer's team first, then the rest in appearance order; rating sorts rows
	sort.SliceStable(teamNums, func(i, j int) bool {
		return teamNums[i] == myTeam && teamNums[j] != myTeam
	})
	for _, tn := range teamNums {
		t := byTeam[tn]
		sort.SliceStable(t.Players, func(i, j int) bool { return t.Players[i].Rating > t.Players[j].Rating })
		out.Scoreboard = append(out.Scoreboard, *t)
	}
	return out, nil
}

// GameDetails is the tiny slice of Leetify's per-match payload we need to turn
// a listed match into an analyzable demo: the Valve share code (Premier/MM) or
// the FACEIT match id, plus when it finished (Valve replays expire ~30 days).
type GameDetails struct {
	ID             string `json:"id"`
	DataSource     string `json:"dataSource"`
	FinishedAt     string `json:"finishedAt"`
	MapName        string `json:"mapName"`
	SteamShareCode string `json:"steamShareCode"`
	FaceitMatchID  string `json:"faceitMatchId"`
}

// GetGameDetails fetches a single match's details from the legacy endpoint by
// Leetify game id (the id our recent-match rows carry).
func (c *Client) GetGameDetails(ctx context.Context, gameID string) (*GameDetails, error) {
	u := c.legacyURL + "/api/games/" + url.PathEscape(gameID)
	req, err := c.newReq(ctx, u)
	if err != nil {
		return nil, err
	}

	resp, err := c.doWithRetry(req)
	if err != nil {
		return nil, fmt.Errorf("leetify games: request failed: %w", err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		var gd GameDetails
		if err := json.NewDecoder(resp.Body).Decode(&gd); err != nil {
			return nil, fmt.Errorf("leetify games: decode: %w", err)
		}
		return &gd, nil
	case http.StatusNotFound:
		return nil, ErrNotFound
	default:
		return nil, fmt.Errorf("leetify games: unexpected status %d", resp.StatusCode)
	}
}
