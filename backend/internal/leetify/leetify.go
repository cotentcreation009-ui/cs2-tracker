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
	"math"
	"net/http"
	"net/url"
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
	apiKey    string // optional; reserved for higher rate limits
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
		baseURL:   strings.TrimRight(baseURL, "/"),
		legacyURL: "https://api.leetify.com",
		apiKey:    apiKey,
		http:      &http.Client{Timeout: 10 * time.Second},
	}
	for _, o := range opts {
		o(c)
	}
	return c
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
	// Derived extras. KD + AvgPartySize come from the legacy endpoint's per-match
	// data (v3 doesn't expose them, so they're 0/omitted there); PeakPremier is
	// the highest Premier rating seen across the match list (both sources).
	KD           float64 `json:"kd,omitempty"`
	AvgPartySize float64 `json:"avg_party_size,omitempty"`
	PeakPremier  int     `json:"peak_premier,omitempty"`
	// RecentMatches is capped on read to keep the payload small.
	RecentMatches []RecentMatch `json:"recent_matches"`
	// FaceitMatches is EVERY FACEIT match (not just the recent window), so the
	// Premier-vs-FACEIT split can still find a player's FACEIT games when they
	// last queued FACEIT far back in a Premier-heavy history. FACEIT is rare, so
	// carrying the full set is cheap.
	FaceitMatches []RecentMatch `json:"faceit_matches,omitempty"`
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

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	if c.apiKey != "" {
		// Reserved: the public API is keyless; a key (when issued) raises limits.
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
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
		// FACEIT list before capping recent_matches, so v3 surfaces all it has.
		p.FaceitMatches = faceitOnly(p.RecentMatches)
		if len(p.RecentMatches) > maxRecentMatches {
			p.RecentMatches = p.RecentMatches[:maxRecentMatches]
		}
		p.PeakPremier = peakPremier(p.RecentMatches)
		// v3 caps its window at 100 matches, so a player's FACEIT games from months
		// back get cut off. When v3 returned a FULL window (more history exists) and
		// we don't already have a full FACEIT set, pull the whole history from the
		// legacy endpoint to complete the FACEIT list (up to the 100-game filter) —
		// plus the legacy-only K/D + party + all-time peak, a free bonus.
		if len(p.RecentMatches) >= v3MatchWindow && len(p.FaceitMatches) < v3MatchWindow {
			if lp, lerr := c.getProfileLegacy(ctx, steam64); lerr == nil {
				if len(lp.FaceitMatches) > len(p.FaceitMatches) {
					p.FaceitMatches = lp.FaceitMatches
				}
				if lp.KD > 0 {
					p.KD = lp.KD
				}
				if lp.AvgPartySize > 0 {
					p.AvgPartySize = lp.AvgPartySize
				}
				if lp.PeakPremier > p.PeakPremier {
					p.PeakPremier = lp.PeakPremier
				}
			}
		}
		return &p, nil
	case http.StatusNotFound:
		// The newer /v3 API doesn't index every account Leetify actually has
		// (e.g. some friends-only profiles 404 here). Fall back to the legacy
		// profile endpoint, which still serves them, before giving up.
		if p, err := c.getProfileLegacy(ctx, steam64); err == nil {
			return p, nil
		}
		return nil, ErrNotFound
	default:
		return nil, fmt.Errorf("leetify: unexpected status %d", resp.StatusCode)
	}
}

// --- legacy fallback (api.leetify.com/api/profile/id/{steam64}) -------------
// The older public endpoint returns accounts /v3 404s on. Its JSON shape is
// different, so it is mapped into the same Profile. It has no aggregate stats
// block, so aim micro-stats are averaged from the per-match games — left at 0
// ("no data", which the CheatMeter skips) when the games don't carry them.

type legacyProfile struct {
	Meta struct {
		Name         string            `json:"name"`
		PlatformBans []json.RawMessage `json:"platformBans"`
	} `json:"meta"`
	RecentGameRatings struct {
		Aim         float64 `json:"aim"`
		Positioning float64 `json:"positioning"`
		Utility     float64 `json:"utility"`
		Clutch      float64 `json:"clutch"`
		Opening     float64 `json:"opening"`
		CTLeetify   float64 `json:"ctLeetify"`
		TLeetify    float64 `json:"tLeetify"`
		Leetify     float64 `json:"leetify"` // overall rating (raw decimal)
	} `json:"recentGameRatings"`
	Games []legacyGame `json:"games"`
}

type legacyGame struct {
	GameID                     string             `json:"gameId"`
	GameFinishedAt             string             `json:"gameFinishedAt"`
	DataSource                 string             `json:"dataSource"`
	MatchResult                string             `json:"matchResult"`
	MapName                    string             `json:"mapName"`
	Scores                     []int              `json:"scores"`
	RankType                   int                `json:"rankType"`
	SkillLevel                 int                `json:"skillLevel"`
	Elo                        *float64           `json:"elo"`
	OwnTeamTotalLeetifyRatings map[string]float64 `json:"ownTeamTotalLeetifyRatings"`
	Preaim                     float64            `json:"preaim"`
	ReactionTime               float64            `json:"reactionTime"`
	AccuracyHead               float64            `json:"accuracyHead"`
	Kills                      int                `json:"kills"`
	Deaths                     int                `json:"deaths"`
	PartySize                  int                `json:"partySize"`
}

