package api

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cs2tracker/server/internal/cache"
	"github.com/cs2tracker/server/internal/config"
	"github.com/cs2tracker/server/internal/faceit"
	"github.com/cs2tracker/server/internal/leetify"
	"github.com/cs2tracker/server/internal/steam"
)

// The demo-download link resolves a game exactly the way one-click analysis
// does, but starts nothing. These drive the real route against fakes of the
// three upstreams it can touch: Leetify (which game is it), the gc-bot (Valve
// replay URL for a share code) and FACEIT (signed link for a match id).

const (
	dlSteam     = "76561198019780871"
	dlShareCode = "CSGO-dEvM2-2eRoD-czDcx-jZBJS-yGvjN"
	dlFaceitID  = "1-b6da8261-7a4d-4067-8dee-06c6c47a7118"
	dlValveURL  = "http://replay129.valve.net/730/003771234567890123456_0123456789.dem.bz2"
)

type dlUpstreams struct {
	// Leetify's v3 match list for the profile: one row, or none when listedID
	// is empty. The legacy per-game route always answers 404.
	listedID, source, ref, finishedAt string
	// gc-bot: status + body for /resolve and /recent.
	botStatus  int
	botURL     string
	recentBody string
	noBot      bool
	// FACEIT: status of the Download API (the Data API always has the demo).
	faceitSign int
	noFaceit   bool

	botCalls, signCalls atomic.Int32
}

func (u *dlUpstreams) server(t *testing.T) (*Server, *mapKV) {
	t.Helper()
	lmux := http.NewServeMux()
	lmux.HandleFunc("/api/games/", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})
	lmux.HandleFunc("/v3/profile/matches", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if u.listedID == "" {
			_, _ = w.Write([]byte(`[]`))
			return
		}
		_, _ = w.Write([]byte(`[{"id":"` + u.listedID + `","data_source":"` + u.source + `","data_source_match_id":"` + u.ref + `","finished_at":"` + u.finishedAt + `"}]`))
	})
	ls := httptest.NewServer(lmux)
	t.Cleanup(ls.Close)

	cfg := &config.Config{CORSOrigins: []string{"*"}}
	if !u.noBot {
		bmux := http.NewServeMux()
		bmux.HandleFunc("/resolve", func(w http.ResponseWriter, r *http.Request) {
			u.botCalls.Add(1)
			var body struct {
				ShareCode string `json:"shareCode"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body.ShareCode != dlShareCode {
				t.Errorf("gc-bot asked for %q, want the listed share code", body.ShareCode)
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(u.botStatus)
			_, _ = w.Write([]byte(`{"demoUrl":"` + u.botURL + `"}`))
		})
		bmux.HandleFunc("/recent", func(w http.ResponseWriter, r *http.Request) {
			u.botCalls.Add(1)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(u.recentBody))
		})
		bs := httptest.NewServer(bmux)
		t.Cleanup(bs.Close)
		cfg.GCBotURL = bs.URL
	}

	var fc *faceit.Client
	if !u.noFaceit {
		fmux := http.NewServeMux()
		fmux.HandleFunc("/matches/", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"FINISHED","demo_url":["https://demos-europe-central.backblaze.faceit-cdn.net/cs2/` + dlFaceitID + `-1-1.dem.zst"]}`))
		})
		fmux.HandleFunc("/download", func(w http.ResponseWriter, r *http.Request) {
			u.signCalls.Add(1)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(u.faceitSign)
			if u.faceitSign == http.StatusOK {
				_, _ = w.Write([]byte(`{"payload":{"download_url":"https://signed.faceit-cdn.net/cs2/` + dlFaceitID + `-1-1.dem.zst?sig=abc"}}`))
				return
			}
			_, _ = w.Write([]byte(`{"errors":[{"code":"err_f0","message":"no valid scope provided"}]}`))
		})
		fs := httptest.NewServer(fmux)
		t.Cleanup(fs.Close)
		fc = faceit.New(fs.URL, "data-key", faceit.WithDownloadURL(fs.URL+"/download"))
	}

	s := NewServer(cfg, &fakeStore{}, steam.New(""),
		leetify.New(ls.URL, "", leetify.WithLegacyURL(ls.URL)),
		fc, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	kv := newMapKV()
	s.kvOverride = kv
	return s, kv
}

