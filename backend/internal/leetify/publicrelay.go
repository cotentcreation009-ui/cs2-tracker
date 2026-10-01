package leetify

// The public API through the relay, and why it goes there FIRST.
//
// On 2026-10-01 at 07:01 UTC api-public.cs-prod.leetify.com stopped answering
// the VPS's address at all: every probe since has been 429 {"error":"Calm
// down son"} (server: LRL), the pause breaker in publicpause.go escalated to
// its thirty-minute cap and logged 26 pauses in a row, and the one request it
// lets through every half hour was refused every time — while the same
// request from a home connection, keyed with the same key, answered 200 at
// the same minute. It is the box's address that is burned, not the key and
// not the volume: one probe per thirty minutes is not a rate anyone limits.
//
// The key is address-independent, and the app routes already go through a
// keyed Cloudflare Worker (appprofile.go, "THE WALL"; docs/LEETIFY-RELAY.md)
// because the app host walls this network too. So the v3/v2 routes can take
// the same road: a change of return address, not a bypass — the same keyed
// request, the same routes, the same answer handed back status and all, and
// a 429 arriving through the relay pauses this process exactly as a direct
// one does (same breaker, same escalation, same ErrUnavailable).
//
// Relay FIRST, not relay-while-paused: the direct address is refused on
// every probe, so a design that tries it first spends a request to learn
// what it already knows and a pause to forget it. The direct path is the
// fallback instead, for the one case where the relay cannot answer FOR
// Leetify: the Worker is unreachable, Cloudflare answers for it (a 5xx),
// its key is refused, or it is an older paste that has no public routes
// (its 404 "not a relayed route"). Those are told apart from Leetify's own
// answers by the X-Relay-Upstream header the Worker stamps on everything it
// forwarded — an old Worker never sends it — so an un-updated Worker leaves
// the backend exactly where it is today, no worse, and says so in the log
// once per half hour rather than once per request.

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// relayUpstreamHeader is what the Worker stamps on every answer it forwarded
// from Leetify (deploy/leetify-relay.worker.js). Its absence on a non-2xx
// means the relay answered for itself.
const relayUpstreamHeader = "X-Relay-Upstream"

// publicRelayLogEvery bounds the "relay could not answer, asked directly"
// line: the first failure logs, the rest are counted and reported with the
// next line. The same half hour the pause caps at, so an operator reading
// the pause lines sees the relay's state on the same cadence.
const publicRelayLogEvery = publicPauseMax

// WithPublicRelay routes the public API (v3/v2) through a keyed relay first,
// with the direct host as the fallback (see the header). An empty url keeps
// the direct path only.
func WithPublicRelay(url, key string) Option {
	return func(c *Client) {
		c.publicRelayURL = strings.TrimRight(url, "/")
		c.publicRelayKey = key
	}
}

// PublicRelay reports whether the public API is asked through a relay — for
// the start-up log line.
func (c *Client) PublicRelay() bool { return c.publicRelayURL != "" }

// relayAnswered reports whether a relay response is Leetify's answer, as
// opposed to the relay's own. The stamp settles it; without one a 2xx is
// taken at face value (nothing but Leetify writes a profile) and anything
// else — an old Worker's 404, Cloudflare's 5xx, a 401 on the key, a 429
// from the Worker's own free-tier limit — is the relay failing to answer.
func relayAnswered(resp *http.Response) bool {
	if resp.Header.Get(relayUpstreamHeader) != "" {
		return true
	}
	return resp.StatusCode >= 200 && resp.StatusCode < 300
}

// publicGet performs one GET against the public API: through the relay when
// one is configured, directly otherwise — or when the relay could not answer
// for Leetify (relayAnswered). path carries its own query string. The caller
// owns the response body either way and reads status and headers off it
// exactly as off a direct answer: the Worker passes status, Retry-After and
// the body through untouched.
func (c *Client) publicGet(ctx context.Context, path string) (*http.Response, error) {
	if c.publicRelayURL == "" {
		return c.publicGetDirect(ctx, path)
	}
	req, err := c.newReq(ctx, c.publicRelayURL+path)
	if err != nil {
		return nil, err
	}
	// The public-API key rides along for the Worker to forward: the key is
	// what sets the rate tier, and it is the address that is burned, not it.
	req.Header.Set("X-Relay-Key", c.publicRelayKey)
	resp, err := c.doWithRetry(req)
	if err == nil && relayAnswered(resp) {
		return resp, nil
	}
	reason := "unreachable"
	if err == nil {
		reason = http.StatusText(resp.StatusCode)
		if reason == "" {
			reason = "unexpected status"
		}
		resp.Body.Close()
	}
	c.notePublicRelayFailed(path, resp, err, reason)
	if ctx.Err() != nil {
		// The relay ate the deadline; the direct request would only fail the
		// same way, and the caller wants the reason it has.
		return nil, ctx.Err()
	}
	return c.publicGetDirect(ctx, path)
}

func (c *Client) publicGetDirect(ctx context.Context, path string) (*http.Response, error) {
	req, err := c.newReq(ctx, c.baseURL+path)
	if err != nil {
		return nil, err
	}
	return c.doWithRetry(req)
}

// notePublicRelayFailed counts a relay failure and logs the first of each
// half hour, with how many went unlogged before it — one line an operator
// can grep for when a Worker paste is overdue, not one per lookup.
func (c *Client) notePublicRelayFailed(path string, resp *http.Response, err error, reason string) {
	skipped := c.publicRelayFailures.Add(1) - 1
	now := time.Now()
	last := c.publicRelayLoggedAt.Load()
	if now.UnixNano()-last < int64(publicRelayLogEvery) {
		return
	}
	if !c.publicRelayLoggedAt.CompareAndSwap(last, now.UnixNano()) {
		return
	}
	c.publicRelayFailures.Store(0)
	attrs := []any{"path", path, "reason", reason, "unlogged_before_this", skipped}
	if resp != nil {
		attrs = append(attrs, "status", resp.StatusCode)
	}
	if err != nil {
		attrs = append(attrs, "err", err)
	}
	slog.Warn("leetify public relay could not answer for Leetify; asking api-public directly (an old Worker paste? docs/LEETIFY-RELAY.md)", attrs...)
}
