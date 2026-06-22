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
	"strconv"
	"strings"
	"time"
)

// ErrNotFound means Leetify has no (public) profile for the SteamID.
var ErrNotFound = errors.New("leetify: profile not found")

// maxRecentMatches caps the recent-match list we surface (Leetify returns ~100).
const maxRecentMatches = 10

// Client talks to the Leetify public API.
type Client struct {
	baseURL string
	apiKey  string // optional; reserved for higher rate limits
	http    *http.Client
}

// Option customises a Client.
type Option func(*Client)

// WithHTTPClient injects a custom HTTP client (used in tests).
func WithHTTPClient(h *http.Client) Option { return func(c *Client) { c.http = h } }

// New builds a Client. baseURL defaults are set by the caller from config.
func New(baseURL, apiKey string, opts ...Option) *Client {
	c := &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
		http:    &http.Client{Timeout: 10 * time.Second},
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
type RecentMatch struct {
	ID            string  `json:"id"`
	FinishedAt    string  `json:"finished_at"`
	DataSource    string  `json:"data_source"` // matchmaking | premier | faceit | ...
	Outcome       string  `json:"outcome"`     // win | loss | tie
	MapName       string  `json:"map_name"`
	LeetifyRating float64 `json:"leetify_rating"`
	Score         []int   `json:"score"`
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
	// RecentMatches is capped on read to keep the payload small.
	RecentMatches []RecentMatch `json:"recent_matches"`
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

	resp, err := c.http.Do(req)
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
		if len(p.RecentMatches) > maxRecentMatches {
			p.RecentMatches = p.RecentMatches[:maxRecentMatches]
		}
		return &p, nil
	case http.StatusNotFound:
		return nil, ErrNotFound
	default:
		return nil, fmt.Errorf("leetify: unexpected status %d", resp.StatusCode)
	}
}
