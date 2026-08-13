package faceit

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
)

// rankingsServer serves body for any request and records the path+query it was
// asked for, so tests can assert what we actually sent upstream.
func rankingsServer(t *testing.T, status int, body string) (*httptest.Server, *string) {
	t.Helper()
	var seen string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = r.URL.String()
		w.Header().Set("content-type", "application/json")
		if status != http.StatusOK {
			w.WriteHeader(status)
			return
		}
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv, &seen
}

func TestRankings(t *testing.T) {
	srv, seen := rankingsServer(t, http.StatusOK, `{"start":0,"end":3,"items":[
		{"player_id":"p1","nickname":"donk","country":"ru","position":1,"faceit_elo":4212,"game_skill_level":10},
		{"player_id":"p2","nickname":"m0NESY","country":"ru","position":2,"faceit_elo":3980,"game_skill_level":10},
		{"player_id":"p3","nickname":"ropz","country":"ee","position":3,"faceit_elo":3801,"game_skill_level":10}
	]}`)

	got, err := New(srv.URL, "k").Rankings(context.Background(), "EU", 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("len = %d, want 3: %+v", len(got), got)
	}
	first := got[0]
	if first.PlayerID != "p1" || first.Nickname != "donk" || first.Country != "ru" ||
		first.Position != 1 || first.Elo != 4212 || first.SkillLevel != 10 {
		t.Errorf("field mapping wrong: %+v", first)
	}
	if want := "https://www.faceit.com/en/players/donk"; first.FaceitURL != want {
		t.Errorf("FaceitURL = %q, want %q", first.FaceitURL, want)
	}
	// Leaderboard order is the data — reordering it would misreport who is top.
	if got[1].Nickname != "m0NESY" || got[2].Nickname != "ropz" {
		t.Errorf("order not preserved: %+v", got)
	}
	if !strings.Contains(*seen, "/rankings/games/cs2/regions/EU") {
		t.Errorf("requested %q, want the cs2/EU rankings path", *seen)
	}
}

