// Package ai is a tiny client for the Anthropic Messages API, used to turn a
// player's assembled stats into a short written read. Optional: with no API key
// the client reports not-configured and callers degrade gracefully.
package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// ErrNotConfigured is returned when a provider has no credentials.
var ErrNotConfigured = errors.New("ai: not configured")

// ProviderError is a non-200 reply from a model backend. Error() carries the
// upstream body for server logs; ClientMessage() is safe to return to API
// clients — provider + status only, never the upstream body (which can contain
// GCP project IDs / IAM resource paths on a Vertex 4xx).
type ProviderError struct {
	Provider string
	Status   int
	Body     string // upstream response snippet — server-side only
}

func (e *ProviderError) Error() string {
	if e.Body != "" {
		return fmt.Sprintf("ai: %s responded %d: %s", e.Provider, e.Status, e.Body)
	}
	return fmt.Sprintf("ai: %s responded %d", e.Provider, e.Status)
}

// ClientMessage is the body-free message safe to surface to API clients.
func (e *ProviderError) ClientMessage() string {
	return fmt.Sprintf("the %s API responded %d — check the service-account role / API enablement (details in server logs)", e.Provider, e.Status)
}

// Provider is any model backend that can turn a system+user prompt into text.
type Provider interface {
	Configured() bool
	Analyze(ctx context.Context, system, user string) (string, error)
}

const endpoint = "https://api.anthropic.com/v1/messages"

// Client talks to the Anthropic Messages API (fallback provider).
type Client struct {
	key   string
	model string
	http  *http.Client
}

func NewAnthropic(key, model string) *Client {
	if model == "" {
		model = "claude-haiku-4-5-20251001"
	}
	return &Client{key: key, model: model, http: &http.Client{Timeout: 30 * time.Second}}
}

func (c *Client) Configured() bool { return c != nil && c.key != "" }

// Analyze sends a system + user prompt and returns the model's text reply.
func (c *Client) Analyze(ctx context.Context, system, user string) (string, error) {
	if !c.Configured() {
		return "", ErrNotConfigured
	}
	payload, err := json.Marshal(map[string]any{
		"model":      c.model,
		"max_tokens": 700,
		"system":     system,
		"messages":   []map[string]string{{"role": "user", "content": user}},
	})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-api-key", c.key)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return "", &ProviderError{Provider: "anthropic", Status: resp.StatusCode}
	}
	var out struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return "", err
	}
	var text string
	for _, p := range out.Content {
		if p.Type == "text" {
			text += p.Text
		}
	}
	return text, nil
}
