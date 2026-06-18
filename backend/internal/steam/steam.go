// Package steam is a typed client for the parts of the Steam Web API we need:
// resolving vanity URLs to SteamID64s, fetching public profile summaries, and
// reading the App 730 (CS2) lifetime stat aggregates. The API key is supplied at
// construction; calls fail clearly with ErrNoAPIKey when it is missing so the
// rest of the app can degrade gracefully until a key is provided.
package steam

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

// AppIDCS2 is the Steam application id for Counter-Strike 2 (formerly CS:GO).
const AppIDCS2 = 730

const defaultBaseURL = "https://api.steampowered.com"

var (
	// ErrNoAPIKey is returned when a call needs a key but none is configured.
	ErrNoAPIKey = errors.New("steam: no API key configured")
	// ErrNotFound is returned when a vanity URL or profile cannot be resolved.
	ErrNotFound = errors.New("steam: not found")
)

// Client talks to the Steam Web API.
type Client struct {
	apiKey  string
	baseURL string
	http    *http.Client
}

// Option customises a Client.
type Option func(*Client)

// WithBaseURL overrides the API base URL (used in tests).
func WithBaseURL(u string) Option { return func(c *Client) { c.baseURL = strings.TrimRight(u, "/") } }

// WithHTTPClient injects a custom *http.Client.
func WithHTTPClient(h *http.Client) Option { return func(c *Client) { c.http = h } }

// New constructs a Client. apiKey may be empty; key-requiring calls then return
// ErrNoAPIKey.
func New(apiKey string, opts ...Option) *Client {
	c := &Client{
		apiKey:  apiKey,
		baseURL: defaultBaseURL,
		http:    &http.Client{Timeout: 10 * time.Second},
	}
	for _, o := range opts {
		o(c)
	}
	return c
}

// HasKey reports whether the client has an API key.
func (c *Client) HasKey() bool { return c.apiKey != "" }

// --- ResolveVanityURL -------------------------------------------------------

type resolveResponse struct {
	Response struct {
		SteamID string `json:"steamid"`
		Success int    `json:"success"` // 1 = ok, 42 = no match
		Message string `json:"message"`
	} `json:"response"`
}

// ResolveVanityURL resolves a vanity name (the custom part of
// steamcommunity.com/id/<vanity>) to a SteamID64.
func (c *Client) ResolveVanityURL(ctx context.Context, vanity string) (uint64, error) {
	if c.apiKey == "" {
		return 0, ErrNoAPIKey
	}
	q := url.Values{}
	q.Set("key", c.apiKey)
	q.Set("vanityurl", vanity)

	var out resolveResponse
	if err := c.getJSON(ctx, "/ISteamUser/ResolveVanityURL/v1/", q, &out); err != nil {
		return 0, err
	}
	if out.Response.Success != 1 {
		return 0, ErrNotFound
	}
	id, err := strconv.ParseUint(out.Response.SteamID, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("steam: bad steamid in response: %w", err)
	}
	return id, nil
}

// --- GetPlayerSummaries -----------------------------------------------------

// PlayerSummary is the subset of GetPlayerSummaries we use.
type PlayerSummary struct {
	SteamID                  uint64
	PersonaName              string
	ProfileURL               string
	Avatar                   string // 32px
	AvatarMedium             string // 64px
	AvatarFull               string // 184px
	PersonaState             int
	CommunityVisibilityState int // 3 = public
	ProfileState             int
	LocCountryCode           string
	TimeCreated              time.Time
}

type playerSummariesResponse struct {
	Response struct {
		Players []struct {
			SteamID                  string `json:"steamid"`
			PersonaName              string `json:"personaname"`
			ProfileURL               string `json:"profileurl"`
			Avatar                   string `json:"avatar"`
			AvatarMedium             string `json:"avatarmedium"`
			AvatarFull               string `json:"avatarfull"`
			PersonaState             int    `json:"personastate"`
			CommunityVisibilityState int    `json:"communityvisibilitystate"`
			ProfileState             int    `json:"profilestate"`
			LocCountryCode           string `json:"loccountrycode"`
			TimeCreated              int64  `json:"timecreated"`
		} `json:"players"`
	} `json:"response"`
}

