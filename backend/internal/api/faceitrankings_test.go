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

	"github.com/cs2tracker/server/internal/config"
	"github.com/cs2tracker/server/internal/faceit"
	"github.com/cs2tracker/server/internal/steam"
)

// A fake FACEIT: the rankings page from rankings_test.go plus a /players/{id}
// identity for two of the three, so the handler's enrichment has something to
// find and something to leave alone. playersStatus lets a test break the
// identity route on its own.
func fakeFaceit(t *testing.T, rankingsStatus, playersStatus int, calls *int32) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(calls, 1)
		w.Header().Set("content-type", "application/json")
		switch {
		case strings.HasPrefix(r.URL.Path, "/rankings/games/cs2/regions/"):
			if rankingsStatus != http.StatusOK {
				w.WriteHeader(rankingsStatus)
				return
			}
			_, _ = w.Write([]byte(`{"start":0,"end":3,"items":[
				{"player_id":"p1","nickname":"donk","country":"ru","position":1,"faceit_elo":4212,"game_skill_level":10},
				{"player_id":"p2","nickname":"m0NESY","country":"ru","position":2,"faceit_elo":3980,"game_skill_level":10},
				{"player_id":"p3","nickname":"ropz","country":"ee","position":3,"faceit_elo":3801,"game_skill_level":10}
			]}`))
		case strings.HasPrefix(r.URL.Path, "/players/"):
			if playersStatus != http.StatusOK {
				w.WriteHeader(playersStatus)
				return
			}
			switch strings.TrimPrefix(r.URL.Path, "/players/") {
			case "p1":
				_, _ = w.Write([]byte(`{"player_id":"p1","nickname":"donk","avatar":"https://cdn.faceit.com/donk.png","games":{"cs2":{"game_player_id":"76561198386265483"}}}`))
			case "p2":
				_, _ = w.Write([]byte(`{"player_id":"p2","nickname":"m0NESY","avatar":"https://cdn.faceit.com/monesy.png","games":{}}`))
			default:
				w.WriteHeader(http.StatusNotFound)
			}
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

// The server is built with a nil Leetify client on purpose: this route, and
// through it the homepage, must not be able to reach Leetify at all.
func rankingsServer(faceitURL, key string) *Server {
	cfg := &config.Config{CORSOrigins: []string{"*"}}
	return NewServer(cfg, &fakeStore{}, steam.New(""), nil, faceit.New(faceitURL, key), nil, nil,
		slog.New(slog.NewTextHandler(io.Discard, nil)))
}

type rankingsBody struct {
	Enabled   bool                  `json:"enabled"`
	Region    string                `json:"region"`
	Players   []faceit.RankedPlayer `json:"players"`
	FetchedAt string                `json:"fetchedAt"`
	Stale     bool                  `json:"stale"`
	Error     string                `json:"error"`
}

func getRankings(t *testing.T, s *Server, path string) (*httptest.ResponseRecorder, rankingsBody) {
	t.Helper()
	rr := httptest.NewRecorder()
	s.Router().ServeHTTP(rr, httptest.NewRequest("GET", path, nil))
	var b rankingsBody
	_ = json.Unmarshal(rr.Body.Bytes(), &b)
	return rr, b
}

func TestFaceitRankingsShape(t *testing.T) {
	var calls int32
	up := fakeFaceit(t, http.StatusOK, http.StatusOK, &calls)
	s := rankingsServer(up.URL, "k")

	rr, b := getRankings(t, s, "/api/faceit/rankings?region=eu&limit=10")
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body %s", rr.Code, rr.Body.String())
	}
	if !b.Enabled || b.Region != "EU" || b.Stale || b.FetchedAt == "" {
		t.Errorf("envelope = %+v", b)
	}
	if len(b.Players) != 3 {
		t.Fatalf("players = %d, want the three legible rows", len(b.Players))
	}
	// Enriched where FACEIT knows a Steam account, left alone where it does
	// not, and a 404 identity never drops the row.
	if b.Players[0].SteamID64 != "76561198386265483" || b.Players[0].Avatar != "https://cdn.faceit.com/donk.png" {
		t.Errorf("row 1 not enriched: %+v", b.Players[0])
	}
	if b.Players[1].SteamID64 != "" || b.Players[1].Avatar != "https://cdn.faceit.com/monesy.png" {
		t.Errorf("row 2: want avatar without a steam id: %+v", b.Players[1])
	}
	if b.Players[2].Nickname != "ropz" || b.Players[2].SteamID64 != "" || b.Players[2].Avatar != "" {
		t.Errorf("row 3 (identity 404) must survive un-enriched: %+v", b.Players[2])
	}
	if cc := rr.Header().Get("Cache-Control"); !strings.Contains(cc, "s-maxage=300") {
		t.Errorf("Cache-Control = %q, want a five-minute edge life", cc)
	}
	if n := atomic.LoadInt32(&calls); n != 4 {
		t.Errorf("upstream calls = %d, want 1 rankings + 3 identities", n)
	}

	// limit slices the same snapshot; above the page it clamps to the page.
	if _, b2 := getRankings(t, s, "/api/faceit/rankings?region=EU&limit=2"); len(b2.Players) != 2 {
		t.Errorf("limit=2 gave %d rows", len(b2.Players))
	}
	if rr3, b3 := getRankings(t, s, "/api/faceit/rankings?limit=50"); rr3.Code != http.StatusOK || len(b3.Players) != 3 {
		t.Errorf("limit=50: status %d rows %d, want 200 and the clamped page", rr3.Code, len(b3.Players))
	}
}

