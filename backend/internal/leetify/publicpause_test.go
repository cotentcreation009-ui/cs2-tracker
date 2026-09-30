package leetify

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// publicServer answers /v3/profile the way api-public did from the VPS on
// 2026-09-29: 429 {"error":"Calm down son"}, no Retry-After. Anything else
// is an app route, counted so a test can prove they were NOT asked while
// paused; the caller may install its own handler for them.
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

// lapse makes the current pause count as over — the deadline is in the past,
// as after a real wait — without waiting for it.
func lapse(c *Client) {
	c.publicPausedUntil.Store(time.Now().Add(-time.Second).UnixNano())
}

// logLines captures the package's slog output for a test's duration, so it
// can count the lines an operator would see.
type logLines struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (l *logLines) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.Write(p)
}

func (l *logLines) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.String()
}

func (l *logLines) count(substr string) int { return strings.Count(l.String(), substr) }

func captureLog(t *testing.T) *logLines {
	t.Helper()
	l := &logLines{}
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(l, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return l
}

const (
	pausedLine  = "v3/v2 routes paused"
	answersLine = "answers this address again"
)

// A 429 from the public API is a miss the site could not verify
// (ErrUnavailable, also ErrNotFound — never a 500), it pauses every public
// call, and the pause answers the next lookups without asking anyone: three
// lookups cost one request, and the app routes are not consulted. The first
// pause is five minutes, the only back-off Leetify has ever published.
func TestGetProfile_PublicRateLimitIsUnavailableAndPauses(t *testing.T) {
	var v3Calls, appCalls int32
	srv := publicServer(t, &v3Calls, &appCalls, "", nil)
	defer srv.Close()
	captureLog(t)

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
	if n := atomic.LoadInt32(&appCalls); n != 0 {
		t.Errorf("app routes asked %d times, want 0: a pause is not a 404", n)
	}
	if !c.Paused() {
		t.Error("the client must report itself paused")
	}
	if p := pauseLeft(c); p < 290*time.Second || p > 310*time.Second {
		t.Errorf("first pause = %v, want about 5m", p)
	}
	if left := c.PausedFor(); left < 290*time.Second || left > 310*time.Second {
		t.Errorf("PausedFor = %v, want about 5m", left)
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
	captureLog(t)

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

// A burst of concurrent 429s — the homepage's featured strip fires five
// lookups at once, every one of them in flight before the first answer could
// trip anything — is ONE rate limit: one five-minute pause, one Warn line, a
// streak of one. Only a 429 met after a pause has lapsed escalates: 10, 20,
// 30, 30 minutes, one line each. An answered request brings it back to five.
func TestGetProfile_PublicPauseEscalatesOnlyAfterALapse(t *testing.T) {
	const burst = 8
	var v3Calls, appCalls int32
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v3/profile" {
			atomic.AddInt32(&appCalls, 1)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		// Hold the burst until all of it is in flight, so the 429s land
		// together — the shape of a real burst, forced rather than hoped for.
		if n := atomic.AddInt32(&v3Calls, 1); n <= burst {
			if n == burst {
				close(release)
			}
			select {
			case <-release:
			case <-time.After(5 * time.Second):
				t.Error("the burst never fully arrived")
			}
		}
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":"Calm down son"}`))
	}))
	defer srv.Close()

	logs := captureLog(t)
	c := New(srv.URL, "", WithLegacyURL(srv.URL))
	var wg sync.WaitGroup
	for i := 0; i < burst; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := c.GetProfile(context.Background(), 42); !errors.Is(err, ErrUnavailable) {
				t.Errorf("burst lookup: err = %v, want ErrUnavailable", err)
			}
		}()
	}
	wg.Wait()
	if n := atomic.LoadInt32(&v3Calls); n != burst {
		t.Fatalf("/v3 asked %d times, want the whole burst of %d in flight", n, burst)
	}
	if s := c.publicLimitStreak.Load(); s != 1 {
		t.Errorf("streak after the burst = %d, want 1: concurrent 429s are one limit", s)
	}
	if p := pauseLeft(c); p < 290*time.Second || p > 310*time.Second {
		t.Errorf("pause after the burst = %v, want about 5m, not the cap", p)
	}
	if n := logs.count(pausedLine); n != 1 {
		t.Errorf("%d pause lines logged for one burst, want 1:\n%s", n, logs)
	}
	if !strings.Contains(logs.String(), "pause=5m0s limits_in_a_row=1") {
		t.Errorf("the one line must say what is happening (5m, streak 1):\n%s", logs)
	}

	// Each 429 met after a lapse doubles the pause, one line each.
	for i, w := range []time.Duration{10 * time.Minute, 20 * time.Minute, 30 * time.Minute, 30 * time.Minute} {
		lapse(c)
		if _, err := c.GetProfile(context.Background(), 42); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("trip %d: err = %v", i, err)
		}
		if p := pauseLeft(c); p < w-10*time.Second || p > w+10*time.Second {
			t.Errorf("pause after lapse %d = %v, want about %v", i, p, w)
		}
		if n := logs.count(pausedLine); n != 2+i {
			t.Errorf("after lapse %d: %d pause lines, want %d", i, n, 2+i)
		}
	}
	if n := atomic.LoadInt32(&v3Calls); n != burst+4 {
		t.Errorf("/v3 asked %d times, want the burst plus one per lapse (%d)", n, burst+4)
	}
	if n := atomic.LoadInt32(&appCalls); n != 0 {
		t.Errorf("app routes asked %d times, want 0", n)
	}

	// Leetify answers again (a 200/404 anywhere on the public host): one
	// Info line, the streak is gone, and the next 429 is a five-minute pause.
	c.notePublicAnswered()
	if n := logs.count(answersLine); n != 1 {
		t.Errorf("%d 'answers again' lines, want 1", n)
	}
	if c.publicLimitStreak.Load() != 0 {
		t.Error("an answered request resets the streak")
	}
	lapse(c)
	c.tripPublicPause("")
	if p := pauseLeft(c); p < 290*time.Second || p > 310*time.Second {
		t.Errorf("pause after an answer = %v, want about 5m", p)
	}
}