func getDemo(t *testing.T, h http.Handler, gameID, query string) (int, demoDownload) {
	t.Helper()
	w := doGET(h, "/api/players/"+dlSteam+"/leetify-game/"+gameID+"/demo"+query)
	var v demoDownload
	if w.Code == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
			t.Fatalf("decode %s: %v", w.Body.String(), err)
		}
		if cc := w.Header().Get("Cache-Control"); cc != "no-store" {
			t.Errorf("Cache-Control = %q; a demo link must not be kept downstream", cc)
		}
	}
	return w.Code, v
}

func hoursAgo(h int) string {
	return time.Now().Add(-time.Duration(h) * time.Hour).UTC().Format(time.RFC3339)
}

func TestDemoDownloadValveLink(t *testing.T) {
	u := &dlUpstreams{listedID: bridgedGame, source: "matchmaking", ref: dlShareCode, finishedAt: hoursAgo(48),
		botStatus: http.StatusOK, botURL: dlValveURL}
	s, kv := u.server(t)
	h := s.Router()

	code, v := getDemo(t, h, bridgedGame, "")
	if code != http.StatusOK || !v.Available {
		t.Fatalf("status=%d answer=%+v; want an available link", code, v)
	}
	if v.URL != dlValveURL || v.Source != "valve" {
		t.Errorf("url=%q source=%q; want Valve's own replay URL, untouched", v.URL, v.Source)
	}
	if v.Filename != "003771234567890123456_0123456789.dem.bz2" {
		t.Errorf("filename = %q", v.Filename)
	}
	// Valve drops the replay about a month after the game: the answer says when.
	gone, err := time.Parse(time.RFC3339, v.ExpiresAt)
	if err != nil || time.Until(gone) < 28*24*time.Hour || time.Until(gone) > 30*24*time.Hour {
		t.Errorf("expires_at = %q; want about 29 days out for a 2-day-old game", v.ExpiresAt)
	}

	// Remembered: a second click does not go back to the Game Coordinator.
	key := cache.LeetifyGameDemoKey(bridgedGame, 76561198019780871)
	if got := kv.ttl[key]; got != demoDLValveTTL {
		t.Errorf("cached for %v, want %v", got, demoDLValveTTL)
	}
	if _, again := getDemo(t, h, bridgedGame, ""); !again.Available || again.URL != dlValveURL {
		t.Errorf("second answer = %+v", again)
	}
	if n := u.botCalls.Load(); n != 1 {
		t.Errorf("gc-bot asked %d times for one game, want 1", n)
	}
}

func TestDemoDownloadValveExpired(t *testing.T) {
	u := &dlUpstreams{listedID: bridgedGame, source: "matchmaking", ref: dlShareCode, finishedAt: hoursAgo(45 * 24),
		botStatus: http.StatusOK, botURL: dlValveURL}
	s, kv := u.server(t)

	code, v := getDemo(t, s.Router(), bridgedGame, "")
	if code != http.StatusOK || v.Available || v.Code != "valve_expired" {
		t.Fatalf("status=%d answer=%+v; want the expired refusal", code, v)
	}
	if !strings.Contains(v.Reason, "Valve no longer hosts this demo") || v.URL != "" {
		t.Errorf("reason=%q url=%q", v.Reason, v.URL)
	}
	// Decided from the finish time alone — the bot is never bothered — and
	// kept for a day, since an expired replay does not come back.
	if n := u.botCalls.Load(); n != 0 {
		t.Errorf("gc-bot asked %d times about an expired replay", n)
	}
	if got := kv.ttl[cache.LeetifyGameDemoKey(bridgedGame, 76561198019780871)]; got != demoDLGoneTTL {
		t.Errorf("cached for %v, want %v", got, demoDLGoneTTL)
	}
}

func TestDemoDownloadValveReplayGone(t *testing.T) {
	// Inside the month, but the Game Coordinator has no replay (never recorded).
	u := &dlUpstreams{listedID: bridgedGame, source: "matchmaking", ref: dlShareCode, finishedAt: hoursAgo(5),
		botStatus: http.StatusNotFound}
	s, _ := u.server(t)
	_, v := getDemo(t, s.Router(), bridgedGame, "")
	if v.Available || v.Code != "valve_no_replay" {
		t.Fatalf("answer=%+v; want valve_no_replay", v)
	}
}

