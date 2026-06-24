// Package faceit is a client for the FACEIT Data API
// (https://open.faceit.com/data/v4). It resolves a SteamID64 to a FACEIT player
// and fetches their CS2 lifetime stats, so a profile can show real FACEIT
// matchmaking numbers for accounts we have not parsed ourselves.
//
// Unlike Leetify's keyless API, the FACEIT Data API requires a server-side API
// key (free, from https://developers.faceit.com) sent as a Bearer token. Calls
// return ErrNoAPIKey when none is configured so the rest of the app degrades
// gracefully (the profile just hides the FACEIT panel).
package faceit

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

var (
	// ErrNoAPIKey means no FACEIT_API_KEY is configured (or the key was rejected).
	ErrNoAPIKey = errors.New("faceit: no API key configured")
	// ErrNotFound means the SteamID has no linked FACEIT CS2 player.
	ErrNotFound = errors.New("faceit: player not found")
)

const defaultBaseURL = "https://open.faceit.com/data/v4"

// Client talks to the FACEIT Data API.
type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

// Option customises a Client.
type Option func(*Client)

// WithHTTPClient injects a custom HTTP client (used in tests).
func WithHTTPClient(h *http.Client) Option { return func(c *Client) { c.http = h } }

// New builds a Client. An empty baseURL falls back to the public API; apiKey may
// be empty (calls then return ErrNoAPIKey).
func New(baseURL, apiKey string, opts ...Option) *Client {
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
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

// HasKey reports whether an API key is configured.
func (c *Client) HasKey() bool { return c.apiKey != "" }

// Profile is the subset of FACEIT data we surface for a player: identity + CS2
// skill level/elo + lifetime stats.
type Profile struct {
	PlayerID  string `json:"playerId"`
	Nickname  string `json:"nickname"`
	Country   string `json:"country"`
	Avatar    string `json:"avatar"`
	FaceitURL string `json:"faceitUrl"`
	Region    string `json:"region"`

	SkillLevel int `json:"skillLevel"`
	Elo        int `json:"elo"`

	Matches          int      `json:"matches"`
	WinRatePct       float64  `json:"winRatePct"`
	KDRatio          float64  `json:"kdRatio"`
	HSPct            float64  `json:"hsPct"`
	AvgKills         float64  `json:"avgKills"`
	CurrentWinStreak int      `json:"currentWinStreak"`
	LongestWinStreak int      `json:"longestWinStreak"`
	RecentResults    []string `json:"recentResults"` // most-recent-first "1"=win, "0"=loss
}

// players?game=cs2&game_player_id=<steam64> response (subset).
type playerResp struct {
	PlayerID  string `json:"player_id"`
	Nickname  string `json:"nickname"`
	Country   string `json:"country"`
	Avatar    string `json:"avatar"`
	FaceitURL string `json:"faceit_url"`
	Games     struct {
		CS2 struct {
			SkillLevel int    `json:"skill_level"`
			FaceitElo  int    `json:"faceit_elo"`
			Region     string `json:"region"`
		} `json:"cs2"`
	} `json:"games"`
}

// players/{id}/stats/cs2 response (subset). FACEIT returns lifetime values as
// strings (and "Recent Results" as a string array), so parse defensively.
type statsResp struct {
	Lifetime struct {
		Matches    string   `json:"Matches"`
		WinRate    string   `json:"Win Rate %"`
		KD         string   `json:"Average K/D Ratio"`
		HS         string   `json:"Average Headshots %"`
		AvgKills   string   `json:"Average Kills"`
		CurStreak  string   `json:"Current Win Streak"`
		LongStreak string   `json:"Longest Win Streak"`
		Recent     []string `json:"Recent Results"`
	} `json:"lifetime"`
}

// GetProfile resolves a SteamID64 to a FACEIT player and fetches CS2 lifetime
// stats. A player with no CS2 stats yet returns an identity-only profile.
func (c *Client) GetProfile(ctx context.Context, steam64 uint64) (*Profile, error) {
	if c.apiKey == "" {
		return nil, ErrNoAPIKey
	}

	q := url.Values{}
	q.Set("game", "cs2")
	q.Set("game_player_id", strconv.FormatUint(steam64, 10))
	var pr playerResp
	if err := c.get(ctx, "/players?"+q.Encode(), &pr); err != nil {
		return nil, err
	}
	if pr.PlayerID == "" {
		return nil, ErrNotFound
	}

	p := &Profile{
		PlayerID:   pr.PlayerID,
		Nickname:   pr.Nickname,
		Country:    pr.Country,
		Avatar:     pr.Avatar,
		FaceitURL:  strings.ReplaceAll(pr.FaceitURL, "{lang}", "en"),
		Region:     pr.Games.CS2.Region,
		SkillLevel: pr.Games.CS2.SkillLevel,
		Elo:        pr.Games.CS2.FaceitElo,
	}

	var sr statsResp
	if err := c.get(ctx, "/players/"+pr.PlayerID+"/stats/cs2", &sr); err != nil {
		// Player exists but has no CS2 stats — return identity/elo only.
		if errors.Is(err, ErrNotFound) {
			return p, nil
		}
		return nil, err
	}
	l := sr.Lifetime
	p.Matches = atoi(l.Matches)
	p.WinRatePct = atof(l.WinRate)
	p.KDRatio = atof(l.KD)
	p.HSPct = atof(l.HS)
	p.AvgKills = atof(l.AvgKills)
	p.CurrentWinStreak = atoi(l.CurStreak)
	p.LongestWinStreak = atoi(l.LongStreak)
	p.RecentResults = l.Recent
	return p, nil
}

func (c *Client) get(ctx context.Context, path string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.doWithRetry(req)
	if err != nil {
		return fmt.Errorf("faceit: request failed: %w", err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		if err := json.NewDecoder(resp.Body).Decode(dst); err != nil {
			return fmt.Errorf("faceit: decode: %w", err)
		}
		return nil
	case http.StatusNotFound:
		return ErrNotFound
	case http.StatusUnauthorized, http.StatusForbidden:
		return ErrNoAPIKey
	default:
		return fmt.Errorf("faceit: unexpected status %d", resp.StatusCode)
	}
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

// atoi/atof parse FACEIT's stringly-typed stat values, tolerating blanks.
func atoi(s string) int {
	n, _ := strconv.Atoi(strings.TrimSpace(s))
	return n
}

func atof(s string) float64 {
	f, _ := strconv.ParseFloat(strings.TrimSpace(s), 64)
	return f
}
