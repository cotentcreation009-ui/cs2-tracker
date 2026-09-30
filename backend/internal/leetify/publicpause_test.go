package leetify

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// publicServer answers /v3/profile the way api-public did from the VPS on
// 2026-09-29: 429 {"error":"Calm down son"}, no Retry-After. The app routes
// (which GetProfile falls through to while paused) answer 404 unless the
// caller installs its own handler for them.
func publicServer(t *testing.T, v3Calls, appCalls *int32, retryAfter string, app http.HandlerFunc) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v3/profile" || r.URL.Path == "/v3/profile/matches":
			atomic.AddInt32(v3Calls, 1)
			if retryAfter != "" {
				w.Header().Set("Retry-After", retryAfter)
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":"Calm down son"}`))
		default:
			atomic.AddInt32(appCalls, 1)
			if app != nil {
				app(w, r)
				return
			}
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

func pauseLeft(c *Client) time.Duration {
	return time.Until(time.Unix(0, c.publicPausedUntil.Load()))
}

// A 429 from the public API is a miss the site could not verify
// (ErrUnavailable, also ErrNotFound — never a 500), it pauses every public
// call, and the pause answers the next lookups without asking Leetify: three
// lookups cost one request. The first pause is five minutes, the only
// back-off Leetify has ever published.
func TestGetProfile_PublicRateLimitIsUnavailableAndPauses(t *testing.T) {
	var v3Calls, appCalls int32
	srv := publicServer(t, &v3Calls, &appCalls, "", nil)
	defer srv.Close()

	c := New(srv.URL, "the-key", WithLegacyURL(srv.URL))
	for i := 0; i < 3; i++ {
		_, err := c.GetProfile(context.Background(), 42)
		if !errors.Is(err, ErrUnavailable) || !errors.Is(err, ErrNotFound) {
			t.Fatalf("lookup %d: err = %v, want ErrUnavailable (which is also ErrNotFound)", i, err)
		}
	}
	if n := atomic.LoadInt32(&v3Calls); n != 1 {
		t.Errorf("/v3 asked %d times, want 1: the pause answers the rest", n)
	}
	if !c.Paused() {
		t.Error("the client must report itself paused")
	}
	if p := pauseLeft(c); p < 290*time.Second || p > 310*time.Second {
		t.Errorf("first pause = %v, want about 5m", p)
	}
	if n := c.publicRefused.Load(); n != 2 {
		t.Errorf("refused while paused = %d, want 2", n)
	}
}

// A 429 is never retried: the 200 ms retry was doubling the traffic the limit
// was answering. A 503 is still worth one more try.
func TestGetProfile_PublicRateLimitIsNotRetried(t *testing.T) {
	if transientStatus(http.StatusTooManyRequests) {
		t.Fatal("429 must not be a transient status")
	}
	if !transientStatus(http.StatusServiceUnavailable) {
		t.Fatal("503 is still transient")
	}

	var calls int32
	flaky := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer flaky.Close()
	c := New(flaky.URL, "", WithLegacyURL(flaky.URL))
	if _, err := c.GetProfile(context.Background(), 42); err == nil {
		t.Fatal("a 503 twice over must error")
	}
	if n := atomic.LoadInt32(&calls); n != 2 {
		t.Errorf("503: %d attempts, want 2", n)
	}

	var v3Calls, appCalls int32
	limited := publicServer(t, &v3Calls, &appCalls, "", nil)
	defer limited.Close()
	c = New(limited.URL, "", WithLegacyURL(limited.URL))
	_, _ = c.GetProfile(context.Background(), 42)
	if n := atomic.LoadInt32(&v3Calls); n != 1 {
		t.Errorf("429: %d attempts, want 1", n)
	}
}

// Each 429 met after a pause lapses doubles the pause — 5, 10, 20, 30, 30
// minutes — and an answered request brings it back to five.
func TestGetProfile_PublicPauseEscalatesAndResets(t *testing.T) {
	var v3Calls, appCalls int32
	srv := publicServer(t, &v3Calls, &appCalls, "", nil)
	defer srv.Close()
	c := New(srv.URL, "", WithLegacyURL(srv.URL))

	want := []time.Duration{5 * time.Minute, 10 * time.Minute, 20 * time.Minute, 30 * time.Minute, 30 * time.Minute}
	for i, w := range want {
		c.publicPausedUntil.Store(0)
		if _, err := c.GetProfile(context.Background(), 42); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("trip %d: err = %v", i, err)
		}
		if p := pauseLeft(c); p < w-10*time.Second || p > w+10*time.Second {
			t.Errorf("pause %d = %v, want about %v", i, p, w)
		}
	}
	if n := atomic.LoadInt32(&v3Calls); n != int32(len(want)) {
		t.Errorf("/v3 asked %d times, want one per lapsed pause (%d)", n, len(want))
	}

	// Leetify answers again (a 200 anywhere on the public host resets it).
	c.notePublicAnswered()
	if c.publicLimitStreak.Load() != 0 {
		t.Error("an answered request resets the streak")
	}
	c.publicPausedUntil.Store(0)
	c.tripPublicPause("")
	if p := pauseLeft(c); p < 290*time.Second || p > 310*time.Second {
		t.Errorf("pause after an answer = %v, want about 5m", p)
	}
}

