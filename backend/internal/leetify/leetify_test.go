package leetify

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGetProfile(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The FACEIT-completion step hits the legacy endpoint when the v3 window is
		// FACEIT-sparse; 404 it so the merge is a no-op (and no real API is called).
		if r.URL.Path == "/api/profile/id/76561198077030352" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
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

	c := New(srv.URL, "", WithLegacyURL(srv.URL))
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

// When v3 returns a FULL 100-match window with no FACEIT, the older FACEIT games
// are completed from the legacy endpoint.
func TestGetProfileCompletesFaceitFromLegacy(t *testing.T) {
	rows := make([]string, v3MatchWindow) // a full v3 window, all Premier, no FACEIT
	for i := range rows {
		rows[i] = `{"data_source":"matchmaking","rank_type":11,"outcome":"win","leetify_rating":0.1,"score":[13,7],"map_name":"de_dust2"}`
	}
	v3 := fmt.Sprintf(
		`{"name":"P","steam64_id":"1","total_matches":900,"winrate":0.5,"rating":{"aim":80},"recent_matches":[%s]}`,
		strings.Join(rows, ","),
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v3/profile":
			w.Write([]byte(v3))
		case "/api/profile/id/1":
			w.Write([]byte(`{"meta":{"name":"P"},"recentGameRatings":{"aim":80,"leetify":0.02},"games":[
				{"gameId":"f1","dataSource":"faceit","matchResult":"win","rankType":0,"skillLevel":0,"elo":2100,"scores":[13,5],"ownTeamTotalLeetifyRatings":{"1":0.3},"preaim":6,"reactionTime":0.5,"accuracyHead":0.3},
				{"gameId":"f2","dataSource":"faceit","matchResult":"loss","rankType":0,"skillLevel":0,"elo":2100,"scores":[8,13],"ownTeamTotalLeetifyRatings":{"1":-0.1},"preaim":7,"reactionTime":0.55,"accuracyHead":0.25}
			]}`))
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer srv.Close()

	c := New(srv.URL, "", WithLegacyURL(srv.URL))
	p, err := c.GetProfile(context.Background(), 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.FaceitMatches) != 2 {
		t.Fatalf("faceit matches = %d, want 2 (completed from legacy)", len(p.FaceitMatches))
	}
	if p.FaceitMatches[0].DataSource != "faceit" || p.FaceitMatches[0].Rank != 2100 {
		t.Errorf("faceit match not mapped from legacy: %+v", p.FaceitMatches[0])
	}
	// The Premier list keeps the v3 window's Premier games (fuller than legacy's 0).
	if len(p.PremierMatches) != v3MatchWindow {
		t.Errorf("premier matches = %d, want %d (from v3 window)", len(p.PremierMatches), v3MatchWindow)
	}
	// v3 stays the base (aim 80 kept)
	if p.Rating.Aim != 80 {
		t.Errorf("v3 base lost: aim = %v", p.Rating.Aim)
	}
}

// The mirror case (the Kiwi bug): a FACEIT-heavy v3 window (only a few Premier
// games visible) must complete the PREMIER list from the legacy endpoint.
func TestGetProfileCompletesPremierFromLegacy(t *testing.T) {
	rows := make([]string, v3MatchWindow) // full window: 97 faceit + 3 premier
	for i := range rows {
		if i < 3 {
			rows[i] = `{"data_source":"matchmaking","rank_type":11,"rank":30000,"outcome":"win","leetify_rating":0.1,"score":[13,7],"map_name":"de_mirage"}`
		} else {
			rows[i] = `{"data_source":"faceit","rank_type":0,"outcome":"loss","leetify_rating":-0.1,"score":[9,13],"map_name":"de_inferno"}`
		}
	}
	v3 := fmt.Sprintf(
		`{"name":"K","steam64_id":"2","total_matches":8229,"winrate":0.72,"rating":{"aim":99},"recent_matches":[%s]}`,
		strings.Join(rows, ","),
	)
	// legacy history holds the older Premier games the v3 window cut off
	legacyGames := make([]string, 40)
	for i := range legacyGames {
		legacyGames[i] = fmt.Sprintf(
			`{"gameId":"p%d","dataSource":"matchmaking","matchResult":"win","rankType":11,"skillLevel":%d,"scores":[13,9],"ownTeamTotalLeetifyRatings":{"2":0.2},"kills":20,"deaths":15,"partySize":2}`,
			i, 29000+i,
		)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v3/profile":
			w.Write([]byte(v3))
		case "/api/profile/id/2":
			fmt.Fprintf(w, `{"meta":{"name":"K"},"recentGameRatings":{"aim":99,"leetify":0.0145},"games":[%s]}`,
				strings.Join(legacyGames, ","))
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer srv.Close()

	c := New(srv.URL, "", WithLegacyURL(srv.URL))
	p, err := c.GetProfile(context.Background(), 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.PremierMatches) != 40 {
		t.Fatalf("premier matches = %d, want 40 (completed from legacy)", len(p.PremierMatches))
	}
	if p.PremierMatches[0].RankType != 11 || p.PremierMatches[0].Rank != 29000 {
		t.Errorf("premier match not mapped from legacy: %+v", p.PremierMatches[0])
	}
	// FACEIT keeps the fuller v3 set (97 > legacy's 0).
	if len(p.FaceitMatches) != 97 {
		t.Errorf("faceit matches = %d, want 97 (v3 kept)", len(p.FaceitMatches))
	}
	// legacy peak beats the v3 window's 30000
	if p.PeakPremier != 30000 {
		t.Errorf("peak premier = %d, want 30000 (v3 window rank)", p.PeakPremier)
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
				"recentGameRatings":{"aim":89.1,"positioning":68.8,"utility":58.9,"clutch":0.19,"opening":0.026,"ctLeetify":0.036,"tLeetify":0.011,"leetify":0.024},
				"games":[
					{"gameId":"g1","gameFinishedAt":"2026-07-01T00:00:00.000Z","dataSource":"matchmaking","matchResult":"win","mapName":"de_mirage","scores":[16,13],"rankType":11,"skillLevel":30799,"elo":null,"ownTeamTotalLeetifyRatings":{"76561197995150836":0.0066},"preaim":0,"reactionTime":0,"accuracyHead":0,"kills":20,"deaths":15,"partySize":5},
					{"gameId":"g2","gameFinishedAt":"2026-06-30T00:00:00.000Z","dataSource":"faceit","matchResult":"loss","mapName":"de_inferno","scores":[10,13],"rankType":1,"skillLevel":0,"elo":2542,"ownTeamTotalLeetifyRatings":{"76561197995150836":-0.05},"preaim":7.5,"reactionTime":0.52,"accuracyHead":0.30,"kills":18,"deaths":20,"partySize":1}
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
	if string(p.Ranks) != `{"leetify":2.4,"premier":30799}` {
		t.Errorf("ranks = %s, want leetify 2.4 + premier 30799", p.Ranks)
	}
	if p.KD < 1.08 || p.KD > 1.09 { // (20+18)/(15+20) = 1.086
		t.Errorf("KD = %v, want ~1.086", p.KD)
	}
	if p.AvgPartySize != 3.0 { // (5+1)/2
		t.Errorf("avg party = %v, want 3.0", p.AvgPartySize)
	}
	if p.PeakPremier != 30799 {
		t.Errorf("peak premier = %v, want 30799", p.PeakPremier)
	}
	if len(p.FaceitMatches) != 1 || p.FaceitMatches[0].DataSource != "faceit" {
		t.Errorf("faceit matches = %+v, want the one faceit game", p.FaceitMatches)
	}
	if len(p.PremierMatches) != 1 || p.PremierMatches[0].RankType != 11 {
		t.Errorf("premier matches = %+v, want the one premier game", p.PremierMatches)
	}
}
