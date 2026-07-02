package leetify

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetProfile(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v3/profile" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("steam64_id"); got != "76561198077030352" {
			t.Errorf("steam64_id = %s", got)
		}
		w.Write([]byte(`{
			"name":"Pod","steam64_id":"76561198077030352","total_matches":1971,
			"winrate":0.59,"privacy_mode":"public",
			"rating":{"aim":72.5,"positioning":61.2,"utility":55.0,"clutch":48.1,"opening":63.4,"ct_leetify":1.9,"t_leetify":1.4},
			"stats":{"accuracy_head":0.31,"preaim":4.2,"reaction_time_ms":540,"spray_accuracy":0.27,"trade_kills_success_percentage":0.62},
			"ranks":{"premier":{"rating":24500}}
		}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "")
	p, err := c.GetProfile(context.Background(), 76561198077030352)
	if err != nil {
		t.Fatal(err)
	}
	if p.Name != "Pod" || p.TotalMatches != 1971 {
		t.Errorf("unexpected profile: %+v", p)
	}
	if p.Rating.Aim != 72.5 || p.Rating.CTLeetify != 1.9 {
		t.Errorf("rating not parsed: %+v", p.Rating)
	}
	if p.Winrate != 0.59 || p.Stats.AccuracyHead != 0.31 {
		t.Errorf("stats not parsed: %+v / %+v", p.Winrate, p.Stats)
	}
	if len(p.Ranks) == 0 {
		t.Error("ranks passthrough empty")
	}
}

func TestGetProfileNotFound(t *testing.T) {
	// Both v3 and legacy 404 → ErrNotFound. Legacy is pinned at the test server
	// so the fallback never touches the real API.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	c := New(srv.URL, "", WithLegacyURL(srv.URL))
	if _, err := c.GetProfile(context.Background(), 1); err != ErrNotFound {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
}

// When /v3 404s but the legacy endpoint has the account, GetProfile transparently
// falls back and maps the legacy shape into the same Profile.
func TestGetProfileLegacyFallback(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v3/profile":
			w.WriteHeader(http.StatusNotFound)
		case "/api/profile/id/76561197995150836":
			w.Write([]byte(`{
				"meta":{"name":"Malone Lam","platformBans":[]},
				"recentGameRatings":{"aim":89.1,"positioning":68.8,"utility":58.9,"clutch":0.19,"opening":0.026,"ctLeetify":0.036,"tLeetify":0.011},
				"games":[
					{"gameId":"g1","gameFinishedAt":"2026-07-01T00:00:00.000Z","dataSource":"matchmaking","matchResult":"win","mapName":"de_mirage","scores":[16,13],"rankType":11,"skillLevel":30799,"elo":null,"ownTeamTotalLeetifyRatings":{"76561197995150836":0.0066},"preaim":0,"reactionTime":0,"accuracyHead":0},
					{"gameId":"g2","gameFinishedAt":"2026-06-30T00:00:00.000Z","dataSource":"faceit","matchResult":"loss","mapName":"de_inferno","scores":[10,13],"rankType":1,"skillLevel":0,"elo":2542,"ownTeamTotalLeetifyRatings":{"76561197995150836":-0.05},"preaim":7.5,"reactionTime":520,"accuracyHead":30}
				]
			}`))
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	c := New(srv.URL, "", WithLegacyURL(srv.URL))
	p, err := c.GetProfile(context.Background(), 76561197995150836)
	if err != nil {
		t.Fatalf("fallback failed: %v", err)
	}
	if p.Name != "Malone Lam" || p.TotalMatches != 2 {
		t.Errorf("identity/matches wrong: %+v", p)
	}
	if p.Winrate != 0.5 {
		t.Errorf("winrate = %v, want 0.5", p.Winrate)
	}
	if p.Rating.Aim != 89.1 || p.Rating.CTLeetify != 0.036 {
		t.Errorf("rating not mapped: %+v", p.Rating)
	}
	// aim micro-stats averaged from the non-zero games only
	if p.Stats.Preaim != 7.5 || p.Stats.ReactionTimeMs != 520 || p.Stats.AccuracyHead != 30 {
		t.Errorf("stats not averaged from games: %+v", p.Stats)
	}
	if len(p.RecentMatches) != 2 {
		t.Fatalf("recent matches = %d, want 2", len(p.RecentMatches))
	}
	m0 := p.RecentMatches[0]
	if m0.LeetifyRating != 0.0066 || m0.Rank != 30799 || m0.RankType != 11 || m0.Outcome != "win" {
		t.Errorf("match0 not mapped: %+v", m0)
	}
	if p.RecentMatches[1].Rank != 2542 { // from elo (skillLevel was 0)
		t.Errorf("faceit match rank should fall back to elo: %+v", p.RecentMatches[1])
	}
	if string(p.Ranks) != `{"premier":30799}` {
		t.Errorf("ranks = %s, want premier 30799", p.Ranks)
	}
}
