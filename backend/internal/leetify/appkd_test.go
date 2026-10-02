package leetify

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// row builds a v3-shaped row (no kills) or, with k/d, an app-shaped one.
func row(src, outcome, mapName string, mine, theirs int, rating float64, kd ...int) RecentMatch {
	m := RecentMatch{DataSource: src, Outcome: outcome, MapName: mapName, Score: []int{mine, theirs}, LeetifyRating: rating}
	if len(kd) == 2 {
		m.Kills, m.Deaths = kd[0], kd[1]
	}
	return m
}

// kd renders a list's kills/deaths as "09/17 25/12 …" for one-line asserts.
func kd(ms []RecentMatch) string {
	parts := make([]string, 0, len(ms))
	for _, m := range ms {
		parts = append(parts, fmt.Sprintf("%02d/%02d", m.Kills, m.Deaths))
	}
	return strings.Join(parts, " ")
}

// The pairing rule, case by case. Both lists are newest-first; the app list
// is already folded onto v3's vocabulary (matchmaking_competitive →
// matchmaking), as appMatchHistory.recentMatches leaves it.
func TestMergeAppKD(t *testing.T) {
	cases := []struct {
		name   string
		v3     []RecentMatch
		app    []RecentMatch
		want   string // kills/deaths per v3 row after the merge
		paired int
	}{
		{
			name: "the plain case: same games in the same order pair one to one",
			v3: []RecentMatch{
				row("matchmaking", "loss", "de_ancient", 3, 13, 0.0561),
				row("matchmaking", "loss", "de_cache", 2, 13, -0.0562),
				row("faceit", "win", "de_mirage", 13, 9, 0.1234),
			},
			app: []RecentMatch{
				row("matchmaking", "loss", "de_ancient", 3, 13, 0.0561, 9, 17),
				row("matchmaking", "loss", "de_cache", 2, 13, -0.0562, 4, 16),
				row("faceit", "win", "de_mirage", 13, 9, 0.1234, 25, 12),
			},
			want: "09/17 04/16 25/12", paired: 3,
		},
		{
			name: "the same map twice in a row pairs when scores or ratings tell them apart",
			v3: []RecentMatch{
				row("matchmaking", "loss", "de_mirage", 0, 13, -0.0724),
				row("matchmaking", "loss", "de_mirage", 6, 13, -0.0722),
			},
			app: []RecentMatch{
				row("matchmaking", "loss", "de_mirage", 0, 13, -0.0724, 2, 14),
				row("matchmaking", "loss", "de_mirage", 6, 13, -0.0722, 11, 15),
			},
			want: "02/14 11/15", paired: 2,
		},
		{
			name: "a tie — two identical games side by side — stops the walk rather than guessing",
			v3: []RecentMatch{
				row("matchmaking", "win", "de_dust2", 13, 4, 0.1),
				row("matchmaking", "win", "de_dust2", 13, 4, 0.1),
				row("matchmaking", "loss", "de_nuke", 9, 13, 0.02),
			},
			app: []RecentMatch{
				row("matchmaking", "win", "de_dust2", 13, 4, 0.1, 20, 10),
				row("matchmaking", "win", "de_dust2", 13, 4, 0.1, 30, 5),
				row("matchmaking", "loss", "de_nuke", 9, 13, 0.02, 12, 18),
			},
			want: "00/00 00/00 00/00", paired: 0,
		},
		{
			name: "a tie on the app side only stops the walk too",
			v3: []RecentMatch{
				row("matchmaking", "win", "de_dust2", 13, 4, 0.1),
				row("matchmaking", "loss", "de_nuke", 9, 13, 0.02),
			},
			app: []RecentMatch{
				row("matchmaking", "win", "de_dust2", 13, 4, 0.1, 20, 10),
				row("matchmaking", "win", "de_dust2", 13, 4, 0.1, 30, 5),
			},
			want: "00/00 00/00", paired: 0,
		},
		{
			name: "a wingman game v3 does not list is skipped on the app side",
			v3: []RecentMatch{
				row("matchmaking", "loss", "de_ancient", 3, 13, 0.0561),
				row("matchmaking", "win", "de_nuke", 13, 11, 0.1042),
			},
			app: []RecentMatch{
				row("matchmaking", "loss", "de_ancient", 3, 13, 0.0561, 9, 17),
				row("matchmaking_wingman", "win", "de_vertigo", 9, 3, 0.2, 14, 6),
				row("matchmaking_wingman", "loss", "de_inferno", 5, 9, -0.1, 7, 11),
				row("matchmaking", "win", "de_nuke", 13, 11, 0.1042, 22, 15),
			},
			want: "09/17 22/15", paired: 2,
		},
		{
			name: "a game only v3 lists is skipped on the v3 side and stays without K/D",
			v3: []RecentMatch{
				row("matchmaking", "loss", "de_ancient", 3, 13, 0.0561),
				row("faceit", "win", "de_anubis", 13, 7, 0.09),
				row("matchmaking", "win", "de_nuke", 13, 11, 0.1042),
			},
			app: []RecentMatch{
				row("matchmaking", "loss", "de_ancient", 3, 13, 0.0561, 9, 17),
				row("matchmaking", "win", "de_nuke", 13, 11, 0.1042, 22, 15),
			},
			want: "09/17 00/00 22/15", paired: 2,
		},
		{
			name: "rows past the app's thirty keep no K/D",
			v3: []RecentMatch{
				row("matchmaking", "loss", "de_ancient", 3, 13, 0.0561),
				row("matchmaking", "win", "de_nuke", 13, 11, 0.1042),
				row("matchmaking", "win", "de_dust2", 13, 2, 0.2),
			},
			app: []RecentMatch{
				row("matchmaking", "loss", "de_ancient", 3, 13, 0.0561, 9, 17),
			},
			want: "09/17 00/00 00/00", paired: 1,
		},
		{
			name: "a disagreement neither side can resolve stops the walk; later agreement is not reached",
			v3: []RecentMatch{
				row("matchmaking", "loss", "de_ancient", 3, 13, 0.0561),
				row("matchmaking", "win", "de_nuke", 13, 11, 0.1042),
			},
			app: []RecentMatch{
				row("matchmaking", "win", "de_nuke", 13, 11, 0.1042, 22, 15),
				row("matchmaking", "loss", "de_ancient", 3, 13, 0.0561, 9, 17),
			},
			want: "00/00 00/00", paired: 0,
		},
		{
			name: "a rating off by a float's formatting still pairs; one off by a real digit does not",
			v3: []RecentMatch{
				row("matchmaking", "loss", "de_ancient", 3, 13, 0.0561),
				row("matchmaking", "win", "de_nuke", 13, 11, 0.1042),
			},
			app: []RecentMatch{
				row("matchmaking", "loss", "de_ancient", 3, 13, 0.05610000000000001, 9, 17),
				row("matchmaking", "win", "de_nuke", 13, 11, 0.1052, 22, 15),
			},
			want: "09/17 00/00", paired: 1,
		},
		{
			name: "the score pair is ordered: a mirrored score is another game",
			v3:   []RecentMatch{row("matchmaking", "loss", "de_ancient", 3, 13, 0.0561)},
			app:  []RecentMatch{row("matchmaking", "loss", "de_ancient", 13, 3, 0.0561, 9, 17)},
			want: "00/00", paired: 0,
		},
		{
			name: "a non-zero K/D already on the row is never overwritten",
			v3:   []RecentMatch{row("matchmaking", "loss", "de_ancient", 3, 13, 0.0561, 30, 1)},
			app:  []RecentMatch{row("matchmaking", "loss", "de_ancient", 3, 13, 0.0561, 9, 17)},
			want: "30/01", paired: 1,
		},
		{
			name: "map names compare without case",
			v3:   []RecentMatch{row("matchmaking", "loss", "DE_ANCIENT", 3, 13, 0.0561)},
			app:  []RecentMatch{row("matchmaking", "loss", "de_ancient", 3, 13, 0.0561, 9, 17)},
			want: "09/17", paired: 1,
		},
		{
			name: "empty lists pair nothing",
			v3:   []RecentMatch{row("matchmaking", "loss", "de_ancient", 3, 13, 0.0561)},
			app:  nil,
			want: "00/00", paired: 0,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			v3 := append([]RecentMatch(nil), tc.v3...)
			if got := mergeAppKD(v3, tc.app); got != tc.paired {
				t.Errorf("paired = %d, want %d", got, tc.paired)
			}
			if got := kd(v3); got != tc.want {
				t.Errorf("rows = %s, want %s", got, tc.want)
			}
		})
	}
}

