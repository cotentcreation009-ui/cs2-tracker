package leetify

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// A trimmed real response shape: the fields the CheatMeter actually scores.
const matchBody = `{
  "id":"f48722af-94ef-4c7c-b3d0-7954cba6c304",
  "finished_at":"2026-07-07T08:32:16.000Z",
  "data_source":"matchmaking",
  "data_source_match_id":"CSGO-X5EDM-CJCpX-dTvfS-kMP7u-EhMMB",
  "map_name":"de_cache",
  "team_scores":[{"team_number":2,"score":13},{"team_number":3,"score":8}],
  "stats":[
    {"steam64_id":"76561197995150836","name":"Malone Lam","preaim":5.4,"reaction_time":0.6719,
     "accuracy_head":0.2162,"accuracy":0.2296,"spray_accuracy":0.3846,
     "counter_strafing_shots_good_ratio":0.931,"leetify_rating":0.0873,
     "total_kills":21,"total_deaths":12,"kd_ratio":1.75,"dpr":100,"rounds_count":21},
    {"steam64_id":"76561198347841137","name":"Someone Else","preaim":9.1,"reaction_time":0.55,
     "leetify_rating":-0.02,"total_kills":14,"total_deaths":18,"kd_ratio":0.78}
  ]
}`

func testClient(t *testing.T, h http.HandlerFunc) (*Client, func()) {
	t.Helper()
	srv := httptest.NewServer(h)
	// The package limiter is a real 8/min budget; tests must not wait on it.
	restore := matchLimiter
	matchLimiter = newTestLimiter()
	return New(srv.URL, "", WithLegacyURL(srv.URL)), func() {
		matchLimiter = restore
		srv.Close()
	}
}

func TestMatchByShareCode(t *testing.T) {
	var gotPath string
	c, done := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Write([]byte(matchBody))
	})
	defer done()

	m, err := c.MatchByShareCode(context.Background(), "CSGO-X5EDM-CJCpX-dTvfS-kMP7u-EhMMB")
	if err != nil {
		t.Fatal(err)
	}
	if gotPath != "/v2/matches/matchmaking/CSGO-X5EDM-CJCpX-dTvfS-kMP7u-EhMMB" {
		t.Errorf("path = %s", gotPath)
	}
	if m.MapName != "de_cache" || m.DataSource != "matchmaking" || len(m.Stats) != 2 {
		t.Fatalf("match not parsed: %+v", m)
	}
	// team_scores is a list of {team_number, score} objects, not a bare pair —
	// the live API disagreed with the first fixture written for it.
	if w, l := m.Scoreline(); w != 13 || l != 8 {
		t.Errorf("scoreline = %d-%d, want 13-8", w, l)
	}
	// The whole point: the demo-derived tells survive the round trip.
	p, ok := m.Player(76561197995150836)
	if !ok {
		t.Fatal("target player row missing")
	}
	if p.Preaim != 5.4 || p.ReactionTime != 0.6719 || p.AccuracyHead != 0.2162 {
		t.Errorf("aim telemetry lost: %+v", p)
	}
	if p.KDRatio != 1.75 || p.TotalKills != 21 {
		t.Errorf("scoreboard fields lost: %+v", p)
	}
	// A match fetched for one player carries the rest of the lobby — that is
	// what makes coverage compound.
	if _, ok := m.Player(76561198347841137); !ok {
		t.Error("lobby-mate row missing; every fetch should enrich all ten")
	}
	if _, ok := m.Player(1); ok {
		t.Error("Player() matched a steamid that is not in the match")
	}
	if got := m.FinishedTime(); got.Year() != 2026 || got.Month() != time.July {
		t.Errorf("finished time = %v", got)
	}
}

func TestMatchAbsentCases(t *testing.T) {
	// Leetify answers 500 (not 404) for a code it has no record of, because the
	// route is unguarded upstream. Both must read as "absent", never as an
	// outage worth retrying — a retry only spends the rate budget.
	for _, status := range []int{404, 500} {
		c, done := testClient(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(status)
		})
		_, err := c.MatchByShareCode(context.Background(), "CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE")
		done()
		if err != ErrNotFound {
			t.Errorf("status %d: err = %v, want ErrNotFound", status, err)
		}
	}
	// An empty stats array is a report with nobody in it: also absent.
	c, done := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"id":"x","stats":[]}`))
	})
	defer done()
	if _, err := c.MatchByShareCode(context.Background(), "CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE"); err != ErrNotFound {
		t.Errorf("empty stats: err = %v, want ErrNotFound", err)
	}
}

func TestShareCodeValidation(t *testing.T) {
	// Real codes, measured working against the live API.
	for _, ok := range []string{
		"CSGO-X5EDM-CJCpX-dTvfS-kMP7u-EhMMB",
		"CSGO-OLBnc-niHAz-ER5uT-oUpH6-wyTaK",
	} {
		if !ValidShareCode(ok) {
			t.Errorf("%q should be valid", ok)
		}
	}
	// Rejected before a request is spent: upstream answers 500 for these, and a
	// malformed code can never resolve.
	for _, bad := range []string{
		"", "CSGO-X5EDM", "X5EDM-CJCpX-dTvfS-kMP7u-EhMMB",
		"CSGO-X5EDM-CJCpX-dTvfS-kMP7u-EhMM", // short group
		"CSGO-X5EDM-CJCpX-dTvfS-kMP7u-EhMMBB",
		"67458e1e-eb68-40e0-ab68-fa4b5dd6cb44", // a Leetify uuid, not a share code
		"CSGO-X5EDM-CJCpX-dTvfS-kMP7u-EhM/B",
	} {
		if ValidShareCode(bad) {
			t.Errorf("%q should be rejected", bad)
		}
	}
	// A malformed code must not reach the network at all.
	var called bool
	c, done := testClient(t, func(w http.ResponseWriter, r *http.Request) { called = true })
	defer done()
	if _, err := c.MatchByShareCode(context.Background(), "nonsense"); err == nil {
		t.Error("expected an error for a malformed code")
	}
	if called {
		t.Error("a malformed share code spent a request")
	}
}

func TestMatchByID(t *testing.T) {
	var gotPath string
	c, done := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Write([]byte(matchBody))
	})
	defer done()
	if _, err := c.MatchByID(context.Background(), "f48722af-94ef-4c7c-b3d0-7954cba6c304"); err != nil {
		t.Fatal(err)
	}
	if gotPath != "/v2/matches/f48722af-94ef-4c7c-b3d0-7954cba6c304" {
		t.Errorf("path = %s", gotPath)
	}
	if _, err := c.MatchByID(context.Background(), "bad/id"); err == nil {
		t.Error("expected an error for an id with a path separator")
	}
}

func TestMatchLimiterIsShared(t *testing.T) {
	// The upstream limit is per IP, so the budget must be package-level: two
	// Clients on one box share one window.
	if matchLimiter == nil {
		t.Fatal("limiter missing")
	}
	if burst := matchLimiter.Burst(); burst != 1 {
		t.Errorf("burst = %d, want 1 (a burst lets one page spend the whole window)", burst)
	}
}
