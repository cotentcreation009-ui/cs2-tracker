// Package gcbot is the client for the gc-bot sidecar — the Node service that
// holds a Steam session into the CS2 Game Coordinator and resolves match share
// codes (CSGO-xxxxx-…) into GOTV replay URLs. The sidecar is internal-only; an
// empty base URL means the bot isn't deployed and share-code ingestion is off.
package gcbot

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

var (
	// ErrNotFound means the Game Coordinator has no (or no longer any) replay for
	// that share code — typically an expired or unrecorded match.
	ErrNotFound = errors.New("gcbot: match replay not found (expired or not recorded)")
	// ErrUnavailable means the bot isn't connected/logged in right now.
	ErrUnavailable = errors.New("gcbot: game coordinator bot is not available right now")
)

// Client talks to the gc-bot sidecar.
type Client struct {
	baseURL string
	http    *http.Client
}

// New builds a Client. baseURL like "http://gc-bot:7300".
func New(baseURL string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		// Resolution can sit behind a queue in the sidecar; allow for that.
		http: &http.Client{Timeout: 45 * time.Second},
	}
}

// Resolve turns a share code into a downloadable GOTV replay URL.
func (c *Client) Resolve(ctx context.Context, shareCode string) (string, error) {
	body, err := json.Marshal(map[string]string{"shareCode": shareCode})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/resolve", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("gcbot: request failed: %w", err)
	}
	defer resp.Body.Close()

	var out struct {
		DemoURL string `json:"demoUrl"`
		Error   string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil && resp.StatusCode == http.StatusOK {
		return "", fmt.Errorf("gcbot: decode: %w", err)
	}

	switch resp.StatusCode {
	case http.StatusOK:
		if out.DemoURL == "" {
			return "", errors.New("gcbot: empty demoUrl in response")
		}
		return out.DemoURL, nil
	case http.StatusNotFound:
		return "", ErrNotFound
	case http.StatusServiceUnavailable:
		return "", ErrUnavailable
	default:
		if out.Error != "" {
			return "", fmt.Errorf("gcbot: %s", out.Error)
		}
		return "", fmt.Errorf("gcbot: unexpected status %d", resp.StatusCode)
	}
}

// RecentMatch is one entry of a player's Game Coordinator match list.
type RecentMatch struct {
	MatchID string `json:"matchId"`
	Time    int64  `json:"time"` // unix seconds the match finished
	DemoURL string `json:"demoUrl"`
	Scores  []int  `json:"scores"` // final [team1, team2]
}

// Recent fetches a player's ~8 most recent official matches straight from the
// Game Coordinator — no Leetify involvement. Requires the account's "Game
// details" privacy to be Public; otherwise the list comes back empty.
func (c *Client) Recent(ctx context.Context, steamID64 string) ([]RecentMatch, error) {
	body, err := json.Marshal(map[string]string{"steamId": steamID64})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/recent", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gcbot: request failed: %w", err)
	}
	defer resp.Body.Close()

	var out struct {
		Matches []RecentMatch `json:"matches"`
		Error   string        `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil && resp.StatusCode == http.StatusOK {
		return nil, fmt.Errorf("gcbot: decode: %w", err)
	}

	switch resp.StatusCode {
	case http.StatusOK:
		return out.Matches, nil
	case http.StatusServiceUnavailable:
		return nil, ErrUnavailable
	default:
		if out.Error != "" {
			return nil, fmt.Errorf("gcbot: %s", out.Error)
		}
		return nil, fmt.Errorf("gcbot: unexpected status %d", resp.StatusCode)
	}
}
