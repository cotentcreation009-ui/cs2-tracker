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

// With a relay configured, every app route is asked THERE, with the shared
// key and without the public-API key; the app host itself is never asked. The
// relay is a change of return address for a network the wall refuses — it must
// carry exactly the same requests, no more.
func TestGetProfile_AppRoutesGoThroughTheRelayWhenConfigured(t *testing.T) {
	var directCalls int32
	direct := appServer(t, &directCalls) // /v3 404s here; the app routes must not be asked here
	defer direct.Close()

	var relayCalls int32
	relay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&relayCalls, 1)
		if r.Header.Get("X-Relay-Key") != "s3cret" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.Header.Get("_leetify_key") != "" {
			t.Errorf("the public-API key must not reach the relay")
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
	}))
	defer relay.Close()

	c := New(direct.URL, "the-key", WithLegacyURL(direct.URL), WithAppRelay(relay.URL+"/", "s3cret"))
	p, err := c.GetProfile(context.Background(), 42)
	if err != nil {
		t.Fatalf("GetProfile: %v", err)
	}
	if p.Name != "dane" || p.Source != "app:5v5" || p.Rating.Aim != 72.24 {
		t.Errorf("profile = %+v", p)
	}
	if n := atomic.LoadInt32(&directCalls); n != 0 {
		t.Errorf("app host asked directly %d times with a relay configured", n)
	}
	if n := atomic.LoadInt32(&relayCalls); n != 4 {
		t.Errorf("relay calls = %d, want 4 (sources, pool, meta, match-history)", n)
	}
}

// A relay that is down, or refuses the key, is a miss like any other fallback
// failure — never a 500 on the profile page.
func TestGetProfile_RelayDownIsAMiss(t *testing.T) {
	var directCalls int32
	direct := appServer(t, &directCalls)
	defer direct.Close()

	c := New(direct.URL, "", WithLegacyURL(direct.URL), WithAppRelay("http://127.0.0.1:1", "k"))
	if _, err := c.GetProfile(context.Background(), 42); err != ErrNotFound {
		t.Errorf("relay down: err = %v, want ErrNotFound", err)
	}

	refusing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer refusing.Close()
	c = New(direct.URL, "", WithLegacyURL(direct.URL), WithAppRelay(refusing.URL, "wrong"))
	if _, err := c.GetProfile(context.Background(), 42); err != ErrNotFound {
		t.Errorf("relay refusing the key: err = %v, want ErrNotFound", err)
	}
	if n := atomic.LoadInt32(&directCalls); n != 0 {
		t.Errorf("app host asked directly %d times with a relay configured", n)
	}
}

// Through the relay a 511 is one Cloudflare egress address being refused, not
// the network — the same routes answered 20 of 20 from the relay minutes after
// the backend had logged a wall (2026-09-28). So a refused hop is asked once
// more before anything is believed, and an answered request costs no pause.
func TestGetProfile_RelayWallIsRetriedOnce(t *testing.T) {
	var directCalls int32
	direct := appServer(t, &directCalls)
	defer direct.Close()

	var walls, answers int32
	relay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Relay-Key") != "s3cret" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		// The first request hits the wall; its retry gets through.
		if r.URL.Path == "/api/profile/42/recent-games/available-data-sources" && atomic.AddInt32(&walls, 1) == 1 {
			w.WriteHeader(http.StatusNetworkAuthenticationRequired)
			_, _ = w.Write([]byte(`{"error":"bot_check_required"}`))
			return
		}
		atomic.AddInt32(&answers, 1)
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
	}))
	defer relay.Close()

	c := New(direct.URL, "the-key", WithLegacyURL(direct.URL), WithAppRelay(relay.URL, "s3cret"))
	p, err := c.GetProfile(context.Background(), 42)
	if err != nil {
		t.Fatalf("GetProfile after one refused hop: %v", err)
	}
	if p.Name != "dane" || p.Source != "app:5v5" {
		t.Errorf("profile = %+v", p)
	}
	if c.appBlocked() {
		t.Error("one refused hop must not pause the fallback")
	}
	if c.appWallStreak.Load() != 0 {
		t.Error("an answered request resets the wall streak")
	}
}

// A wall that survives the retry is real: the lookup is a miss the site could
// not verify (ErrUnavailable, also ErrNotFound), the fallback pauses two
// minutes, and only walls met again after a pause lapses double it — up to the
// old half hour. An answered request brings it back to two.
func TestGetProfile_RelayWallTwiceIsUnavailableAndPausesEscalate(t *testing.T) {
	var directCalls int32
	direct := appServer(t, &directCalls)
	defer direct.Close()

	var relayCalls int32
	relay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&relayCalls, 1)
		w.WriteHeader(http.StatusNetworkAuthenticationRequired)
		_, _ = w.Write([]byte(`{"error":"bot_check_required"}`))
	}))
	defer relay.Close()

	c := New(direct.URL, "the-key", WithLegacyURL(direct.URL), WithAppRelay(relay.URL, "s3cret"))
	_, err := c.GetProfile(context.Background(), 42)
	if !errors.Is(err, ErrUnavailable) || !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrUnavailable (which is also ErrNotFound)", err)
	}
	if n := atomic.LoadInt32(&relayCalls); n != 2 {
		t.Errorf("relay asked %d times, want 2: once, and once more before believing the wall", n)
	}
	pauseLeft := func() time.Duration { return time.Until(time.Unix(0, c.appBlockedUntil.Load())) }
	if p := pauseLeft(); p < 100*time.Second || p > 125*time.Second {
		t.Errorf("first pause = %v, want about 2m", p)
	}

	// The pause lapses and the wall is still up: the next pause doubles.
	c.appBlockedUntil.Store(0)
	if _, err := c.GetProfile(context.Background(), 42); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("second wall: err = %v", err)
	}
	if p := pauseLeft(); p < 220*time.Second || p > 245*time.Second {
		t.Errorf("second pause = %v, want about 4m", p)
	}

	// Escalation is capped at the old half hour…
	for i := 0; i < 8; i++ {
		c.appBlockedUntil.Store(0)
		c.tripAppBlock()
	}
	if p := pauseLeft(); p < 29*time.Minute || p > 31*time.Minute {
		t.Errorf("capped pause = %v, want about 30m", p)
	}
	// …and an answered request resets it to two minutes.
	c.noteAppAnswered()
	c.appBlockedUntil.Store(0)
	c.tripAppBlock()
	if p := pauseLeft(); p < 100*time.Second || p > 125*time.Second {
		t.Errorf("pause after an answer = %v, want about 2m", p)
	}
}