// A member's profile: /v3 answers with rows that carry no kills, and the
// app's match-history — asked through the relay with the shared key and
// without the public-API key, exactly as the non-member fallback asks it —
// supplies them. The platform lists are cut after the merge, so they carry
// the numbers too.
func TestGetProfile_MemberRowsTakeKillsFromTheAppHistoryThroughTheRelay(t *testing.T) {
	v3Body := `{"name":"Pod","steam64_id":"42","total_matches":1971,"privacy_mode":"public","recent_matches":[
		{"id":"a1","finished_at":"2026-09-29T05:02:23.000Z","data_source":"matchmaking","outcome":"loss","map_name":"de_ancient","leetify_rating":0.0561,"score":[3,13],"rank":26616,"rank_type":11},
		{"id":"a2","finished_at":"2026-09-29T04:36:01.000Z","data_source":"faceit","outcome":"win","map_name":"de_cache","leetify_rating":0.0712,"score":[13,9],"rank":10},
		{"id":"a3","finished_at":"2026-09-23T22:31:57.000Z","data_source":"matchmaking","outcome":"tie","map_name":"de_nuke","leetify_rating":0.0724,"score":[12,12],"rank":8,"rank_type":12},
		{"id":"a4","finished_at":"2026-09-01T22:31:57.000Z","data_source":"matchmaking","outcome":"win","map_name":"de_dust2","leetify_rating":0.2,"score":[13,2],"rank":26000,"rank_type":11}
	]}`
	var directApp int32
	direct := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			atomic.AddInt32(&directApp, 1)
			w.WriteHeader(http.StatusNetworkAuthenticationRequired)
			return
		}
		_, _ = w.Write([]byte(v3Body))
	}))
	defer direct.Close()
	var relayPaths []string
	relay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		relayPaths = append(relayPaths, r.URL.Path)
		if r.Header.Get("X-Relay-Key") != "s3cret" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.Header.Get("_leetify_key") != "" {
			t.Errorf("the public-API key must not reach the app routes")
		}
		if r.URL.Path != "/api/profile/42/match-history" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("X-Relay-Upstream", "app")
		// Newest first; competitive is its own pool here; a wingman game v3
		// does not list; the fourth v3 game is past this list's end.
		_, _ = w.Write([]byte(`{"games":[
			{"dataSource":"matchmaking","deaths":17,"gameFinishedAt":"29","kills":9,"leetifyRating":0.0561,"mapName":"de_ancient","matchmakingRankType":11,"matchResult":"loss","rank":26616,"scores":[3,13]},
			{"dataSource":"faceit","deaths":12,"gameFinishedAt":"28","kills":25,"leetifyRating":0.0712,"mapName":"de_cache","matchmakingRankType":null,"matchResult":"win","rank":10,"scores":[13,9]},
			{"dataSource":"matchmaking_wingman","deaths":6,"gameFinishedAt":"27","kills":14,"leetifyRating":0.2,"mapName":"de_vertigo","matchmakingRankType":null,"matchResult":"win","rank":0,"scores":[9,3]},
			{"dataSource":"matchmaking_competitive","deaths":18,"gameFinishedAt":"26","kills":16,"leetifyRating":0.0724,"mapName":"de_nuke","matchmakingRankType":12,"matchResult":"tie","rank":8,"scores":[12,12]}
		]}`))
	}))
	defer relay.Close()

	c := New(direct.URL, "the-key", WithLegacyURL(direct.URL), WithAppRelay(relay.URL, "s3cret"))
	p, err := c.GetProfile(context.Background(), 42)
	if err != nil {
		t.Fatalf("GetProfile: %v", err)
	}
	if got := kd(p.RecentMatches); got != "09/17 25/12 16/18 00/00" {
		t.Errorf("recent_matches K/D = %s, want 09/17 25/12 16/18 00/00", got)
	}
	if got := kd(p.FaceitMatches); got != "25/12" {
		t.Errorf("faceit_matches K/D = %s, want 25/12", got)
	}
	if got := kd(p.PremierMatches); got != "09/17 00/00" {
		t.Errorf("premier_matches K/D = %s, want 09/17 00/00", got)
	}
	if strings.Join(relayPaths, " ") != "/api/profile/42/match-history" {
		t.Errorf("relay asked %v, want the match-history once", relayPaths)
	}
	if n := atomic.LoadInt32(&directApp); n != 0 {
		t.Errorf("app host asked directly %d times with a relay configured", n)
	}
	if p.Name != "Pod" || p.Source != "" {
		t.Errorf("the v3 profile itself must be untouched: %+v", p)
	}
}

