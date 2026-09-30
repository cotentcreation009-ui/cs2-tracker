package leetify

// The public API's rate limit, and the pause that answers it.
//
// On 2026-09-29 around 20:30 UTC api-public.cs-prod.leetify.com began
// answering EVERY request from the VPS's address with 429 {"error":"Calm down
// son"} — keyed or not, on the bare root as much as on /v3/profile, with no
// Retry-After — while the same key from a home connection got 200. It is a
// per-address block, not a per-key quota. The client at the time treated a
// 429 as transient and retried it 200 ms later, nothing cached the outcome,
// and matchsync kept spending its 8/min budget against the wall: roughly
// 870 refused requests an hour for a day, two thirds of them the site's own
// doing (the homepage's featured strip, the bridge re-fetching the same 1,078
// share codes up to 65 times each). A rate limit that is answered by more
// requests never lifts.
//
// So a 429 pauses every v3/v2 call from this process. The shape is the 511
// wall breaker's (appprofile.go), on purpose: an escalating pause, one Warn
// per pause, a reset on any answered request, and a sentinel error
// (ErrUnavailable) that every caller already reads as a miss and the cache
// layer keeps for seconds rather than minutes. The pause starts at five
// minutes — the one back-off Leetify has ever published, on their FACEIT
// demo-upload API ("wait 300 seconds") — and doubles for every 429 met after
// a pause lapses, to a cap of thirty. A Retry-After, should Leetify ever send
// one, is honoured when it asks for longer.

import (
	"log/slog"
	"strconv"
	"time"
)

const (
	publicPauseFirst = 5 * time.Minute
	publicPauseMax   = 30 * time.Minute
)

// publicPaused is the gate every public-API call passes first. It counts the
// requests it turns away, for the line logged when the API answers again.
func (c *Client) publicPaused() bool {
	if !c.publicBreaker {
		return false
	}
	if time.Now().UnixNano() < c.publicPausedUntil.Load() {
		c.publicRefused.Add(1)
		return true
	}
	return false
}

// Paused reports whether the public API is currently being left alone, for
// the API layer (a 503 with a reason instead of a 404; the bridge and the
// chain poller skipping a round). It bumps no counter.
func (c *Client) Paused() bool {
	return c.publicBreaker && time.Now().UnixNano() < c.publicPausedUntil.Load()
}

// tripPublicPause pauses the public routes for the streak's pause and says
// so once per pause, not once per request — the log line that tells an
// operator the panel is currently dark, and until when. retryAfter is the
// response header as sent (seconds form only; Leetify sends none today).
func (c *Client) tripPublicPause(retryAfter string) {
	streak := c.publicLimitStreak.Add(1)
	pause := publicPauseFirst
	for i := int32(1); i < streak && pause < publicPauseMax; i++ {
		pause *= 2
	}
	if pause > publicPauseMax {
		pause = publicPauseMax
	}
	if secs, err := strconv.Atoi(retryAfter); err == nil && secs > 0 {
		if asked := time.Duration(secs) * time.Second; asked > pause {
			pause = asked
		}
	}
	now := time.Now()
	until := now.Add(pause)
	if prev := c.publicPausedUntil.Swap(until.UnixNano()); now.UnixNano() >= prev {
		if prev == 0 || c.publicPausedSince.Load() == 0 {
			c.publicPausedSince.Store(now.UnixNano())
			c.publicRefused.Store(0)
		}
		hdr := retryAfter
		if hdr == "" {
			hdr = "none"
		}
		slog.Warn(`leetify public API rate-limited this address (429 "Calm down son"); v3/v2 routes paused`,
			"until", until.UTC().Format(time.RFC3339), "pause", pause.String(),
			"limits_in_a_row", streak, "retry_after", hdr)
	}
}

// notePublicAnswered resets the escalation: the public API answered a
// request from this address. The first answer after a run of pauses is
// logged with how long the address was limited and how many requests the
// pause answered locally — that timestamp minus the deploy is the empirical
// length of Leetify's block.
func (c *Client) notePublicAnswered() {
	if streak := c.publicLimitStreak.Swap(0); streak > 0 {
		since := c.publicPausedSince.Swap(0)
		var pausedFor time.Duration
		if since > 0 {
			pausedFor = time.Since(time.Unix(0, since)).Round(time.Second)
		}
		slog.Info("leetify public API answers this address again",
			"paused_for", pausedFor.String(),
			"refused_while_paused", c.publicRefused.Load(),
			"limits_in_a_row", streak)
	}
}
