package leetify

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// relayFailedLine is the one line an operator sees when the public relay
// cannot answer for Leetify and the direct host is asked instead.
const relayFailedLine = "public relay could not answer for Leetify"

const v3Profile = `{"name":"dane","steam64_id":"76561198200413817","total_matches":812,"winrate":0.53,
	"privacy_mode":"public","rating":{"aim":72.24},"ranks":{"premier":18500},"recent_matches":[]}`

// publicRelay stands in for the Worker with the public routes pasted in: it
// checks the relay key, records what it was asked, and answers for Leetify
// with the X-Relay-Upstream stamp the real one adds.
func publicRelay(t *testing.T, calls *int32, answer http.HandlerFunc) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(calls, 1)
		if r.Header.Get("X-Relay-Key") != "s3cret" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte("relay key"))
			return
		}
		w.Header().Set(relayUpstreamHeader, "public")
		answer(w, r)
	}))
}

// directHost is api-public as seen from the VPS since 2026-10-01: a 429 on
// everything. A test that wants it to answer installs its own handler.
func directHost(t *testing.T, calls *int32, answer http.HandlerFunc) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(calls, 1)
		if answer != nil {
			answer(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":"Calm down son"}`))
	}))
}

// With a relay configured every public route is asked THERE first — with the
// relay key and with the public-API key for the Worker to forward — and the
// direct host, whose address is burned, is never asked while the relay
// answers. The answer is read exactly as a direct one.
func TestPublicRelay_RelayAnswersAndDirectIsNeverAsked(t *testing.T) {
	captureLog(t)
	var directCalls, relayCalls int32
	direct := directHost(t, &directCalls, nil)
	defer direct.Close()
	var seen []string
	relay := publicRelay(t, &relayCalls, func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.URL.RequestURI())
		if r.Header.Get("_leetify_key") != "the-key" {
			t.Errorf("the public-API key must reach the relay for the Worker to forward; got %q", r.Header.Get("_leetify_key"))
		}
		switch {
		case r.URL.Path == "/v3/profile":
			_, _ = w.Write([]byte(v3Profile))
		case r.URL.Path == "/v3/profile/matches":
			_, _ = w.Write([]byte(`[{"id":"g1","data_source":"matchmaking","data_source_match_id":"CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE","finished_at":"2026-10-01T00:00:00Z"}]`))
		case strings.HasPrefix(r.URL.Path, "/v2/matches/matchmaking/"):
			_, _ = w.Write([]byte(`{"id":"m1","stats":[{"steam64_id":"76561198200413817"}]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})
	defer relay.Close()

	restore := matchLimiter
	matchLimiter = newTestLimiter()
	defer func() { matchLimiter = restore }()

	c := New(direct.URL, "the-key", WithLegacyURL(direct.URL), WithPublicRelay(relay.URL+"/", "s3cret"))
	if !c.PublicRelay() {
		t.Fatal("PublicRelay() must report the relay")
	}
	p, err := c.GetProfile(context.Background(), 76561198200413817)
	if err != nil {
		t.Fatalf("GetProfile: %v", err)
	}
	if p.Name != "dane" || p.Rating.Aim != 72.24 || p.Source != "" {
		t.Errorf("profile = %+v, want the v3 copy", p)
	}
	ref, err := c.MatchReference(context.Background(), 76561198200413817, "g1")
	if err != nil || ref.ID != "CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE" {
		t.Errorf("MatchReference = %+v, %v", ref, err)
	}
	if _, err := c.MatchByShareCode(context.Background(), "CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE"); err != nil {
		t.Errorf("MatchByShareCode: %v", err)
	}
	want := []string{
		"/v3/profile?steam64_id=76561198200413817",
		"/v3/profile/matches?steam64_id=76561198200413817",
		"/v2/matches/matchmaking/CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE",
	}
	if strings.Join(seen, "\n") != strings.Join(want, "\n") {
		t.Errorf("relay asked for:\n%s\nwant:\n%s", strings.Join(seen, "\n"), strings.Join(want, "\n"))
	}
	if n := atomic.LoadInt32(&directCalls); n != 0 {
		t.Errorf("direct host asked %d times with a relay answering, want 0", n)
	}
	if c.Paused() {
		t.Error("nothing pauses while the relay answers")
	}
}

// A 429 arriving THROUGH the relay is the same rate limit: ErrUnavailable,
// the same pause, the same escalation, and the Retry-After the Worker passed
// through is honoured. The direct host is not asked in its place — its
// address is the burned one.
func TestPublicRelay_RateLimitThroughTheRelayPausesTheSame(t *testing.T) {
	logs := captureLog(t)
	var directCalls, relayCalls int32
	direct := directHost(t, &directCalls, nil)
	defer direct.Close()
	relay := publicRelay(t, &relayCalls, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Retry-After", "900")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":"Calm down son"}`))
	})
	defer relay.Close()

	c := New(direct.URL, "the-key", WithLegacyURL(direct.URL), WithPublicRelay(relay.URL, "s3cret"))
	for i := 0; i < 3; i++ {
		_, err := c.GetProfile(context.Background(), 42)
		if !errors.Is(err, ErrUnavailable) || !errors.Is(err, ErrNotFound) {
			t.Fatalf("lookup %d: err = %v, want ErrUnavailable", i, err)
		}
	}
	if n := atomic.LoadInt32(&relayCalls); n != 1 {
		t.Errorf("relay asked %d times, want 1: the pause answers the rest", n)
	}
	if n := atomic.LoadInt32(&directCalls); n != 0 {
		t.Errorf("direct host asked %d times, want 0: a relayed 429 is Leetify's answer", n)
	}
	if p := pauseLeft(c); p < 15*time.Minute-10*time.Second || p > 15*time.Minute+10*time.Second {
		t.Errorf("pause = %v, want the relayed Retry-After's 15m", p)
	}
	if n := logs.count(pausedLine); n != 1 {
		t.Errorf("%d pause lines, want 1", n)
	}
	if n := logs.count(relayFailedLine); n != 0 {
		t.Errorf("a relayed 429 is not a relay failure; got %d failure lines:\n%s", n, logs)
	}
	// After a lapse the relay is asked again, not the direct host, and a
	// second 429 escalates as it would directly.
	lapse(c)
	if _, err := c.GetProfile(context.Background(), 42); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("after the lapse: err = %v", err)
	}
	if n := atomic.LoadInt32(&relayCalls); n != 2 {
		t.Errorf("relay asked %d times after the lapse, want 2", n)
	}
	if s := c.publicLimitStreak.Load(); s != 2 {
		t.Errorf("streak = %d, want 2", s)
	}
}