func (lp *legacyProfile) toProfile(steam64 uint64) *Profile {
	sid := strconv.FormatUint(steam64, 10)
	p := &Profile{
		Name:         lp.Meta.Name,
		Steam64ID:    sid,
		TotalMatches: len(lp.Games),
		Bans:         lp.Meta.PlatformBans,
		Rating: Rating{
			Aim:         lp.RecentGameRatings.Aim,
			Positioning: lp.RecentGameRatings.Positioning,
			Utility:     lp.RecentGameRatings.Utility,
			Clutch:      lp.RecentGameRatings.Clutch,
			Opening:     lp.RecentGameRatings.Opening,
			CTLeetify:   lp.RecentGameRatings.CTLeetify,
			TLeetify:    lp.RecentGameRatings.TLeetify,
		},
	}

	wins := 0
	var preaimSum, reactSum, hsSum float64
	var preaimN, reactN, hsN, premierRank int
	var killSum, deathSum, partySum, partyN, peakPrem int
	rm := make([]RecentMatch, 0, len(lp.Games))
	faceitRm := make([]RecentMatch, 0, 16)
	for _, g := range lp.Games {
		if g.MatchResult == "win" {
			wins++
		}
		if g.Preaim > 0 {
			preaimSum += g.Preaim
			preaimN++
		}
		if g.ReactionTime > 0 {
			reactSum += g.ReactionTime * 1000 // legacy reactionTime is in seconds
			reactN++
		}
		if g.AccuracyHead > 0 {
			hsSum += g.AccuracyHead * 100 // legacy accuracyHead is a 0-1 fraction
			hsN++
		}
		if g.Kills > 0 || g.Deaths > 0 {
			killSum += g.Kills
			deathSum += g.Deaths
		}
		if g.PartySize > 0 {
			partySum += g.PartySize
			partyN++
		}
		rank := g.SkillLevel
		if rank == 0 && g.Elo != nil {
			rank = int(*g.Elo)
		}
		if premierRank == 0 && g.RankType == 11 && rank > 0 {
			premierRank = rank // most recent Premier rating
		}
		if g.RankType == 11 && rank > peakPrem {
			peakPrem = rank // highest Premier rating ever
		}
		match := RecentMatch{
			ID:             g.GameID,
			FinishedAt:     g.GameFinishedAt,
			DataSource:     g.DataSource,
			Outcome:        g.MatchResult,
			MapName:        g.MapName,
			LeetifyRating:  g.OwnTeamTotalLeetifyRatings[sid],
			Score:          g.Scores,
			Rank:           rank,
			RankType:       g.RankType,
			Preaim:         g.Preaim,
			ReactionTimeMs: g.ReactionTime * 1000, // seconds → ms (matches v3)
			AccuracyHead:   g.AccuracyHead * 100,  // fraction → % (matches v3)
		}
		if len(rm) < maxRecentMatches {
			rm = append(rm, match)
		}
		// Keep EVERY FACEIT match (across all games), even past the recent cap.
		if g.DataSource == "faceit" && len(faceitRm) < maxFaceitMatches {
			faceitRm = append(faceitRm, match)
		}
	}
	if n := len(lp.Games); n > 0 {
		p.Winrate = float64(wins) / float64(n)
	}
	if preaimN > 0 {
		p.Stats.Preaim = preaimSum / float64(preaimN)
	}
	if reactN > 0 {
		p.Stats.ReactionTimeMs = reactSum / float64(reactN)
	}
	if hsN > 0 {
		p.Stats.AccuracyHead = hsSum / float64(hsN)
	}
	if deathSum > 0 {
		p.KD = float64(killSum) / float64(deathSum)
	}
	if partyN > 0 {
		p.AvgPartySize = float64(partySum) / float64(partyN)
	}
	p.PeakPremier = peakPrem
	p.RecentMatches = rm
	p.FaceitMatches = faceitRm
	ranks := map[string]any{}
	if lp.RecentGameRatings.Leetify != 0 {
		// Leetify's overall rating is a small decimal; v3 exposes it ×100 in
		// ranks.leetify (e.g. 2.36), so match that scale for a consistent display.
		ranks["leetify"] = math.Round(lp.RecentGameRatings.Leetify*10000) / 100
	}
	if premierRank > 0 {
		ranks["premier"] = premierRank
	}
	if len(ranks) > 0 {
		if b, err := json.Marshal(ranks); err == nil {
			p.Ranks = b
		}
	}
	return p
}

func (c *Client) getProfileLegacy(ctx context.Context, steam64 uint64) (*Profile, error) {
	u := c.legacyURL + "/api/profile/id/" + strconv.FormatUint(steam64, 10)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.doWithRetry(req)
	if err != nil {
		return nil, fmt.Errorf("leetify legacy: request failed: %w", err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		var lp legacyProfile
		if err := json.NewDecoder(resp.Body).Decode(&lp); err != nil {
			return nil, fmt.Errorf("leetify legacy: decode: %w", err)
		}
		// An empty/placeholder body is not a real profile.
		if len(lp.Games) == 0 && lp.RecentGameRatings.Aim == 0 {
			return nil, ErrNotFound
		}
		return lp.toProfile(steam64), nil
	case http.StatusNotFound:
		return nil, ErrNotFound
	default:
		return nil, fmt.Errorf("leetify legacy: unexpected status %d", resp.StatusCode)
	}
}
