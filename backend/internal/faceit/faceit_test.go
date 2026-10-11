package faceit

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGetProfile(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Errorf("missing/biased auth header: %q", got)
		}
		switch {
		case r.URL.Path == "/players":
			if r.URL.Query().Get("game") != "cs2" ||
				r.URL.Query().Get("game_player_id") != "76561198077030352" {
				t.Errorf("bad query: %s", r.URL.RawQuery)
			}
			w.Write([]byte(`{
				"player_id":"abc-123","nickname":"Pod","country":"us",
				"avatar":"https://cdn/av.jpg","faceit_url":"https://www.faceit.com/{lang}/players/Pod",
				"activated_at":"2016-03-19T10:11:12Z",
				"games":{"cs2":{"skill_level":10,"faceit_elo":2146,"region":"NA"}}
			}`))
		case r.URL.Path == "/rankings/games/cs2/regions/NA/players/abc-123":
			// The poster's two standings: the region's, and the country's within it.
			if r.URL.Query().Get("country") == "us" {
				w.Write([]byte(`{"position":451,"items":[]}`))
			} else {
				w.Write([]byte(`{"position":"7000","items":[]}`))
			}
		case r.URL.Path == "/players/abc-123/stats/cs2":
			w.Write([]byte(`{"lifetime":{
				"Matches":"1234","Win Rate %":"55","Average K/D Ratio":"1.12",
				"Average Headshots %":"48","Average Kills":"18.5",
				"Current Win Streak":"2","Longest Win Streak":"12",
				"Recent Results":["1","0","1","1","0"]
			}}`))
		case r.URL.Path == "/players/abc-123/history":
			// GetProfile also samples recent matches, because the lifetime
			// block above carries no ADR, K/R or assists.
			w.Write([]byte(`{"items":[{"match_id":"m1"}]}`))
		case r.URL.Path == "/matches/m1/stats":
			w.Write([]byte(`{"rounds":[{"round_stats":{"Rounds":"25"},"teams":[{"players":[
				{"player_id":"abc-123","player_stats":{"Kills":"20","Deaths":"16","Assists":"5","ADR":"84.2","Headshots %":"49","Result":"1"}}
			]}]}]}`))
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer srv.Close()

	p, err := New(srv.URL, "test-key").GetProfile(context.Background(), 76561198077030352)
	if err != nil {
		t.Fatal(err)
	}
	if p.Nickname != "Pod" || p.SkillLevel != 10 || p.Elo != 2146 {
		t.Errorf("identity not parsed: %+v", p)
	}
	if strings.Contains(p.FaceitURL, "{lang}") {
		t.Errorf("faceit_url {lang} not replaced: %s", p.FaceitURL)
	}
	if p.Matches != 1234 || p.WinRatePct != 55 || p.KDRatio != 1.12 || p.HSPct != 48 {
		t.Errorf("lifetime stats not parsed: %+v", p)
	}
	if p.Recent == nil {
		t.Fatalf("recent aggregate missing: %+v", p)
	}
	if p.Recent.Matches != 1 {
		t.Errorf("Recent.Matches = %d, want 1", p.Recent.Matches)
	}
	if want := 84.2; p.Recent.ADR != want {
		t.Errorf("Recent.ADR = %v, want %v", p.Recent.ADR, want)
	}
	if want := 20.0 / 25.0; p.Recent.KR != want {
		t.Errorf("Recent.KR = %v, want %v", p.Recent.KR, want)
	}
	if p.LongestWinStreak != 12 || len(p.RecentResults) != 5 {
		t.Errorf("streak/recent not parsed: %+v", p)
	}
	if p.ActivatedAt != "2016-03-19T10:11:12Z" {
		t.Errorf("ActivatedAt = %q, want the activation timestamp", p.ActivatedAt)
	}
	if p.RegionRank != 7000 || p.CountryRank != 451 {
		t.Errorf("rankings not parsed: region %d country %d, want 7000 / 451", p.RegionRank, p.CountryRank)
	}
}

func TestGetProfileNoKey(t *testing.T) {
	if _, err := New("", "").GetProfile(context.Background(), 1); err != ErrNoAPIKey {
		t.Errorf("err = %v, want ErrNoAPIKey", err)
	}
}

func TestGetProfileNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	if _, err := New(srv.URL, "k").GetProfile(context.Background(), 1); err != ErrNotFound {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
}

func TestGetProfileBadKey(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()
	if _, err := New(srv.URL, "wrong").GetProfile(context.Background(), 1); err != ErrNoAPIKey {
		t.Errorf("err = %v, want ErrNoAPIKey (401 mapped)", err)
	}
}

// A player with no CS2 stats yet should still return identity/elo.
func TestGetProfileNoStats(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/players" {
			w.Write([]byte(`{"player_id":"x","nickname":"New","games":{"cs2":{"skill_level":3,"faceit_elo":900}}}`))
			return
		}
		w.WriteHeader(http.StatusNotFound) // no stats endpoint data
	}))
	defer srv.Close()
	p, err := New(srv.URL, "k").GetProfile(context.Background(), 1)
	if err != nil {
		t.Fatalf("identity-only profile should succeed, got %v", err)
	}
	if p.SkillLevel != 3 || p.Matches != 0 {
		t.Errorf("unexpected identity-only profile: %+v", p)
	}
}

// Match-room id → demo resource URL → signed download URL (the two-step FACEIT
// demo flow; the raw resource host has no public DNS so signing is mandatory).
func TestMatchDemoResourceAndSign(t *testing.T) {
	const matchID = "1-2e6c6720-5486-40be-9549-0b3657a8d4f7"
	const resource = "https://demos-us-east.backblaze.faceit-cdn.net/cs2/x.dem.zst"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/matches/" + matchID:
			w.Write([]byte(`{"status":"FINISHED","demo_url":["` + resource + `"]}`))
		case "/download":
			if r.Method != http.MethodPost {
				t.Errorf("download method = %s", r.Method)
			}
			var body struct {
				ResourceURL string `json:"resource_url"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body.ResourceURL != resource {
				t.Errorf("resource_url = %q", body.ResourceURL)
			}
			w.Write([]byte(`{"payload":{"download_url":"` + resource + `?sig=abc"}}`))
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	c := New(srv.URL, "k", WithDownloadURL(srv.URL+"/download"))
	res, err := c.MatchDemoResource(context.Background(), matchID)
	if err != nil {
		t.Fatalf("MatchDemoResource: %v", err)
	}
	if res != resource {
		t.Errorf("resource = %q", res)
	}
	signed, err := c.SignDemoURL(context.Background(), res)
	if err != nil {
		t.Fatalf("SignDemoURL: %v", err)
	}
	if signed != resource+"?sig=abc" {
		t.Errorf("signed = %q", signed)
	}
}

// A 403 from the Download API means the key lacks the download scope — surfaced
// as a distinct error so the API can tell users what's wrong.
func TestSignDemoURLNoScope(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"errors":[{"code":"err_f0","message":"no valid scope provided"}]}`))
	}))
	defer srv.Close()
	c := New(srv.URL, "k", WithDownloadURL(srv.URL))
	if _, err := c.SignDemoURL(context.Background(), "https://x/y.dem.zst"); !errors.Is(err, ErrNoDownloadScope) {
		t.Errorf("err = %v, want ErrNoDownloadScope", err)
	}
}

// A match without a demo (expired/not finished) returns ErrNoDemo.
func TestMatchDemoResourceNoDemo(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"status":"FINISHED","demo_url":[]}`))
	}))
	defer srv.Close()
	if _, err := New(srv.URL, "k").MatchDemoResource(context.Background(), "1-x"); !errors.Is(err, ErrNoDemo) {
		t.Errorf("err = %v, want ErrNoDemo", err)
	}
}

// Nickname -> SteamID64 via game_player_id (used by the browser extension).
func TestResolveNickname(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("nickname") != "-Keewee" {
			t.Errorf("nickname = %q", r.URL.Query().Get("nickname"))
		}
		w.Write([]byte(`{"player_id":"x","nickname":"-Keewee","games":{"cs2":{"skill_level":10,"faceit_elo":2542,"game_player_id":"76561198294661712"}}}`))
	}))
	defer srv.Close()
	id, err := New(srv.URL, "k").ResolveNickname(context.Background(), "-Keewee")
	if err != nil {
		t.Fatal(err)
	}
	if id != 76561198294661712 {
		t.Errorf("steam64 = %d", id)
	}
}

func TestResolveNicknameNoCS2(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"player_id":"x","nickname":"n","games":{}}`))
	}))
	defer srv.Close()
	if _, err := New(srv.URL, "k").ResolveNickname(context.Background(), "n"); !errors.Is(err, ErrNotFound) {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
}