// A relay that cannot be reached is skipped for that call: the direct host
// is asked, answers, and the lookup succeeds — the relay never makes things
// worse than they were. The fallback is logged once per half hour, not once
// per lookup.
func TestPublicRelay_UnreachableRelayFallsBackToDirectAndLogsOnce(t *testing.T) {
	logs := captureLog(t)
	var directCalls int32
	direct := directHost(t, &directCalls, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Relay-Key") != "" {
			t.Error("the relay key must not reach Leetify")
		}
		if r.URL.Path != "/v3/profile" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_, _ = w.Write([]byte(v3Profile))
	})
	defer direct.Close()

	c := New(direct.URL, "the-key", WithLegacyURL(direct.URL), WithPublicRelay("http://127.0.0.1:1", "s3cret"))
	for i := 0; i < 3; i++ {
		p, err := c.GetProfile(context.Background(), 42)
		if err != nil {
			t.Fatalf("lookup %d with the relay down: %v", i, err)
		}
		if p.Name != "dane" {
			t.Errorf("lookup %d: profile = %+v", i, p)
		}
	}
	if n := atomic.LoadInt32(&directCalls); n != 3 {
		t.Errorf("direct host asked %d times, want 3", n)
	}
	if n := logs.count(relayFailedLine); n != 1 {
		t.Errorf("%d relay-failure lines for three fallbacks, want 1:\n%s", n, logs)
	}
	if !strings.Contains(logs.String(), "reason=unreachable") {
		t.Errorf("the line must say why:\n%s", logs)
	}
	// Half an hour on, the next failure is logged again, with the count of
	// the ones that were not.
	c.publicRelayLoggedAt.Store(time.Now().Add(-publicRelayLogEvery - time.Second).UnixNano())
	if _, err := c.GetProfile(context.Background(), 42); err != nil {
		t.Fatal(err)
	}
	if n := logs.count(relayFailedLine); n != 2 {
		t.Errorf("%d relay-failure lines after the log window lapsed, want 2", n)
	}
	if !strings.Contains(logs.String(), "unlogged_before_this=2") {
		t.Errorf("the second line must carry the two unlogged failures:\n%s", logs)
	}
}