// The K/D completion is best-effort: a relay that is an older paste (404),
// one that is down, a wall, or the fallback switch being off all leave the
// member's profile standing with no kills — never an error, never a request
// to the app host directly, and nothing at all while the app routes are
// paused.
func TestGetProfile_MemberRowsStandWithoutTheAppHistory(t *testing.T) {
	v3Body := `{"name":"Pod","steam64_id":"42","total_matches":1,"privacy_mode":"public","recent_matches":[
		{"id":"a1","finished_at":"2026-09-29T05:02:23.000Z","data_source":"matchmaking","outcome":"loss","map_name":"de_ancient","leetify_rating":0.0561,"score":[3,13],"rank":26616,"rank_type":11}
	]}`
	var directApp int32
	direct := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			atomic.AddInt32(&directApp, 1)
			w.WriteHeader(http.StatusNetworkAuthenticationRequired)
			return
		}
		_, _ = w.Write([]byte(v3Body))
	}))
	defer direct.Close()

	check := func(name string, c *Client, wantRelayCalls int32, relayCalls *int32) {
		t.Helper()
		p, err := c.GetProfile(context.Background(), 42)
		if err != nil {
			t.Fatalf("%s: GetProfile: %v", name, err)
		}
		if got := kd(p.RecentMatches); got != "00/00" {
			t.Errorf("%s: K/D = %s, want none", name, got)
		}
		if relayCalls != nil && atomic.LoadInt32(relayCalls) != wantRelayCalls {
			t.Errorf("%s: relay asked %d times, want %d", name, atomic.LoadInt32(relayCalls), wantRelayCalls)
		}
	}

	var oldPasteCalls int32
	oldPaste := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&oldPasteCalls, 1)
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte("not a relayed route"))
	}))
	defer oldPaste.Close()
	check("old relay paste", New(direct.URL, "", WithLegacyURL(direct.URL), WithAppRelay(oldPaste.URL, "k")), 1, &oldPasteCalls)

	check("relay down", New(direct.URL, "", WithLegacyURL(direct.URL), WithAppRelay("http://127.0.0.1:1", "k")), 0, nil)

	var wallCalls int32
	wall := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&wallCalls, 1)
		w.WriteHeader(http.StatusNetworkAuthenticationRequired)
		_, _ = w.Write([]byte(`{"error":"bot_check_required"}`))
	}))
	defer wall.Close()
	c := New(direct.URL, "", WithLegacyURL(direct.URL), WithAppRelay(wall.URL, "k"))
	check("wall (asked once more before it is believed)", c, 2, &wallCalls)
	if !c.appBlocked() {
		t.Error("a wall met twice pauses the app routes")
	}
	check("while paused: nothing is asked", c, 2, &wallCalls)

	var offCalls int32
	off := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&offCalls, 1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer off.Close()
	check("fallback switched off", New(direct.URL, "", WithLegacyURL(direct.URL), WithAppRelay(off.URL, "k"), WithAppFallback(false)), 0, &offCalls)

	// Without a relay the app host itself is asked once, and its wall is
	// what pauses the routes — the state the live box was in.
	c = New(direct.URL, "", WithLegacyURL(direct.URL))
	check("no relay: direct wall", c, 0, nil)
	if n := atomic.LoadInt32(&directApp); n != 1 {
		t.Errorf("app host asked directly %d times, want once", n)
	}
	if !c.appBlocked() {
		t.Error("a direct wall pauses the app routes")
	}
}

