package faceit

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGetProfile(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Errorf("missing/biased auth header: %q", got)
		}
		switch {
		case r.URL.Path == "/players":
			if r.URL.Query().Get("game") != "cs2" ||
				r.URL.Query().Get("game_player_id") != "76561198077030352" {
				t.Errorf("bad query: %s", r.URL.RawQuery)
			}
			w.Write([]byte(`{
				"player_id":"abc-123","nickname":"Pod","country":"us",
				"avatar":"https://cdn/av.jpg","faceit_url":"https://www.faceit.com/{lang}/players/Pod",
				"games":{"cs2":{"skill_level":10,"faceit_elo":2146,"region":"NA"}}
			}`))
		case r.URL.Path == "/players/abc-123/stats/cs2":
			w.Write([]byte(`{"lifetime":{
				"Matches":"1234","Win Rate %":"55","Average K/D Ratio":"1.12",
				"Average Headshots %":"48","Average Kills":"18.5",
				"Current Win Streak":"2","Longest Win Streak":"12",
				"Recent Results":["1","0","1","1","0"]
			}}`))
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer srv.Close()

	p, err := New(srv.URL, "test-key").GetProfile(context.Background(), 76561198077030352)
	if err != nil {
		t.Fatal(err)
	}
	if p.Nickname != "Pod" || p.SkillLevel != 10 || p.Elo != 2146 {
		t.Errorf("identity not parsed: %+v", p)
	}
	if strings.Contains(p.FaceitURL, "{lang}") {
		t.Errorf("faceit_url {lang} not replaced: %s", p.FaceitURL)
	}
	if p.Matches != 1234 || p.WinRatePct != 55 || p.KDRatio != 1.12 || p.HSPct != 48 {
		t.Errorf("lifetime stats not parsed: %+v", p)
	}
	if p.LongestWinStreak != 12 || len(p.RecentResults) != 5 {
		t.Errorf("streak/recent not parsed: %+v", p)
	}
}

func TestGetProfileNoKey(t *testing.T) {
	if _, err := New("", "").GetProfile(context.Background(), 1); err != ErrNoAPIKey {
		t.Errorf("err = %v, want ErrNoAPIKey", err)
	}
}

func TestGetProfileNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	if _, err := New(srv.URL, "k").GetProfile(context.Background(), 1); err != ErrNotFound {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
}

func TestGetProfileBadKey(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()
	if _, err := New(srv.URL, "wrong").GetProfile(context.Background(), 1); err != ErrNoAPIKey {
		t.Errorf("err = %v, want ErrNoAPIKey (401 mapped)", err)
	}
}

// A player with no CS2 stats yet should still return identity/elo.
func TestGetProfileNoStats(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/players" {
			w.Write([]byte(`{"player_id":"x","nickname":"New","games":{"cs2":{"skill_level":3,"faceit_elo":900}}}`))
			return
		}
		w.WriteHeader(http.StatusNotFound) // no stats endpoint data
	}))
	defer srv.Close()
	p, err := New(srv.URL, "k").GetProfile(context.Background(), 1)
	if err != nil {
		t.Fatalf("identity-only profile should succeed, got %v", err)
	}
	if p.SkillLevel != 3 || p.Matches != 0 {
		t.Errorf("unexpected identity-only profile: %+v", p)
	}
}