// A Retry-After that asks for longer than the escalated pause is honoured.
// Leetify sends none today; the day they do, it must not be ignored.
func TestGetProfile_PublicRateLimitHonoursRetryAfter(t *testing.T) {
	var v3Calls, appCalls int32
	srv := publicServer(t, &v3Calls, &appCalls, "900", nil)
	defer srv.Close()
	c := New(srv.URL, "", WithLegacyURL(srv.URL))
	if _, err := c.GetProfile(context.Background(), 42); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("err = %v", err)
	}
	if p := pauseLeft(c); p < 15*time.Minute-10*time.Second || p > 15*time.Minute+10*time.Second {
		t.Errorf("pause = %v, want the header's 15m over the escalated 5m", p)
	}
}

// While /v3 is paused the app routes get their say: they leave through the
// relay, another network, so a member's app summary beats an empty panel.
// But their "no" is not a miss — /v3 never answered — so it stays
// ErrUnavailable, never the five-minute negative cache a real miss earns.
func TestGetProfile_PausedFallsThroughToAppRoutes(t *testing.T) {
	var v3Calls, appCalls int32
	srv := publicServer(t, &v3Calls, &appCalls, "", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("_leetify_key") != "" {
			t.Errorf("the public-API key must not be sent to the app routes: %s", r.URL.Path)
		}
		switch r.URL.Path {
		case "/api/profile/42/recent-games/available-data-sources":
			_, _ = w.Write([]byte(`{"dataSources":{"5v5":30}}`))
		case "/api/profile/42/recent-games/5v5":
			_, _ = w.Write([]byte(`{"aimRating":72.24,"matchesPlayed":30,"kdRatio":1.21,"winRate":0.6}`))
		case "/api/profile/42/meta":
			_, _ = w.Write([]byte(`{"steam64Id":"42","name":"dane"}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})
	defer srv.Close()

	c := New(srv.URL, "the-key", WithLegacyURL(srv.URL))
	p, err := c.GetProfile(context.Background(), 42)
	if err != nil {
		t.Fatalf("GetProfile while paused: %v", err)
	}
	if p.Name != "dane" || p.Source != "app:5v5" || p.Rating.Aim != 72.24 {
		t.Errorf("profile = %+v", p)
	}
	if n := atomic.LoadInt32(&v3Calls); n != 1 {
		t.Errorf("/v3 asked %d times, want 1", n)
	}
	// A second lookup, still paused: straight to the app routes.
	if _, err := c.GetProfile(context.Background(), 42); err != nil {
		t.Fatalf("second lookup: %v", err)
	}
	if n := atomic.LoadInt32(&v3Calls); n != 1 {
		t.Errorf("/v3 asked %d times after the pause, want still 1", n)
	}

	// The app has nothing for player 7: not a miss, because /v3 was never asked.
	_, err = c.GetProfile(context.Background(), 7)
	if !errors.Is(err, ErrUnavailable) {
		t.Errorf("app 404 while paused: err = %v, want ErrUnavailable (not a plain ErrNotFound)", err)
	}

	// With the fallback off there is nothing to ask: unavailable at once.
	off := New(srv.URL, "", WithLegacyURL(srv.URL), WithAppFallback(false))
	if _, err := off.GetProfile(context.Background(), 42); !errors.Is(err, ErrUnavailable) {
		t.Errorf("fallback off: err = %v, want ErrUnavailable", err)
	}
}

// The kill switch: with the breaker off every lookup asks /v3 and a 429 is
// the plain error it always was — the pre-2026-09-30 behaviour, verbatim.
func TestGetProfile_PublicBreakerOff(t *testing.T) {
	var v3Calls, appCalls int32
	srv := publicServer(t, &v3Calls, &appCalls, "", nil)
	defer srv.Close()
	c := New(srv.URL, "", WithLegacyURL(srv.URL), WithPublicBreaker(false))
	for i := 0; i < 3; i++ {
		_, err := c.GetProfile(context.Background(), 42)
		if err == nil || errors.Is(err, ErrNotFound) {
			t.Fatalf("lookup %d: err = %v, want a generic error", i, err)
		}
	}
	if n := atomic.LoadInt32(&v3Calls); n != 3 {
		t.Errorf("/v3 asked %d times, want 3", n)
	}
	if c.Paused() {
		t.Error("nothing pauses with the breaker off")
	}
}

// The demo-analysis lookup shares the pause: a 429 on the match list is
// ErrUnavailable, and the next call asks nothing.
func TestMatchReference_RateLimitIsUnavailable(t *testing.T) {
	var v3Calls, appCalls int32
	srv := publicServer(t, &v3Calls, &appCalls, "", nil)
	defer srv.Close()
	c := New(srv.URL, "", WithLegacyURL(srv.URL))
	if _, err := c.MatchReference(context.Background(), 42, "g1"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("err = %v, want ErrUnavailable", err)
	}
	if _, err := c.MatchReference(context.Background(), 42, "g1"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("paused: err = %v, want ErrUnavailable", err)
	}
	if n := atomic.LoadInt32(&v3Calls); n != 1 {
		t.Errorf("/v3/profile/matches asked %d times, want 1", n)
	}
}