// A Retry-After that asks for longer than the escalated pause is honoured —
// Leetify sends none today; the day they do, it must not be ignored — up to
// the same thirty-minute cap, so a bogus value cannot park the routes until
// the next restart.
func TestGetProfile_PublicRateLimitHonoursRetryAfter(t *testing.T) {
	captureLog(t)
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

	absurd := publicServer(t, &v3Calls, &appCalls, "86400", nil)
	defer absurd.Close()
	c = New(absurd.URL, "", WithLegacyURL(absurd.URL))
	if _, err := c.GetProfile(context.Background(), 42); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("err = %v", err)
	}
	if p := pauseLeft(c); p < publicPauseMax-10*time.Second || p > publicPauseMax+10*time.Second {
		t.Errorf("pause = %v, want a day's Retry-After capped at %v", p, publicPauseMax)
	}
}

// While /v3 is paused the app routes are NOT asked, even though through the
// relay they would answer: /v3 never said "no", so for a member the app's
// thin non-member summary ("recent games only") would be served in place of
// their profile and evict their last full copy from the cache. The answer is
// ErrUnavailable, which the cache layer turns into that copy. Once the pause
// lapses and /v3 answers a genuine 404, the app routes get their say again.
func TestGetProfile_PausedNeverAsksTheAppRoutes(t *testing.T) {
	captureLog(t)
	var v3Status atomic.Int32 // 429 until the test flips it to a genuine 404
	v3Status.Store(http.StatusTooManyRequests)
	var v3Calls, appCalls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v3/profile":
			atomic.AddInt32(&v3Calls, 1)
			w.WriteHeader(int(v3Status.Load()))
			_, _ = w.Write([]byte(`{"error":"Calm down son"}`))
		case "/api/profile/42/recent-games/available-data-sources":
			atomic.AddInt32(&appCalls, 1)
			_, _ = w.Write([]byte(`{"dataSources":{"5v5":30}}`))
		case "/api/profile/42/recent-games/5v5":
			atomic.AddInt32(&appCalls, 1)
			_, _ = w.Write([]byte(`{"aimRating":72.24,"matchesPlayed":30,"kdRatio":1.21,"winRate":0.6}`))
		case "/api/profile/42/meta":
			atomic.AddInt32(&appCalls, 1)
			_, _ = w.Write([]byte(`{"steam64Id":"42","name":"dane"}`))
		default:
			atomic.AddInt32(&appCalls, 1)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	c := New(srv.URL, "the-key", WithLegacyURL(srv.URL))
	for i := 0; i < 3; i++ {
		if _, err := c.GetProfile(context.Background(), 42); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("lookup %d while paused: err = %v, want ErrUnavailable", i, err)
		}
	}
	if n := atomic.LoadInt32(&appCalls); n != 0 {
		t.Errorf("app routes asked %d times while paused, want 0", n)
	}
	if n := atomic.LoadInt32(&v3Calls); n != 1 {
		t.Errorf("/v3 asked %d times, want 1", n)
	}

	// The pause lapses and /v3 answers a genuine "no": the fallback is back,
	// and a 404 is an answer — the pause does not re-trip.
	v3Status.Store(http.StatusNotFound)
	lapse(c)
	p, err := c.GetProfile(context.Background(), 42)
	if err != nil {
		t.Fatalf("after the pause: %v", err)
	}
	if p.Source != "app:5v5" || p.Name != "dane" || p.Rating.Aim != 72.24 {
		t.Errorf("profile after the pause = %+v, want the app copy", p)
	}
	if c.Paused() {
		t.Error("a 404 is an answer: the pause must not re-trip")
	}
	if n := atomic.LoadInt32(&appCalls); n == 0 {
		t.Error("app routes were not asked after a genuine 404")
	}

	// The fallback off changes nothing about the pause: still ErrUnavailable.
	off := New(srv.URL, "", WithLegacyURL(srv.URL), WithAppFallback(false))
	off.tripPublicPause("")
	if _, err := off.GetProfile(context.Background(), 42); !errors.Is(err, ErrUnavailable) {
		t.Errorf("fallback off, paused: err = %v, want ErrUnavailable", err)
	}
}

// The kill switch: with the breaker off every lookup asks /v3 and a 429 is
// the plain error it was before the pause existed. It is still not retried —
// three lookups are three requests, not six; the retry's removal is
// deliberate and unconditional.
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
		t.Errorf("/v3 asked %d times, want 3: one per lookup, none retried", n)
	}
	if c.Paused() || c.PausedFor() != 0 {
		t.Error("nothing pauses with the breaker off")
	}
}

// The demo-analysis lookup shares the pause: a 429 on the match list is
// ErrUnavailable, and the next call asks nothing.
func TestMatchReference_RateLimitIsUnavailable(t *testing.T) {
	captureLog(t)
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
