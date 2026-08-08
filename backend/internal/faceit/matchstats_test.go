package faceit

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/cs2tracker/server/internal/stats"
)

// One board: rounds > teams > players, every value a string, rounds carried on
// round_stats rather than the player's row — the shape /matches/{id}/stats
// actually returns.
func board(playerID string, s map[string]string, roundsPlayed string) map[string]any {
	return map[string]any{
		"rounds": []map[string]any{{
			"round_stats": map[string]string{"Rounds": roundsPlayed},
			"teams": []map[string]any{
				{"players": []map[string]any{
					{"player_id": "someone-else", "player_stats": map[string]string{"Kills": "1", "Deaths": "1"}},
				}},
				{"players": []map[string]any{
					{"player_id": playerID, "player_stats": s},
				}},
			},
		}},
	}
}

func TestRecentMatchStats(t *testing.T) {
	const pid = "abc"
	boards := map[string]map[string]any{
		"m1": board(pid, map[string]string{
			"Kills": "20", "Deaths": "15", "Assists": "4", "Result": "1",
			"ADR": "85.5", "Headshots %": "50",
			"Double Kills": "4", "Triple Kills": "2", "Quadro Kills": "1", "Penta Kills": "0",
		}, "25"),
		"m2": board(pid, map[string]string{
			"Kills": "10", "Deaths": "20", "Assists": "2", "Result": "0",
			"ADR": "60.5", "Headshots %": "40",
			"Double Kills": "1", "Triple Kills": "0", "Quadro Kills": "0", "Penta Kills": "0",
		}, "25"),
	}

	var historyHits, boardHits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		switch r.URL.Path {
		case "/players/abc/history":
			historyHits++
			if r.URL.Query().Get("game") != "cs2" {
				t.Errorf("history game = %q", r.URL.Query().Get("game"))
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"items": []map[string]string{{"match_id": "m1"}, {"match_id": "m2"}},
			})
		case "/matches/m1/stats", "/matches/m2/stats":
			boardHits++
			id := r.URL.Path[len("/matches/") : len(r.URL.Path)-len("/stats")]
			_ = json.NewEncoder(w).Encode(boards[id])
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer srv.Close()

	got, err := New(srv.URL, "key").RecentMatchStats(context.Background(), pid, 5)
	if err != nil {
		t.Fatalf("RecentMatchStats: %v", err)
	}
	if got == nil {
		t.Fatal("got nil stats")
	}
	if historyHits != 1 || boardHits != 2 {
		t.Errorf("calls: history=%d boards=%d, want 1 and 2", historyHits, boardHits)
	}
	if got.Matches != 2 {
		t.Errorf("Matches = %d, want 2 (the SAMPLE size)", got.Matches)
	}
	if want := 15.0; got.Kills != want {
		t.Errorf("Kills = %v, want %v", got.Kills, want)
	}
	if want := 3.0; got.Assists != want {
		t.Errorf("Assists = %v, want %v", got.Assists, want)
	}
	if want := 30.0 / 35.0; got.KD != want {
		t.Errorf("KD = %v, want %v", got.KD, want)
	}
	if want := 30.0 / 50.0; got.KR != want {
		t.Errorf("KR = %v, want %v", got.KR, want)
	}
	if want := (85.5 + 60.5) / 2; got.ADR != want {
		t.Errorf("ADR = %v, want %v", got.ADR, want)
	}
	if want := 45.0; got.HSPct != want {
		t.Errorf("HSPct = %v, want %v", got.HSPct, want)
	}
	if want := 50.0; got.WinRatePct != want {
		t.Errorf("WinRatePct = %v, want %v", got.WinRatePct, want)
	}
	// k1 = 30 - 2*5 - 3*2 - 4*1 - 5*0 = 10
	if want := stats.Rating1(30, 35, 50, 10, 5, 2, 1, 0); got.Rating != want {
		t.Errorf("Rating = %v, want %v", got.Rating, want)
	}
}

// A board that withholds the multi-kill columns cannot yield an exact Rating
// 1.0, and an approximation would be worse than a gap.
func TestRecentMatchStatsNoRatingWithoutMultiKills(t *testing.T) {
	const pid = "abc"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		if r.URL.Path == "/players/abc/history" {
			_ = json.NewEncoder(w).Encode(map[string]any{"items": []map[string]string{{"match_id": "nomulti"}}})
			return
		}
		_ = json.NewEncoder(w).Encode(board(pid, map[string]string{
			"Kills": "20", "Deaths": "15", "Result": "1", "ADR": "85.5",
		}, "25"))
	}))
	defer srv.Close()

	got, err := New(srv.URL, "key").RecentMatchStats(context.Background(), pid, 5)
	if err != nil || got == nil {
		t.Fatalf("RecentMatchStats: %v %+v", err, got)
	}
	if got.Rating != 0 {
		t.Errorf("Rating = %v, want 0 without the multi-kill columns", got.Rating)
	}
	if got.ADR != 85.5 {
		t.Errorf("ADR = %v, want 85.5 — the rest must still come through", got.ADR)
	}
}

// One unreadable board must not lose the others.
func TestRecentMatchStatsPartialBoards(t *testing.T) {
	const pid = "abc"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/players/abc/history" {
			w.Header().Set("content-type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"items": []map[string]string{{"match_id": "readable"}, {"match_id": "broken"}},
			})
			return
		}
		if r.URL.Path == "/matches/broken/stats" {
			w.WriteHeader(500)
			return
		}
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(board(pid, map[string]string{
			"Kills": "18", "Deaths": "12", "Result": "1",
		}, "24"))
	}))
	defer srv.Close()

	got, err := New(srv.URL, "key").RecentMatchStats(context.Background(), pid, 5)
	if err != nil || got == nil {
		t.Fatalf("RecentMatchStats: %v %+v", err, got)
	}
	if got.Matches != 1 {
		t.Errorf("Matches = %d, want 1 — the readable board should survive", got.Matches)
	}
}

func TestRecentMatchStatsEmpty(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"items":[]}`))
	}))
	defer srv.Close()

	got, err := New(srv.URL, "key").RecentMatchStats(context.Background(), "abc", 5)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if got != nil {
		t.Errorf("got %+v, want nil for a player with no history", got)
	}
}

func TestRecentMatchStatsNoKey(t *testing.T) {
	if _, err := New("", "").RecentMatchStats(context.Background(), "abc", 5); err != ErrNoAPIKey {
		t.Errorf("err = %v, want ErrNoAPIKey", err)
	}
}