// GET /players/{player_id} is how a leaderboard row (a FACEIT id and a nick)
// becomes a CSRun profile link and a face. The SteamID64 comes from the CS2
// game entry first, then the top-level steam_id_64; neither is required.
func TestPlayerByID(t *testing.T) {
	var seen string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = r.URL.Path
		w.Write([]byte(`{"player_id":"e5e8e2a6-1","nickname":"donk666","country":"RU","avatar":"https://cdn.faceit.com/a.png",
			"games":{"cs2":{"skill_level":10,"faceit_elo":5053,"game_player_id":"76561198294661712"}}}`))
	}))
	defer srv.Close()
	id, err := New(srv.URL, "k").PlayerByID(context.Background(), "e5e8e2a6-1")
	if err != nil {
		t.Fatal(err)
	}
	if seen != "/players/e5e8e2a6-1" {
		t.Errorf("path = %q, want /players/{id}", seen)
	}
	if id.SteamID64 != 76561198294661712 || id.Avatar != "https://cdn.faceit.com/a.png" ||
		id.Country != "ru" || id.Nickname != "donk666" || id.PlayerID != "e5e8e2a6-1" {
		t.Errorf("identity = %+v", id)
	}
}

func TestPlayerByIDTopLevelSteamIDFallback(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"player_id":"p","nickname":"n","steam_id_64":"76561198000000001","games":{}}`))
	}))
	defer srv.Close()
	id, err := New(srv.URL, "k").PlayerByID(context.Background(), "p")
	if err != nil {
		t.Fatal(err)
	}
	if id.SteamID64 != 76561198000000001 {
		t.Errorf("steam64 = %d, want the top-level steam_id_64", id.SteamID64)
	}
}

// No CS2 account is not an error: the avatar is still useful, and the row is
// still a real leaderboard entry.
func TestPlayerByIDNoSteamIsNotAnError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"player_id":"p","nickname":"n","avatar":"https://cdn.faceit.com/b.png","games":{}}`))
	}))
	defer srv.Close()
	id, err := New(srv.URL, "k").PlayerByID(context.Background(), "p")
	if err != nil {
		t.Fatal(err)
	}
	if id.SteamID64 != 0 || id.Avatar == "" {
		t.Errorf("identity = %+v, want steam 0 and the avatar", id)
	}
}

// Ids are FACEIT UUIDs today, but the path is escaped regardless so a
// surprising id cannot steer the request.
func TestPlayerByIDEscapesPath(t *testing.T) {
	var seen string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = r.URL.EscapedPath()
		w.Write([]byte(`{"player_id":"a/b","nickname":"n","games":{}}`))
	}))
	defer srv.Close()
	if _, err := New(srv.URL, "k").PlayerByID(context.Background(), "a/b?x"); err != nil {
		t.Fatal(err)
	}
	if seen != "/players/a%2Fb%3Fx" {
		t.Errorf("path = %q, want the id escaped as one segment", seen)
	}
}

func TestPlayerByIDNotFoundAndNoKey(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	if _, err := New(srv.URL, "k").PlayerByID(context.Background(), "nope"); !errors.Is(err, ErrNotFound) {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
	if _, err := New(srv.URL, "").PlayerByID(context.Background(), "p"); !errors.Is(err, ErrNoAPIKey) {
		t.Errorf("no key: err = %v, want ErrNoAPIKey", err)
	}
}

// RegionCode is the handler's gate: a bad region is refused before any cache
// or network work, and the value that reaches the URL is always the table's.
func TestRegionCode(t *testing.T) {
	for in, want := range map[string]string{"": "EU", "eu": "EU", " na ": "NA", "OCE": "OCE", "sa": "SA", "as": "AS"} {
		if got, ok := RegionCode(in); !ok || got != want {
			t.Errorf("RegionCode(%q) = %q, %v; want %q, true", in, got, ok, want)
		}
	}
	if _, ok := RegionCode("XX"); ok {
		t.Error("RegionCode(XX) accepted an unknown region")
	}
}
