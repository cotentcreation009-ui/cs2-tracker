package leetify

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// A Leetify that has forgotten a player on /v3 but still shows them on its own
// app routes — the exact shape seen live on 2026-09-24 for a public Steam
// account that was never a Leetify member. The v3 answer is 404; the app
// answers per pool, and one of them is refused.
func appServer(t *testing.T, appCalls *int32) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("_leetify_key") != "" && strings.HasPrefix(r.URL.Path, "/api/") {
			t.Errorf("the public-API key must not be sent to the app routes: %s", r.URL.Path)
		}
		switch {
		case r.URL.Path == "/v3/profile":
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte("Not Found"))
		case strings.HasPrefix(r.URL.Path, "/api/"):
			atomic.AddInt32(appCalls, 1)
			switch r.URL.Path {
			case "/api/profile/42/recent-games/available-data-sources":
				_ = json.NewEncoder(w).Encode(map[string]any{"dataSources": map[string]int{"matchmaking": 30, "5v5": 30}})
			case "/api/profile/42/recent-games/5v5":
				// Refused: hidden by the player, or not served anonymously.
				w.WriteHeader(http.StatusForbidden)
			case "/api/profile/42/recent-games/matchmaking":
				// The live 2026-09-24 payload, trimmed. leetifyRatingCategories
				// and topStats are present upstream and deliberately unmapped.
				_, _ = w.Write([]byte(`{
					"aimRating": 88.87674957091696, "leetifyRating": 0.0242, "utilityRating": 51.03498982691935,
					"ctLeetifyRating": 0.0467, "tLeetifyRating": -0.0038, "preaim": 9.196176470588236,
					"reactionTime": 542.9117647058823,
					"accuracyHead": 22.493806228373703, "accuracyEnemySpotted": 39.64413494809689, "sprayAccuracy": 41.943380035026266,
					"counterStrafingShotsGoodRatio": 84.21180385288967, "headshotKillPercentage": 43.149,
					"flashbangHitFoePerFlashbang": 0.4693252595155709, "flashbangLeadingToKill": 9.157352941176473,
					"utilityOnDeathAvg": 243.8166089965398,
					"kdRatio": 1.228643216080402, "winRate": 0.4666666666666667, "kast": 0.7140662691652472,
					"matchesPlayed": 30, "heFoesDamageAvg": 7.938148788927334, "heFriendsDamageAvg": 0.04927335640138408,
					"leetifyRatingCategories": {"Clutches": 3.0547, "Opening Duels": 1.248},
					"topStats": [{"skillId": "reactionTime", "value": 543.17}]
				}`))
			case "/api/profile/42/meta":
				_ = json.NewEncoder(w).Encode(map[string]any{"steam64Id": "42", "name": "Malone Lam"})
			case "/api/profile/7/recent-games/available-data-sources":
				// Never seen by Leetify at all.
				_ = json.NewEncoder(w).Encode(map[string]any{"dataSources": map[string]int{}})
			case "/api/profile/9/recent-games/available-data-sources":
				_ = json.NewEncoder(w).Encode(map[string]any{"dataSources": map[string]int{"5v5": 3}})
			case "/api/profile/9/recent-games/5v5":
				// Listed as a pool, but the stats body is the app's empty `{}`.
				_, _ = w.Write([]byte("{}"))
			default:
				w.WriteHeader(http.StatusNotFound)
			}
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

