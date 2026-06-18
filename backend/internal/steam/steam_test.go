package steam

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
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

func TestNoAPIKey(t *testing.T) {
	c := New("")
	if _, err := c.ResolveVanityURL(context.Background(), "x"); err != ErrNoAPIKey {
		t.Errorf("err = %v, want ErrNoAPIKey", err)
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
