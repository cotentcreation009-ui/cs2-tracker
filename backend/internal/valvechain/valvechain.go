// Package valvechain walks a player's share-code chain through Valve's
// sanctioned Web API.
//
// Every finished CS2 match has a share code, and Valve links each player's
// codes into a chain: given one code and the account's match-history
// authentication code (issued by the owner on Steam's help site), the
// GetNextMatchSharingCode endpoint returns the following one. Walking the
// chain is how Leetify and csstats discover their users' matches; this is the
// industry's front door, not a side channel.
//
// Sharp edges, all load-bearing:
//
//   - A known-code older than about a month is rejected (412). The chain must
//     be walked regularly or re-seeded by the owner; there is no backfill.
//   - "Caught up" is signalled two ways in the wild: HTTP 202, and a 200 whose
//     nextcode is the literal string "n/a". Both mean poll again later.
//   - Error bodies are HTML, not JSON. Decode only on success.
//   - 403 means the auth code is bad or revoked — retrying cannot help, and
//     repeats are reputedly punished with 503s. Stop and tell the owner.
package valvechain

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"golang.org/x/time/rate"
)

var (
	// ErrCaughtUp: the head of the chain — no newer match yet. The normal
	// steady-state answer, not a failure.
	ErrCaughtUp = errors.New("chain head reached")
	// ErrBadAuth: Valve rejected the authentication code. Owner must reissue.
	ErrBadAuth = errors.New("match-history auth code rejected")
	// ErrStaleCode: the known code is too old (Valve enforces ~1 month) or not
	// this account's. Owner must supply a fresh seed from the game client.
	ErrStaleCode = errors.New("known share code too old or foreign")
	// ErrThrottled: back off; also Valve's response to repeated bad requests.
	ErrThrottled = errors.New("throttled by the Steam API")
)

// limiter paces the whole process to one chain step per second. The budget cap
// is 100k calls/day per key; this keeps a runaway loop four times under it.
var limiter = rate.NewLimiter(rate.Every(time.Second), 1)

type Client struct {
	// Key is the Steam Web API key (the site's, not the player's).
	Key string
	// BaseURL overrides api.steampowered.com in tests.
	BaseURL string
	HTTP    *http.Client
}

func (c *Client) base() string {
	if c.BaseURL != "" {
		return c.BaseURL
	}
	return "https://api.steampowered.com"
}

func (c *Client) client() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 15 * time.Second}
}

// Next returns the share code after known in the account's chain.
func (c *Client) Next(ctx context.Context, steamID uint64, authCode, known string) (string, error) {
	if err := limiter.Wait(ctx); err != nil {
		return "", err
	}
	q := url.Values{
		"key":        {c.Key},
		"steamid":    {strconv.FormatUint(steamID, 10)},
		"steamidkey": {authCode},
		"knowncode":  {known},
	}
	u := c.base() + "/ICSGOPlayers_730/GetNextMatchSharingCode/v1/?" + q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", err
	}
	resp, err := c.client().Do(req)
	if err != nil {
		return "", fmt.Errorf("valvechain: request failed: %w", err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		// fall through to decode
	case http.StatusAccepted:
		return "", ErrCaughtUp
	case http.StatusForbidden:
		return "", ErrBadAuth
	case http.StatusPreconditionFailed:
		return "", ErrStaleCode
	case http.StatusTooManyRequests, http.StatusServiceUnavailable:
		return "", ErrThrottled
	default:
		return "", fmt.Errorf("valvechain: unexpected status %d", resp.StatusCode)
	}

	var body struct {
		Result struct {
			NextCode string `json:"nextcode"`
		} `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", fmt.Errorf("valvechain: decode: %w", err)
	}
	if body.Result.NextCode == "" || body.Result.NextCode == "n/a" {
		return "", ErrCaughtUp
	}
	return body.Result.NextCode, nil
}

// Walk follows the chain from known, at most maxSteps forward, and returns the
// codes found in oldest-first order. Reaching the head is success, not error;
// any other failure returns the codes gathered so far alongside it, because a
// partial walk still names real matches worth fetching.
func (c *Client) Walk(ctx context.Context, steamID uint64, authCode, known string, maxSteps int) ([]string, error) {
	var out []string
	cur := known
	for i := 0; i < maxSteps; i++ {
		next, err := c.Next(ctx, steamID, authCode, cur)
		if errors.Is(err, ErrCaughtUp) {
			return out, nil
		}
		if err != nil {
			return out, err
		}
		out = append(out, next)
		cur = next
	}
	return out, nil
}