func TestDemoDownloadBotOfflineIsBrief(t *testing.T) {
	u := &dlUpstreams{listedID: bridgedGame, source: "matchmaking", ref: dlShareCode, finishedAt: hoursAgo(5),
		botStatus: http.StatusServiceUnavailable}
	s, kv := u.server(t)
	_, v := getDemo(t, s.Router(), bridgedGame, "")
	if v.Available || v.Code != "bot_unavailable" {
		t.Fatalf("answer=%+v; want bot_unavailable", v)
	}
	// A bot that is merely reconnecting must not cost the player half an hour.
	if got := kv.ttl[cache.LeetifyGameDemoKey(bridgedGame, 76561198019780871)]; got != unavailableCacheTTL {
		t.Errorf("cached for %v, want %v", got, unavailableCacheTTL)
	}
}

func TestDemoDownloadRefusesANonWebLink(t *testing.T) {
	// Whatever the Game Coordinator hands back ends up in a browser's address
	// bar; anything that is not http(s) is not a link we pass on.
	u := &dlUpstreams{listedID: bridgedGame, source: "matchmaking", ref: dlShareCode, finishedAt: hoursAgo(5),
		botStatus: http.StatusOK, botURL: "javascript:alert(1)"}
	s, _ := u.server(t)
	_, v := getDemo(t, s.Router(), bridgedGame, "")
	if v.Available || v.URL != "" {
		t.Fatalf("answer=%+v; a non-web link was passed through", v)
	}
}

func TestDemoDownloadFaceitRefused(t *testing.T) {
	// FACEIT's Download API answers 403 until it grants the scope.
	u := &dlUpstreams{listedID: bridgedGame, source: "faceit", ref: dlFaceitID, finishedAt: hoursAgo(5),
		faceitSign: http.StatusForbidden}
	s, kv := u.server(t)
	code, v := getDemo(t, s.Router(), bridgedGame, "")
	if code != http.StatusOK || v.Available || v.Code != "faceit_scope" {
		t.Fatalf("status=%d answer=%+v; want the scope refusal", code, v)
	}
	if !strings.Contains(v.Reason, "aren't enabled") {
		t.Errorf("reason = %q", v.Reason)
	}
	// The player can still fetch it from the match room with their own account.
	if v.RoomURL != "https://www.faceit.com/en/cs2/room/"+dlFaceitID {
		t.Errorf("room_url = %q", v.RoomURL)
	}
	if got := kv.ttl[cache.LeetifyGameDemoKey(bridgedGame, 76561198019780871)]; got != demoDLSetupTTL {
		t.Errorf("cached for %v, want %v", got, demoDLSetupTTL)
	}
	if n := u.botCalls.Load(); n != 0 {
		t.Errorf("a FACEIT game reached the gc-bot (%d calls)", n)
	}
}

func TestDemoDownloadFaceitWithoutAClient(t *testing.T) {
	u := &dlUpstreams{listedID: bridgedGame, source: "faceit", ref: dlFaceitID, finishedAt: hoursAgo(5), noFaceit: true}
	s, _ := u.server(t)
	_, v := getDemo(t, s.Router(), bridgedGame, "")
	if v.Available || v.Code != "faceit_scope" {
		t.Fatalf("answer=%+v; want faceit_scope when FACEIT is not configured", v)
	}
}

func TestDemoDownloadFaceitLink(t *testing.T) {
	u := &dlUpstreams{listedID: bridgedGame, source: "faceit", ref: dlFaceitID, finishedAt: hoursAgo(90 * 24),
		faceitSign: http.StatusOK}
	s, kv := u.server(t)
	_, v := getDemo(t, s.Router(), bridgedGame, "")
	// 90 days old: Valve's month does not apply to FACEIT.
	if !v.Available || v.Source != "faceit" || !strings.HasPrefix(v.URL, "https://signed.faceit-cdn.net/") {
		t.Fatalf("answer=%+v; want FACEIT's signed link", v)
	}
	if v.Filename != dlFaceitID+"-1-1.dem.zst" || v.ExpiresAt != "" {
		t.Errorf("filename=%q expires_at=%q", v.Filename, v.ExpiresAt)
	}
	// Signed links are short-lived, so the memory of one is too.
	if got := kv.ttl[cache.LeetifyGameDemoKey(bridgedGame, 76561198019780871)]; got != demoDLFaceitTTL {
		t.Errorf("cached for %v, want %v", got, demoDLFaceitTTL)
	}
}

func TestDemoDownloadUnknownGame(t *testing.T) {
	// Not on the profile's list, and the per-game route has never heard of it.
	u := &dlUpstreams{}
	s, _ := u.server(t)
	code, v := getDemo(t, s.Router(), bridgedGame, "")
	if code != http.StatusOK || v.Available || v.Code != "unknown_game" {
		t.Fatalf("status=%d answer=%+v; want unknown_game", code, v)
	}
	if u.botCalls.Load() != 0 || u.signCalls.Load() != 0 {
		t.Error("an unknown game reached the gc-bot or FACEIT")
	}
}