// GetPlayerSummaries fetches public profile data for up to 100 SteamID64s.
func (c *Client) GetPlayerSummaries(ctx context.Context, ids ...uint64) ([]PlayerSummary, error) {
	if c.apiKey == "" {
		return nil, ErrNoAPIKey
	}
	if len(ids) == 0 {
		return nil, nil
	}
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = strconv.FormatUint(id, 10)
	}
	q := url.Values{}
	q.Set("key", c.apiKey)
	q.Set("steamids", strings.Join(parts, ","))

	var out playerSummariesResponse
	if err := c.getJSON(ctx, "/ISteamUser/GetPlayerSummaries/v2/", q, &out); err != nil {
		return nil, err
	}
	summaries := make([]PlayerSummary, 0, len(out.Response.Players))
	for _, p := range out.Response.Players {
		id, _ := strconv.ParseUint(p.SteamID, 10, 64)
		s := PlayerSummary{
			SteamID:                  id,
			PersonaName:              p.PersonaName,
			ProfileURL:               p.ProfileURL,
			Avatar:                   p.Avatar,
			AvatarMedium:             p.AvatarMedium,
			AvatarFull:               p.AvatarFull,
			PersonaState:             p.PersonaState,
			CommunityVisibilityState: p.CommunityVisibilityState,
			ProfileState:             p.ProfileState,
			LocCountryCode:           p.LocCountryCode,
		}
		if p.TimeCreated > 0 {
			s.TimeCreated = time.Unix(p.TimeCreated, 0).UTC()
		}
		summaries = append(summaries, s)
	}
	return summaries, nil
}

// --- GetUserStatsForGame ----------------------------------------------------

// GameStats holds the lifetime App 730 stat values keyed by Valve's stat names
// (e.g. "total_kills", "total_deaths", "total_time_played").
type GameStats struct {
	SteamID  uint64
	GameName string
	Stats    map[string]int64
}

// Int returns a stat value (0 if absent).
func (g GameStats) Int(name string) int64 { return g.Stats[name] }

type userStatsResponse struct {
	PlayerStats struct {
		SteamID  string `json:"steamID"`
		GameName string `json:"gameName"`
		Stats    []struct {
			Name  string `json:"name"`
			Value int64  `json:"value"`
		} `json:"stats"`
	} `json:"playerstats"`
}

// GetUserStatsForGame returns the lifetime stat aggregates for a player in a
// game. For CS2 use AppIDCS2. Returns ErrNotFound when the profile is private or
// has no stats (Steam answers 403/500 in that case).
func (c *Client) GetUserStatsForGame(ctx context.Context, appID int, steamID uint64) (GameStats, error) {
	if c.apiKey == "" {
		return GameStats{}, ErrNoAPIKey
	}
	q := url.Values{}
	q.Set("key", c.apiKey)
	q.Set("appid", strconv.Itoa(appID))
	q.Set("steamid", strconv.FormatUint(steamID, 10))

	var out userStatsResponse
	if err := c.getJSON(ctx, "/ISteamUserStats/GetUserStatsForGame/v2/", q, &out); err != nil {
		return GameStats{}, err
	}
	gs := GameStats{
		GameName: out.PlayerStats.GameName,
		Stats:    make(map[string]int64, len(out.PlayerStats.Stats)),
	}
	gs.SteamID, _ = strconv.ParseUint(out.PlayerStats.SteamID, 10, 64)
	for _, s := range out.PlayerStats.Stats {
		gs.Stats[s.Name] = s.Value
	}
	return gs, nil
}

// --- ResolveSteamID convenience --------------------------------------------

// ResolveSteamID accepts either a raw SteamID64 (17-digit numeric string) or a
// vanity name and returns the SteamID64. This backs the /id/<x> route, which
// mirrors Steam's own ambiguous URL space.
func (c *Client) ResolveSteamID(ctx context.Context, input string) (uint64, error) {
	input = strings.TrimSpace(input)
	if id, ok := ParseSteamID64(input); ok {
		return id, nil
	}
	return c.ResolveVanityURL(ctx, input)
}

// ParseSteamID64 returns the id and true when s looks like a valid SteamID64.
func ParseSteamID64(s string) (uint64, bool) {
	if len(s) != 17 {
		return 0, false
	}
	id, err := strconv.ParseUint(s, 10, 64)
	if err != nil {
		return 0, false
	}
	// Individual SteamID64s live in the 7656119xxxxxxxxxx range.
	if id < 76561197960265728 {
		return 0, false
	}
	return id, true
}

// --- internal ---------------------------------------------------------------

func (c *Client) getJSON(ctx context.Context, path string, q url.Values, dst any) error {
	u := c.baseURL + path + "?" + q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("steam: request failed: %w", err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		// fall through
	case http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden, http.StatusInternalServerError:
		// Steam signals "no data for this user/app" on GetUserStatsForGame with
		// 400 or 500 (profile private, or never played the game — confirmed live
		// against an account with no CS2 stats), and rejects a bad key with
		// 401/403. Treat them all as not-found so callers degrade gracefully.
		return ErrNotFound
	default:
		return fmt.Errorf("steam: unexpected status %d for %s", resp.StatusCode, path)
	}

	if err := json.NewDecoder(resp.Body).Decode(dst); err != nil {
		return fmt.Errorf("steam: decode response: %w", err)
	}
	return nil
}