// The per-game scoreboard — /api/games/{id} — goes the way of the app
// routes: through the relay when one is configured, with the key and
// without the public-API key, and never to the app host directly.
func TestGetGameStats_GoesThroughTheRelayWhenConfigured(t *testing.T) {
	const game = "dc6e67a8-51fc-425e-9938-5bf71e47b254"
	var directCalls int32
	direct := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&directCalls, 1)
		w.WriteHeader(http.StatusNetworkAuthenticationRequired)
	}))
	defer direct.Close()
	var relayPath string
	relay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		relayPath = r.URL.Path
		if r.Header.Get("X-Relay-Key") != "s3cret" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.Header.Get("_leetify_key") != "" {
			t.Errorf("the public-API key must not reach the app routes")
		}
		w.Header().Set("X-Relay-Upstream", "app")
		_, _ = w.Write([]byte(`{"playerStats":[
			{"steam64Id":"42","name":"me","initialTeamNumber":2,"dpr":88.5,"kast":0.71,"hltvRating":1.12,"totalKills":21,"totalDeaths":14,"totalAssists":5,"mvps":3,"multi2k":4,"multi3k":1,"ctRoundsWon":7,"tRoundsWon":6},
			{"steam64Id":"43","name":"them","initialTeamNumber":3,"dpr":60,"kast":0.6,"hltvRating":0.9,"totalKills":12,"totalDeaths":20,"ctRoundsWon":5,"tRoundsWon":4}
		]}`))
	}))
	defer relay.Close()

	c := New(direct.URL, "the-key", WithLegacyURL(direct.URL), WithAppRelay(relay.URL, "s3cret"))
	gs, err := c.GetGameStats(context.Background(), game, 42)
	if err != nil {
		t.Fatalf("GetGameStats: %v", err)
	}
	if !gs.Found || gs.Kills != 21 || gs.Deaths != 14 || gs.Assists != 5 || gs.MVPs != 3 || gs.Multi2K != 4 || gs.ADR != 88.5 {
		t.Errorf("stats = %+v", gs)
	}
	if len(gs.Scoreboard) != 2 || gs.Scoreboard[0].Score != 13 || !gs.Scoreboard[0].Players[0].Me || gs.Scoreboard[1].Score != 9 {
		t.Errorf("scoreboard = %+v", gs.Scoreboard)
	}
	if relayPath != "/api/games/"+game {
		t.Errorf("relay asked %q, want /api/games/%s", relayPath, game)
	}
	if n := atomic.LoadInt32(&directCalls); n != 0 {
		t.Errorf("app host asked directly %d times with a relay configured", n)
	}

	// The details route is the same request.
	gd, err := c.GetGameDetails(context.Background(), game)
	if err != nil || relayPath != "/api/games/"+game {
		t.Errorf("GetGameDetails: %v, asked %q", err, relayPath)
	}
	if gd == nil {
		t.Error("GetGameDetails returned nothing")
	}
}