func TestGetProfile_FallsBackToAppAPIAndSkipsRefusedPool(t *testing.T) {
	var appCalls int32
	srv := appServer(t, &appCalls)
	defer srv.Close()
	c := New(srv.URL, "the-key", WithLegacyURL(srv.URL))

	p, err := c.GetProfile(context.Background(), 42)
	if err != nil {
		t.Fatalf("GetProfile: %v", err)
	}
	if p.Name != "Malone Lam" || p.Steam64ID != "42" {
		t.Errorf("identity = %q/%q", p.Name, p.Steam64ID)
	}
	if p.Source != "app:matchmaking" {
		t.Errorf("source = %q, want app:matchmaking (5v5 was refused and must be skipped, not retried)", p.Source)
	}
	if p.PrivacyMode != "" {
		t.Errorf("privacy_mode = %q, want empty: the app states none and we do not invent one", p.PrivacyMode)
	}
	// Unrenamed, unrescaled — the numbers the player's own Leetify page shows.
	if p.Rating.Aim != 88.87674957091696 || p.Rating.Utility != 51.03498982691935 {
		t.Errorf("aim/utility = %v/%v", p.Rating.Aim, p.Rating.Utility)
	}
	if p.Rating.CTLeetify != 0.0467 || p.Rating.TLeetify != -0.0038 {
		t.Errorf("ct/t = %v/%v", p.Rating.CTLeetify, p.Rating.TLeetify)
	}
	if p.Rating.Positioning != 0 || p.Rating.Clutch != 0 || p.Rating.Opening != 0 {
		t.Errorf("positioning/clutch/opening must stay absent (no honest source), got %+v", p.Rating)
	}
	s := p.Stats
	if s.CounterStrafingRatio != 84.21180385288967 || s.Preaim != 9.196176470588236 || s.SprayAccuracy != 41.943380035026266 {
		t.Errorf("mechanics = %+v", s)
	}
	if s.ReactionTimeMs != 542.9117647058823 {
		t.Errorf("reaction time = %v, want the top-level reactionTime in ms (not the topStats copy)", s.ReactionTimeMs)
	}
	if s.HEFoesDamageAvg != 7.938148788927334 || s.HEFriendsDamageAvg != 0.04927335640138408 {
		t.Errorf("HE pair = %v / %v", s.HEFoesDamageAvg, s.HEFriendsDamageAvg)
	}
	if s.FlashbangHitFoePerFlash != 0.4693252595155709 || s.FlashbangLeadingToKill != 9.157352941176473 || s.UtilityOnDeathAvg != 243.8166089965398 {
		t.Errorf("utility = %+v", s)
	}
	if p.KD != 1.228643216080402 || p.Winrate != 0.4666666666666667 || p.TotalMatches != 30 {
		t.Errorf("kd/winrate/matches = %v/%v/%v", p.KD, p.Winrate, p.TotalMatches)
	}
	// The headline rating lands on v3's ranks scale (×100), and nothing else
	// is claimed about ranks.
	var ranks map[string]float64
	if err := json.Unmarshal(p.Ranks, &ranks); err != nil {
		t.Fatalf("ranks = %s: %v", p.Ranks, err)
	}
	if len(ranks) != 1 || ranks["leetify"] != 2.42 {
		t.Errorf("ranks = %v, want exactly {leetify: 2.42}", ranks)
	}
	if p.RecentMatches == nil || len(p.RecentMatches) != 0 {
		t.Errorf("recent_matches must be present and empty, got %v", p.RecentMatches)
	}
}

func TestGetProfile_AppAPIHasNothingEither(t *testing.T) {
	var appCalls int32
	srv := appServer(t, &appCalls)
	defer srv.Close()
	c := New(srv.URL, "", WithLegacyURL(srv.URL))

	// Never seen by the app: the pool list is empty.
	if _, err := c.GetProfile(context.Background(), 7); err != ErrNotFound {
		t.Errorf("unknown player: err = %v, want ErrNotFound", err)
	}
	// Listed, but every pool body is empty.
	if _, err := c.GetProfile(context.Background(), 9); err != ErrNotFound {
		t.Errorf("empty player: err = %v, want ErrNotFound", err)
	}
}

// From a datacenter IP the app host answers 511 to everything (seen live on
// the VM, 2026-09-24, while a home connection got 200). That must read as a
// plain miss — never a 500 — and must pause the app routes for a while: a
// wall is per network, not per player, so knocking again per lookup is noise.
func TestGetProfile_AppHostBotWallPausesTheFallback(t *testing.T) {
	var appCalls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			atomic.AddInt32(&appCalls, 1)
			w.WriteHeader(http.StatusNetworkAuthenticationRequired)
			_, _ = w.Write([]byte(`{"error":"bot_check_required"}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	c := New(srv.URL, "", WithLegacyURL(srv.URL))

	for i := 0; i < 3; i++ {
		if _, err := c.GetProfile(context.Background(), 42); err != ErrNotFound {
			t.Fatalf("lookup %d: err = %v, want ErrNotFound", i, err)
		}
	}
	if n := atomic.LoadInt32(&appCalls); n != 1 {
		t.Errorf("app calls = %d, want 1: the first 511 pauses the fallback", n)
	}
	if !c.appBlocked() {
		t.Error("the fallback should be paused after a 511")
	}
}

// Any other failure inside the fallback is also a miss to the caller, but it
// does not pause anything: a 500 from the app is a bad moment, not a wall.
func TestGetProfile_AppErrorIsAMissNotAnError(t *testing.T) {
	var appCalls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			atomic.AddInt32(&appCalls, 1)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	c := New(srv.URL, "", WithLegacyURL(srv.URL))

	for i := 0; i < 2; i++ {
		if _, err := c.GetProfile(context.Background(), 42); err != ErrNotFound {
			t.Fatalf("lookup %d: err = %v, want ErrNotFound", i, err)
		}
	}
	if n := atomic.LoadInt32(&appCalls); n != 2 {
		t.Errorf("app calls = %d, want 2: an ordinary error must not pause the fallback", n)
	}
}

func TestGetProfile_AppFallbackOff(t *testing.T) {
	var appCalls int32
	srv := appServer(t, &appCalls)
	defer srv.Close()
	c := New(srv.URL, "", WithLegacyURL(srv.URL), WithAppFallback(false))

	if _, err := c.GetProfile(context.Background(), 42); err != ErrNotFound {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
	if n := atomic.LoadInt32(&appCalls); n != 0 {
		t.Errorf("app routes were called %d times with the fallback off; the switch must be absolute", n)
	}
}
