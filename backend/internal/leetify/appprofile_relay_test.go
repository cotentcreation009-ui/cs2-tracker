package leetify

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
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
	if n := atomic.LoadInt32(&relayCalls); n != 3 {
		t.Errorf("relay calls = %d, want 3 (sources, pool, meta)", n)
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