// A wall on the per-game route is a miss the site could not verify
// (ErrUnavailable, kept for seconds by the handler), it pauses the app
// routes, and while they are paused nothing is asked. A 404 stays a plain
// miss.
func TestGetGameStats_WallIsUnavailableAndPausesTheAppRoutes(t *testing.T) {
	var relayCalls int32
	relay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&relayCalls, 1)
		w.Header().Set("X-Relay-Upstream", "app")
		if strings.HasSuffix(r.URL.Path, "/gone") {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusNetworkAuthenticationRequired)
		_, _ = w.Write([]byte(`{"error":"bot_check_required"}`))
	}))
	defer relay.Close()
	direct := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("the app host must not be asked directly")
	}))
	defer direct.Close()

	c := New(direct.URL, "", WithLegacyURL(direct.URL), WithAppRelay(relay.URL, "k"))
	if _, err := c.GetGameStats(context.Background(), "gone", 42); !errors.Is(err, ErrNotFound) || errors.Is(err, ErrUnavailable) {
		t.Errorf("404: err = %v, want a plain ErrNotFound", err)
	}
	_, err := c.GetGameStats(context.Background(), "walled", 42)
	if !errors.Is(err, ErrUnavailable) || !errors.Is(err, ErrNotFound) {
		t.Fatalf("wall: err = %v, want ErrUnavailable (which is also ErrNotFound)", err)
	}
	if n := atomic.LoadInt32(&relayCalls); n != 3 {
		t.Errorf("relay asked %d times, want 3: the 404, the wall, and the wall once more before it is believed", n)
	}
	if !c.appBlocked() {
		t.Fatal("a wall met twice pauses the app routes")
	}
	if _, err := c.GetGameStats(context.Background(), "walled", 42); !errors.Is(err, ErrUnavailable) {
		t.Errorf("paused: err = %v, want ErrUnavailable", err)
	}
	if _, err := c.GetGameDetails(context.Background(), "walled"); !errors.Is(err, ErrUnavailable) {
		t.Errorf("paused details: err = %v, want ErrUnavailable", err)
	}
	if n := atomic.LoadInt32(&relayCalls); n != 3 {
		t.Errorf("relay asked %d times while paused, want none", n-3)
	}
}
