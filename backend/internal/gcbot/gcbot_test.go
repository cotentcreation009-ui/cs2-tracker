package gcbot

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResolve(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/resolve" || r.Method != http.MethodPost {
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
		var body struct {
			ShareCode string `json:"shareCode"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.ShareCode != "CSGO-yOJk4-YmmVm-KsSa5-rPTwZ-jPocG" {
			t.Errorf("shareCode = %q", body.ShareCode)
		}
		w.Write([]byte(`{"demoUrl":"http://replay389.valve.net/730/x.dem.bz2"}`))
	}))
	defer srv.Close()

	got, err := New(srv.URL).Resolve(context.Background(), "CSGO-yOJk4-YmmVm-KsSa5-rPTwZ-jPocG")
	if err != nil {
		t.Fatal(err)
	}
	if got != "http://replay389.valve.net/730/x.dem.bz2" {
		t.Errorf("url = %q", got)
	}
}

func TestResolveErrors(t *testing.T) {
	cases := []struct {
		status int
		want   error
	}{
		{http.StatusNotFound, ErrNotFound},
		{http.StatusServiceUnavailable, ErrUnavailable},
	}
	for _, tc := range cases {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(tc.status)
			w.Write([]byte(`{"error":"x"}`))
		}))
		if _, err := New(srv.URL).Resolve(context.Background(), "CSGO-aaaaa-aaaaa-aaaaa-aaaaa-aaaaa"); !errors.Is(err, tc.want) {
			t.Errorf("status %d: err = %v, want %v", tc.status, err, tc.want)
		}
		srv.Close()
	}
}

func TestRecent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/recent" || r.Method != http.MethodPost {
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
		var body struct {
			SteamID string `json:"steamId"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.SteamID != "76561197995150836" {
			t.Errorf("steamId = %q", body.SteamID)
		}
		w.Write([]byte(`{"matches":[{"matchId":"1","time":1752345600,"demoUrl":"http://replay1.valve.net/730/m.dem.bz2","scores":[13,10]}]}`))
	}))
	defer srv.Close()

	got, err := New(srv.URL).Recent(context.Background(), "76561197995150836")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].DemoURL == "" || got[0].Scores[0] != 13 {
		t.Fatalf("unexpected matches: %+v", got)
	}
}

func TestRecentNoReply(t *testing.T) {
	// 504 = new sidecar (dispatched, GC silent); 502 = older sidecar timeout
	for _, status := range []int{http.StatusGatewayTimeout, http.StatusBadGateway} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(status)
			w.Write([]byte(`{"error":"the Game Coordinator did not answer"}`))
		}))
		_, err := New(srv.URL).Recent(context.Background(), "76561197995150836")
		srv.Close()
		if !errors.Is(err, ErrNoReply) {
			t.Fatalf("status %d: want ErrNoReply, got %v", status, err)
		}
	}
}

func TestRecentQueueBusy(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		w.Write([]byte(`{"error":"timed out queued behind other requests — try again shortly"}`))
	}))
	defer srv.Close()

	_, err := New(srv.URL).Recent(context.Background(), "76561197995150836")
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("want ErrUnavailable, got %v", err)
	}
}

func TestRecentUnavailable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		w.Write([]byte(`{"error":"not connected"}`))
	}))
	defer srv.Close()

	_, err := New(srv.URL).Recent(context.Background(), "76561197995150836")
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("want ErrUnavailable, got %v", err)
	}
}

func TestRecentMatchShareCode(t *testing.T) {
	// Decoded from a real share code, so a correct rebuild reproduces it exactly.
	m := RecentMatch{
		MatchID:       "3829850547188400403",
		ReservationID: "3829854876515434633",
		TVPort:        58343,
	}
	got, ok := m.ShareCode()
	if !ok {
		t.Fatal("could not rebuild a code from complete fields")
	}
	if want := "CSGO-X5EDM-CJCpX-dTvfS-kMP7u-EhMMB"; got != want {
		t.Errorf("ShareCode() = %s, want %s", got, want)
	}

	// A sidecar older than the change that surfaced these fields sends neither.
	// That must report "no code", never a plausible-looking wrong one.
	for _, bad := range []RecentMatch{
		{MatchID: "3829850547188400403"},                                                      // no reservation, no port
		{MatchID: "3829850547188400403", ReservationID: "3829854876515434633"},                // no port
		{MatchID: "3829850547188400403", ReservationID: "x", TVPort: 58343},                   // unparseable
		{MatchID: "", ReservationID: "3829854876515434633", TVPort: 58343},                    // no match id
		{MatchID: "3829850547188400403", ReservationID: "0", TVPort: 58343},                   // zero reservation
		{MatchID: "3829850547188400403", ReservationID: "3829854876515434633", TVPort: 70000}, // impossible port
	} {
		if code, ok := bad.ShareCode(); ok {
			t.Errorf("%+v produced %s, want no code", bad, code)
		}
	}
}
