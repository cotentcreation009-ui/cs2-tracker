package leetify

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"
)

// Hits the real Leetify API. Skipped unless LEETIFY_LIVE=1 so CI stays offline.
//
// This is the load-bearing claim of the whole share-code path: a player whose
// PROFILE Leetify refuses to serve still has full telemetry in their MATCH
// reports. If this test ever fails with ErrNotFound on both codes, Leetify has
// closed the carve-out and the bridge should be switched off.
func TestLiveMatchByShareCode(t *testing.T) {
	if os.Getenv("LEETIFY_LIVE") != "1" {
		t.Skip("set LEETIFY_LIVE=1 to hit Leetify")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	c := New("https://api-public.cs-prod.leetify.com", os.Getenv("LEETIFY_API_KEY"))

	// A real match played by 76561197995150836 — an account whose /v3/profile
	// 404s. Sourced from a public match history.
	const code = "CSGO-X5EDM-CJCpX-dTvfS-kMP7u-EhMMB"
	m, err := c.MatchByShareCode(ctx, code)
	if err != nil {
		t.Fatalf("MatchByShareCode: %v", err)
	}
	if len(m.Stats) != 10 {
		t.Errorf("rows = %d, want 10 (a full lobby)", len(m.Stats))
	}
	p, ok := m.Player(76561197995150836)
	if !ok {
		t.Fatal("the unregistered player has no row — the carve-out may have closed")
	}
	if p.Preaim <= 0 || p.ReactionTime <= 0 {
		t.Errorf("aim telemetry empty for an unregistered player: %+v", p)
	}
	t.Logf("%s on %s: preaim %.2f deg, reaction %.3fs, kd %.2f",
		p.Name, m.MapName, p.Preaim, p.ReactionTime, p.KDRatio)

	// A code Leetify has no record of must read as absent, not as an error.
	if _, err := c.MatchByShareCode(ctx, "CSGO-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA"); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown code: err = %v, want ErrNotFound", err)
	}
}
