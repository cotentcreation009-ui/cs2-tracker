package faceit

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/cs2tracker/server/internal/stats"
)

// The Data API returns every stat as a string, and the key set differs between
// CS:GO-era and CS2 matches. The fixture mixes both, plus a row missing ADR
// entirely, because that is what the live feed does.
func TestRecentMatchStats(t *testing.T) {
	items := []map[string]any{
		{"stats": map[string]string{
			"Kills": "20", "Deaths": "15", "Assists": "4",
			"Rounds": "25", "ADR": "85.5", "Headshots %": "50", "Result": "1",
			"Double Kills": "4", "Triple Kills": "2", "Quadro Kills": "1", "Penta Kills": "0",
		}},
		{"stats": map[string]string{
			"Kills": "10", "Deaths": "20", "Assists": "2",
			"Rounds Played": "25", "Average Damage per Round": "60.5",
			"Headshots %": "40", "Result": "0",
		}},
		// no ADR, no rounds — must not drag the averages down
		{"stats": map[string]string{
			"Kills": "15", "Deaths": "10", "Assists": "3", "Result": "1",
		}},
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Path; got != "/players/abc/games/cs2/stats" {
			t.Errorf("path = %q", got)
		}
		if got := r.URL.Query().Get("limit"); got != "30" {
			t.Errorf("limit = %q, want 30", got)
		}
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"items": items})
	}))
	defer srv.Close()

	c := New(srv.URL, "key")
	got, err := c.RecentMatchStats(context.Background(), "abc", 30)
	if err != nil {
		t.Fatalf("RecentMatchStats: %v", err)
	}
	if got == nil {
		t.Fatal("got nil stats")
	}
	if got.Matches != 3 {
		t.Errorf("Matches = %d, want 3", got.Matches)
	}
	if want := 45.0 / 3; got.Kills != want {
		t.Errorf("Kills = %v, want %v", got.Kills, want)
	}
	if want := 9.0 / 3; got.Assists != want {
		t.Errorf("Assists = %v, want %v", got.Assists, want)
	}
	if want := 45.0 / 45.0; got.KD != want {
		t.Errorf("KD = %v, want %v", got.KD, want)
	}
	// only the two rows that reported rounds count toward K/R
	if want := 30.0 / 50.0; got.KR != want {
		t.Errorf("KR = %v, want %v", got.KR, want)
	}
	// ADR averages over the two rows that had it, not all three
	if want := (85.5 + 60.5) / 2; got.ADR != want {
		t.Errorf("ADR = %v, want %v", got.ADR, want)
	}
	if want := 45.0; got.HSPct != want {
		t.Errorf("HSPct = %v, want %v", got.HSPct, want)
	}
	if want := 66.667; got.WinRatePct < want-0.01 || got.WinRatePct > want+0.01 {
		t.Errorf("WinRatePct = %v, want ~%v", got.WinRatePct, want)
	}
	// The second row reports rounds but NO multi-kill columns, so Rating 1.0
	// cannot be computed exactly and must be absent rather than approximated.
	if got.Rating != 0 {
		t.Errorf("Rating = %v, want 0 when a rated row lacks multi-kill columns", got.Rating)
	}
}

// With the multi-kill columns present on every rated row, Rating 1.0 is exact.
func TestRecentMatchStatsRating(t *testing.T) {
	items := []map[string]any{
		{"stats": map[string]string{
			"Kills": "20", "Deaths": "15", "Rounds": "25", "Result": "1",
			"Double Kills": "4", "Triple Kills": "2", "Quadro Kills": "1", "Penta Kills": "0",
		}},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"items": items})
	}))
	defer srv.Close()

	got, err := New(srv.URL, "key").RecentMatchStats(context.Background(), "abc", 30)
	if err != nil || got == nil {
		t.Fatalf("RecentMatchStats: %v %+v", err, got)
	}
	// k1 = 20 - 2*4 - 3*2 - 4*1 - 5*0 = 2
	want := stats.Rating1(20, 15, 25, 2, 4, 2, 1, 0)
	if got.Rating != want {
		t.Errorf("Rating = %v, want %v", got.Rating, want)
	}
	if got.Rating <= 0 {
		t.Errorf("Rating = %v, want a positive rating", got.Rating)
	}
}

func TestRecentMatchStatsEmpty(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"items":[]}`))
	}))
	defer srv.Close()

	got, err := New(srv.URL, "key").RecentMatchStats(context.Background(), "abc", 30)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if got != nil {
		t.Errorf("got %+v, want nil for a player with no history", got)
	}
}

func TestRecentMatchStatsNoKey(t *testing.T) {
	if _, err := New("", "").RecentMatchStats(context.Background(), "abc", 30); err != ErrNoAPIKey {
		t.Errorf("err = %v, want ErrNoAPIKey", err)
	}
}
