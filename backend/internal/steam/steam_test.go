package steam

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func newTestClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return New("test-key", WithBaseURL(srv.URL), WithHTTPClient(srv.Client()))
}

func TestResolveVanityURL(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("vanityurl"); got != "gabelogannewell" {
			t.Errorf("vanityurl = %q", got)
		}
		w.Write([]byte(`{"response":{"steamid":"76561197960287930","success":1}}`))
	})
	id, err := c.ResolveVanityURL(context.Background(), "gabelogannewell")
	if err != nil {
		t.Fatal(err)
	}
	if id != 76561197960287930 {
		t.Errorf("id = %d", id)
	}
}

func TestResolveVanityURLNotFound(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"response":{"success":42,"message":"No match"}}`))
	})
	if _, err := c.ResolveVanityURL(context.Background(), "nope"); err != ErrNotFound {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
}

func TestGetPlayerSummaries(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"response":{"players":[{"steamid":"76561197960287930","personaname":"Rabscuttle","profileurl":"https://steamcommunity.com/id/gabelogannewell/","avatarfull":"https://x/full.jpg","communityvisibilitystate":3,"loccountrycode":"US","timecreated":1063407589}]}}`))
	})
	ps, err := c.GetPlayerSummaries(context.Background(), 76561197960287930)
	if err != nil {
		t.Fatal(err)
	}
	if len(ps) != 1 {
		t.Fatalf("got %d summaries", len(ps))
	}
	if ps[0].PersonaName != "Rabscuttle" || ps[0].SteamID != 76561197960287930 {
		t.Errorf("unexpected summary: %+v", ps[0])
	}
	if ps[0].TimeCreated.IsZero() {
		t.Errorf("TimeCreated not parsed")
	}
}

func TestGetUserStatsForGame(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("appid"); got != "730" {
			t.Errorf("appid = %q", got)
		}
		w.Write([]byte(`{"playerstats":{"steamID":"76561197960287930","gameName":"ValveTestApp260","stats":[{"name":"total_kills","value":12345},{"name":"total_deaths","value":11000}]}}`))
	})
	gs, err := c.GetUserStatsForGame(context.Background(), AppIDCS2, 76561197960287930)
	if err != nil {
		t.Fatal(err)
	}
	if gs.Int("total_kills") != 12345 || gs.Int("total_deaths") != 11000 {
		t.Errorf("stats = %+v", gs.Stats)
	}
}

func TestGetUserStatsForGameNoStats(t *testing.T) {
	// Steam returns 400 for an account that has no stats for the app (e.g. never
	// played CS2). The client must surface ErrNotFound, not a hard error.
	for _, code := range []int{400, 403, 500} {
		c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(code)
		})
		_, err := c.GetUserStatsForGame(context.Background(), AppIDCS2, 76561197960287930)
		if err != ErrNotFound {
			t.Errorf("status %d: err = %v, want ErrNotFound", code, err)
		}
	}
}

func TestNoAPIKey(t *testing.T) {
	c := New("")
	if _, err := c.ResolveVanityURL(context.Background(), "x"); err != ErrNoAPIKey {
		t.Errorf("err = %v, want ErrNoAPIKey", err)
	}
}

func TestRetryThenSuccess(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&calls, 1) <= 2 {
			w.WriteHeader(http.StatusTooManyRequests) // rate-limited twice
			return
		}
		w.Write([]byte(`{"response":{"steamid":"76561197960287930","success":1}}`))
	}))
	defer srv.Close()
	c := New("k", WithBaseURL(srv.URL), WithHTTPClient(srv.Client()), WithRetryBase(time.Millisecond))

	id, err := c.ResolveVanityURL(context.Background(), "x")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if id != 76561197960287930 {
		t.Errorf("id = %d", id)
	}
	if n := atomic.LoadInt32(&calls); n != 3 {
		t.Errorf("calls = %d, want 3 (2 retried + 1 success)", n)
	}
}

func TestPersistentRateLimit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer srv.Close()
	c := New("k", WithBaseURL(srv.URL), WithHTTPClient(srv.Client()), WithRetryBase(time.Millisecond))

	if _, err := c.ResolveVanityURL(context.Background(), "x"); err != ErrRateLimited {
		t.Errorf("err = %v, want ErrRateLimited", err)
	}
}

func TestParseSteamID64(t *testing.T) {
	if _, ok := ParseSteamID64("76561197960287930"); !ok {
		t.Error("valid id rejected")
	}
	if _, ok := ParseSteamID64("gabelogannewell"); ok {
		t.Error("vanity accepted as id")
	}
	if _, ok := ParseSteamID64("123"); ok {
		t.Error("short numeric accepted")
	}
}