// A nickname is the only thing that names and links a row; without one the
// entry would render as an anonymous gap, so it is dropped instead.
func TestRankingsSkipsNamelessItems(t *testing.T) {
	srv, _ := rankingsServer(t, http.StatusOK, `{"start":0,"items":[
		{"player_id":"p1","nickname":"donk","position":1,"faceit_elo":4212,"game_skill_level":10},
		{"player_id":"p2","nickname":"","position":2,"faceit_elo":3980,"game_skill_level":10},
		{"player_id":"p3","position":3,"faceit_elo":3801,"game_skill_level":10}
	]}`)

	got, err := New(srv.URL, "k").Rankings(context.Background(), "EU", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Nickname != "donk" {
		t.Fatalf("nameless rows must be dropped, got %+v", got)
	}
	if got[0].FaceitURL == "" {
		t.Error("a named row must still get a profile link")
	}
}

// The endpoint is unverified from here, so a row whose elo did not decode must
// not reach the UI as "0 elo" beside real numbers.
func TestRankingsSkipsRowsWithoutElo(t *testing.T) {
	srv, _ := rankingsServer(t, http.StatusOK, `{"start":0,"items":[
		{"player_id":"p1","nickname":"donk","position":1,"faceit_elo":4212},
		{"player_id":"p2","nickname":"ghost","position":2},
		{"player_id":"p3","nickname":"renamed","position":3,"elo":"3700","skill_level":"10"}
	]}`)

	got, err := New(srv.URL, "k").Rankings(context.Background(), "EU", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2 (the elo-less row dropped): %+v", len(got), got)
	}
	// Renamed/stringly-typed fields cost that column at most, never the page.
	if got[1].Elo != 3700 || got[1].SkillLevel != 10 {
		t.Errorf("alternate field names not tolerated: %+v", got[1])
	}
}

func TestRankingsRegionValidation(t *testing.T) {
	body := `{"start":0,"items":[{"player_id":"p1","nickname":"n","position":1,"faceit_elo":3000,"game_skill_level":10}]}`

	t.Run("empty defaults to EU", func(t *testing.T) {
		srv, seen := rankingsServer(t, http.StatusOK, body)
		if _, err := New(srv.URL, "k").Rankings(context.Background(), "", 5); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(*seen, "/regions/EU") {
			t.Errorf("path = %q, want the EU default", *seen)
		}
	})

	t.Run("known regions reach the path", func(t *testing.T) {
		for _, region := range []string{"EU", "NA", "SA", "AS", "OCE", "na", " oce "} {
			srv, seen := rankingsServer(t, http.StatusOK, body)
			if _, err := New(srv.URL, "k").Rankings(context.Background(), region, 5); err != nil {
				t.Fatalf("region %q: %v", region, err)
			}
			want := "/regions/" + strings.ToUpper(strings.TrimSpace(region))
			if !strings.Contains(*seen, want) {
				t.Errorf("region %q requested %q, want it to contain %q", region, *seen, want)
			}
		}
	})

	// Nothing the caller types may steer the URL: an unknown region is rejected
	// here rather than pasted into the path for FACEIT to interpret.
	t.Run("unknown region is rejected", func(t *testing.T) {
		for _, region := range []string{"XX", "eu/../..", "../../players", "%2e%2e"} {
			srv, seen := rankingsServer(t, http.StatusOK, body)
			_, err := New(srv.URL, "k").Rankings(context.Background(), region, 5)
			if !errors.Is(err, ErrBadRegion) {
				t.Errorf("region %q: err = %v, want ErrBadRegion", region, err)
			}
			if *seen != "" {
				t.Errorf("region %q was sent upstream as %q", region, *seen)
			}
		}
	})
}

func TestRankingsClampsLimit(t *testing.T) {
	body := `{"start":0,"items":[]}`
	for _, tc := range []struct {
		name string
		give int
		want int
	}{
		{"zero", 0, 1},
		{"negative", -20, 1},
		{"in range", 25, 25},
		{"over the page cap", 500, maxRankingLimit},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv, seen := rankingsServer(t, http.StatusOK, body)
			if _, err := New(srv.URL, "k").Rankings(context.Background(), "EU", tc.give); err != nil {
				t.Fatal(err)
			}
			u, err := url.Parse(*seen)
			if err != nil {
				t.Fatalf("bad request URL %q: %v", *seen, err)
			}
			got, err := strconv.Atoi(u.Query().Get("limit"))
			if err != nil {
				t.Fatalf("limit not numeric in %q: %v", *seen, err)
			}
			if got != tc.want {
				t.Errorf("limit = %d, want %d (from %d)", got, tc.want, tc.give)
			}
			if got < 1 || got > maxRankingLimit {
				t.Errorf("limit %d is outside FACEIT's legal 1..%d", got, maxRankingLimit)
			}
		})
	}
}

func TestRankingsNoKey(t *testing.T) {
	if _, err := New("", "").Rankings(context.Background(), "EU", 10); !errors.Is(err, ErrNoAPIKey) {
		t.Errorf("err = %v, want ErrNoAPIKey", err)
	}
}

func TestRankingsRateLimited(t *testing.T) {
	srv, _ := rankingsServer(t, http.StatusTooManyRequests, "")
	if _, err := New(srv.URL, "k").Rankings(context.Background(), "EU", 10); !errors.Is(err, ErrRateLimited) {
		t.Errorf("err = %v, want ErrRateLimited", err)
	}
}

func TestRankingsUnauthorized(t *testing.T) {
	srv, _ := rankingsServer(t, http.StatusUnauthorized, "")
	if _, err := New(srv.URL, "k").Rankings(context.Background(), "EU", 10); !errors.Is(err, ErrNoAPIKey) {
		t.Errorf("err = %v, want ErrNoAPIKey (401 mapped)", err)
	}
}