func TestFaceitRankingsBadRegion(t *testing.T) {
	var calls int32
	up := fakeFaceit(t, http.StatusOK, http.StatusOK, &calls)
	rr, b := getRankings(t, rankingsServer(up.URL, "k"), "/api/faceit/rankings?region=XX")
	if rr.Code != http.StatusBadRequest || b.Error == "" {
		t.Errorf("status = %d body %s, want 400 with a reason", rr.Code, rr.Body.String())
	}
	if atomic.LoadInt32(&calls) != 0 {
		t.Error("a bad region reached FACEIT")
	}
}

func TestFaceitRankingsUpstreamDownIs503NoStore(t *testing.T) {
	var calls int32
	up := fakeFaceit(t, http.StatusInternalServerError, http.StatusOK, &calls)
	rr, b := getRankings(t, rankingsServer(up.URL, "k"), "/api/faceit/rankings?region=NA")
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d body %s, want 503", rr.Code, rr.Body.String())
	}
	if b.Error == "" {
		t.Error("want a reason in the body")
	}
	if cc := rr.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store so the gap is never cached", cc)
	}
	if ra := rr.Header().Get("Retry-After"); ra != "300" {
		t.Errorf("Retry-After = %q, want 300", ra)
	}
}

func TestFaceitRankingsNoKey(t *testing.T) {
	var calls int32
	up := fakeFaceit(t, http.StatusOK, http.StatusOK, &calls)
	rr, b := getRankings(t, rankingsServer(up.URL, ""), "/api/faceit/rankings")
	if rr.Code != http.StatusOK || b.Enabled || len(b.Players) != 0 || b.Region != "EU" {
		t.Errorf("status = %d body %s, want 200 enabled:false with an empty list", rr.Code, rr.Body.String())
	}
	if atomic.LoadInt32(&calls) != 0 {
		t.Error("a keyless server asked FACEIT anyway")
	}
}

// The identity route failing (a 500, a rate limit) is not the leaderboard
// failing: the rows are served exactly as FACEIT's ranking gave them.
func TestFaceitRankingsIdentityFailureKeepsRows(t *testing.T) {
	var calls int32
	up := fakeFaceit(t, http.StatusOK, http.StatusInternalServerError, &calls)
	rr, b := getRankings(t, rankingsServer(up.URL, "k"), "/api/faceit/rankings?region=EU")
	if rr.Code != http.StatusOK || len(b.Players) != 3 {
		t.Fatalf("status = %d rows %d body %s, want 200 with all three rows", rr.Code, len(b.Players), rr.Body.String())
	}
	for _, p := range b.Players {
		if p.SteamID64 != "" || p.Avatar != "" {
			t.Errorf("row enriched from a failing route: %+v", p)
		}
	}
}
