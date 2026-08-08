package faceit

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// A profile whose recent aggregate failed must SAY so. Without the flag a
// rate-limited moment is indistinguishable from an answer, and the caching
// layer stores it as one — which is how a single unlucky call in a ten-player
// burst kept four columns blank for that player across reloads.
func TestGetProfileMarksRecentUnavailable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/players":
			w.Header().Set("content-type", "application/json")
			_, _ = w.Write([]byte(`{"player_id":"p1","nickname":"Pod","games":{"cs2":{"skill_level":10,"faceit_elo":2100}}}`))
		case "/players/p1/stats/cs2":
			w.Header().Set("content-type", "application/json")
			_, _ = w.Write([]byte(`{"lifetime":{"Matches":"1000","Win Rate %":"55"}}`))
		case "/players/p1/history":
			// what a burst looks like from the other side
			w.WriteHeader(http.StatusTooManyRequests)
		default:
			w.WriteHeader(404)
		}
	}))
	defer srv.Close()

	p, err := New(srv.URL, "key").GetProfile(context.Background(), 76561198000000001)
	if err != nil {
		t.Fatalf("GetProfile must still succeed on the parts that worked: %v", err)
	}
	if p.Elo != 2100 || p.Matches != 1000 {
		t.Errorf("the rest of the profile must survive: %+v", p)
	}
	if p.Recent != nil {
		t.Errorf("Recent = %+v, want nil", p.Recent)
	}
	if !p.RecentUnavailable {
		t.Error("RecentUnavailable = false — a 429 must be distinguishable from an empty history, or it gets cached as truth")
	}
}

// A player who genuinely has no history is NOT partial — that answer is
// correct and should be cached like any other.
func TestGetProfileEmptyHistoryIsNotPartial(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		switch r.URL.Path {
		case "/players":
			_, _ = w.Write([]byte(`{"player_id":"p1","nickname":"Pod","games":{"cs2":{"skill_level":3,"faceit_elo":900}}}`))
		case "/players/p1/stats/cs2":
			_, _ = w.Write([]byte(`{"lifetime":{"Matches":"2"}}`))
		case "/players/p1/history":
			_, _ = w.Write([]byte(`{"items":[]}`))
		default:
			w.WriteHeader(404)
		}
	}))
	defer srv.Close()

	p, err := New(srv.URL, "key").GetProfile(context.Background(), 76561198000000001)
	if err != nil {
		t.Fatal(err)
	}
	if p.RecentUnavailable {
		t.Error("RecentUnavailable = true for a player with no history — that is a real answer, not a failure")
	}
}