// An older Worker paste has no public routes and answers 404 "not a relayed
// route" with no upstream stamp; Cloudflare answering for a broken Worker is
// a 5xx with none either; a key mismatch is a 401. Each is the relay failing
// to answer, so the direct host is asked for that call. A 404 WITH the stamp
// is Leetify's own "no profile" and goes to the app fallback as before.
func TestPublicRelay_RelayOwnAnswersFallBackToDirect(t *testing.T) {
	captureLog(t)
	for _, tc := range []struct {
		name   string
		status int
		body   string
	}{
		{"old worker 404", http.StatusNotFound, "not a relayed route"},
		{"cloudflare 500", http.StatusInternalServerError, "<html>Worker threw exception</html>"},
		{"key refused 401", http.StatusUnauthorized, "relay key"},
		{"free tier 429", http.StatusTooManyRequests, "<html>Error 1027</html>"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var directCalls, relayCalls int32
			direct := directHost(t, &directCalls, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/v3/profile" {
					w.WriteHeader(http.StatusNotFound)
					return
				}
				_, _ = w.Write([]byte(v3Profile))
			})
			defer direct.Close()
			relay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				atomic.AddInt32(&relayCalls, 1)
				w.WriteHeader(tc.status) // no X-Relay-Upstream: the relay speaking for itself
				_, _ = w.Write([]byte(tc.body))
			}))
			defer relay.Close()

			c := New(direct.URL, "the-key", WithLegacyURL(direct.URL), WithPublicRelay(relay.URL, "s3cret"))
			p, err := c.GetProfile(context.Background(), 42)
			if err != nil {
				t.Fatalf("GetProfile: %v", err)
			}
			if p.Name != "dane" {
				t.Errorf("profile = %+v, want the direct copy", p)
			}
			if n := atomic.LoadInt32(&relayCalls); n != 1 {
				t.Errorf("relay asked %d times, want 1", n)
			}
			if n := atomic.LoadInt32(&directCalls); n != 1 {
				t.Errorf("direct host asked %d times, want 1", n)
			}
			if c.Paused() {
				t.Error("a relay's own answer must not pause the public routes")
			}
		})
	}

	t.Run("leetify 404 through the relay", func(t *testing.T) {
		var directCalls, relayCalls, appCalls int32
		direct := directHost(t, &directCalls, nil)
		defer direct.Close()
		relay := publicRelay(t, &relayCalls, func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/v3/profile":
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write([]byte("Not Found"))
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
		})
		defer relay.Close()

		// One Worker serves both: the app relay and the public relay share it.
		c := New(direct.URL, "the-key", WithLegacyURL(direct.URL),
			WithAppRelay(relay.URL, "s3cret"), WithPublicRelay(relay.URL, "s3cret"))
		p, err := c.GetProfile(context.Background(), 42)
		if err != nil {
			t.Fatalf("GetProfile: %v", err)
		}
		if p.Source != "app:5v5" || p.Name != "dane" {
			t.Errorf("profile = %+v, want the app copy", p)
		}
		if n := atomic.LoadInt32(&directCalls); n != 0 {
			t.Errorf("direct host asked %d times, want 0: a stamped 404 is Leetify's answer", n)
		}
		if n := atomic.LoadInt32(&appCalls); n == 0 {
			t.Error("the app fallback must still run after a relayed 404")
		}
	})
}

// With the relay down and the direct address still refused, nothing is
// worse than before the relay existed: the direct 429 trips the same pause,
// and the pause answers the next lookups without asking anyone.
func TestPublicRelay_RelayDownAndDirectLimitedStillPauses(t *testing.T) {
	logs := captureLog(t)
	var directCalls int32
	direct := directHost(t, &directCalls, nil)
	defer direct.Close()

	c := New(direct.URL, "the-key", WithLegacyURL(direct.URL), WithPublicRelay("http://127.0.0.1:1", "s3cret"))
	for i := 0; i < 3; i++ {
		if _, err := c.GetProfile(context.Background(), 42); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("lookup %d: err = %v, want ErrUnavailable", i, err)
		}
	}
	if n := atomic.LoadInt32(&directCalls); n != 1 {
		t.Errorf("direct host asked %d times, want 1", n)
	}
	if !c.Paused() {
		t.Error("a direct 429 after a relay failure must pause as before")
	}
	if n := logs.count(pausedLine); n != 1 {
		t.Errorf("%d pause lines, want 1", n)
	}
}

// No relay configured: the direct path, exactly as before.
func TestPublicRelay_NoRelayIsTheDirectPath(t *testing.T) {
	var directCalls int32
	direct := directHost(t, &directCalls, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Relay-Key") != "" {
			t.Error("no relay key without a relay")
		}
		_, _ = w.Write([]byte(v3Profile))
	})
	defer direct.Close()
	c := New(direct.URL, "the-key", WithLegacyURL(direct.URL), WithPublicRelay("", ""))
	if c.PublicRelay() {
		t.Fatal("an empty url is no relay")
	}
	if _, err := c.GetProfile(context.Background(), 42); err != nil {
		t.Fatal(err)
	}
	if n := atomic.LoadInt32(&directCalls); n != 1 {
		t.Errorf("direct host asked %d times, want 1", n)
	}
}