func TestDemoDownloadGameWithoutAReference(t *testing.T) {
	// Listed, but with nothing a demo could be found by.
	u := &dlUpstreams{listedID: bridgedGame, source: "matchmaking", ref: "", finishedAt: hoursAgo(5)}
	s, _ := u.server(t)
	_, v := getDemo(t, s.Router(), bridgedGame, "")
	if v.Available || v.Code != "no_demo" {
		t.Fatalf("answer=%+v; want no_demo", v)
	}
}

func TestDemoDownloadLegacyRowViaGameCoordinator(t *testing.T) {
	// A legacy-format id has no Leetify reference; the row's score and day
	// pick the game out of the player's Game Coordinator list, as analysis does.
	fin := time.Now().Add(-6 * time.Hour).UTC()
	u := &dlUpstreams{recentBody: `{"matches":[
		{"matchId":"1","time":` + itoa(fin.Add(-3*time.Hour).Unix()) + `,"demoUrl":"http://replay1.valve.net/730/other.dem.bz2","scores":[13,2]},
		{"matchId":"2","time":` + itoa(fin.Unix()) + `,"demoUrl":"` + dlValveURL + `","scores":[7,13]}]}`}
	s, _ := u.server(t)
	h := s.Router()
	q := "?finishedAt=" + fin.Truncate(24*time.Hour).Format(time.RFC3339) + "&score=13-7"
	_, v := getDemo(t, h, "7c9bc801f1a8bb51-6e7cc3", q)
	if !v.Available || v.URL != dlValveURL || v.Source != "valve" {
		t.Fatalf("answer=%+v; want the 13-7 game's replay", v)
	}

	// No game with that score on the list: said plainly, no link.
	_, miss := getDemo(t, h, "e8aca8dadd63a9a3-9c3572", "?finishedAt="+fin.Format(time.RFC3339)+"&score=16-14")
	if miss.Available || miss.Code != "no_demo" {
		t.Fatalf("answer=%+v; want no_demo for a game the GC does not list", miss)
	}
}

func TestDemoDownloadRejectsBadIDs(t *testing.T) {
	u := &dlUpstreams{}
	s, _ := u.server(t)
	h := s.Router()
	if w := doGET(h, "/api/players/"+dlSteam+"/leetify-game/not_a_game/demo"); w.Code != http.StatusBadRequest {
		t.Errorf("bad game id = %d, want 400", w.Code)
	}
	if w := doGET(h, "/api/players/nobody/leetify-game/"+bridgedGame+"/demo"); w.Code != http.StatusBadRequest {
		t.Errorf("bad steam id = %d, want 400", w.Code)
	}
}

func TestDemoDownloadHasItsOwnRateLimit(t *testing.T) {
	// The general limiter is off here (RATE_LIMIT_RPS unset, as behind the
	// internal token in production); the route's own bucket still holds.
	u := &dlUpstreams{}
	s, _ := u.server(t)
	h := s.Router()
	limited := 0
	for i := 0; i < demoDLRateBurst+3; i++ {
		if w := doGET(h, "/api/players/"+dlSteam+"/leetify-game/"+bridgedGame+"/demo"); w.Code == http.StatusTooManyRequests {
			limited++
		}
	}
	if limited < 2 {
		t.Errorf("%d of %d rapid requests were limited; the route's bucket is not applied", limited, demoDLRateBurst+3)
	}
	// ...and it is this route's alone: the scoreboard next door is unaffected.
	if w := doGET(h, "/api/players/"+dlSteam+"/leetify-game/"+bridgedGame); w.Code == http.StatusTooManyRequests {
		t.Error("the demo-link bucket throttled the neighbouring scoreboard route")
	}
}

func TestParseScoreParam(t *testing.T) {
	if got := parseScoreParam("13-7"); len(got) != 2 || got[0] != 13 || got[1] != 7 {
		t.Errorf("13-7 → %v", got)
	}
	for _, bad := range []string{"", "13", "a-b", "13-", "-1-3"} {
		if got := parseScoreParam(bad); got != nil {
			t.Errorf("%q → %v, want nil", bad, got)
		}
	}
}

func itoa(n int64) string {
	b, _ := json.Marshal(n)
	return string(b)
}
