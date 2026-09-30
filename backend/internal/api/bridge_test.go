package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cs2tracker/server/internal/config"
	"github.com/cs2tracker/server/internal/db"
	"github.com/cs2tracker/server/internal/leetify"
	"github.com/cs2tracker/server/internal/steam"
)

// With the flag off there must be no bridge at all — and the endpoint must say
// so plainly rather than erroring, because "disabled" and "this player has
// nothing" are the same thing to a caller.
func TestBridgeDisabledAnswersCleanly(t *testing.T) {
	cfg := &config.Config{CORSOrigins: []string{"*"}} // BridgeEnabled defaults false
	s := NewServer(cfg, &fakeStore{}, steam.New(""), nil, nil, nil, nil,
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	if s.bridge != nil {
		t.Fatal("bridge built despite the flag being off")
	}

	rr := httptest.NewRecorder()
	s.Router().ServeHTTP(rr, httptest.NewRequest("GET", "/api/players/76561198000000001/bridge", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["enabled"] != false {
		t.Errorf("body = %v, want enabled:false", body)
	}
}

func TestBridgeRejectsBadSteamID(t *testing.T) {
	cfg := &config.Config{CORSOrigins: []string{"*"}}
	s := NewServer(cfg, &fakeStore{}, steam.New(""), nil, nil, nil, nil,
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	rr := httptest.NewRecorder()
	s.Router().ServeHTTP(rr, httptest.NewRequest("GET", "/api/players/nonsense/bridge", nil))
	// Disabled short-circuits before parsing, so this asserts only that the
	// route exists and does not 404.
	if rr.Code == http.StatusNotFound {
		t.Error("bridge route not registered")
	}
}

func TestNullableTime(t *testing.T) {
	if got := nullableTime(time.Time{}); got != nil {
		t.Errorf("zero time = %v, want nil", got)
	}
	// COALESCE in the store turns a NULL finished_at into the epoch; that is
	// "unknown", not a match played in 1970.
	if got := nullableTime(time.Unix(0, 0)); got != nil {
		t.Errorf("epoch = %v, want nil", got)
	}
	if got := nullableTime(time.Date(2026, 7, 7, 8, 32, 16, 0, time.UTC)); got != "2026-07-07T08:32:16Z" {
		t.Errorf("real time = %v", got)
	}
}

// When Leetify has no profile but the bridge holds matches, the Friends panel
// must still get an answer — from our own rows, in the same shape, so the
// panel cannot tell which path fed it.
func TestTeammatesFallBackToCorpus(t *testing.T) {
	leetify404 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer leetify404.Close()

	store := &fakeStore{corpusMates: []db.CorpusTeammate{
		{SteamID: 76561198000000002, Name: "mate", Together: 5, TogetherWins: 3,
			RatingAvg: 0.031, KDAvg: 1.12, TotalMatches: 9},
	}}
	cfg := &config.Config{CORSOrigins: []string{"*"}, BridgeEnabled: true}
	s := NewServer(cfg, store, steam.New(""),
		leetify.New(leetify404.URL, "", leetify.WithLegacyURL(leetify404.URL)),
		nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))

	rr := httptest.NewRecorder()
	s.Router().ServeHTTP(rr, httptest.NewRequest("GET", "/api/players/76561197995150836/teammates", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d", rr.Code)
	}
	var body struct {
		Teammates []map[string]any `json:"teammates"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Teammates) != 1 {
		t.Fatalf("teammates = %v", body.Teammates)
	}
	m := body.Teammates[0]
	if m["name"] != "mate" || m["matches_together"] != float64(5) {
		t.Errorf("row = %v", m)
	}
	// Winrate is the 0..1 fraction the panel already reads.
	if w := m["winrate"].(float64); w < 0.59 || w > 0.61 {
		t.Errorf("winrate = %v, want 0.6", w)
	}
	// Per-match rating average lands on the ranks scale, like everywhere else.
	if r := m["rating"].(float64); r < 3.0 || r > 3.2 {
		t.Errorf("rating = %v, want 3.1", r)
	}
}

// With the bridge off, the miss answers empty exactly as before — the corpus
// must not leak into a deployment that has not opted in.
func TestTeammatesMissWithoutBridgeStaysEmpty(t *testing.T) {
	leetify404 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer leetify404.Close()
	store := &fakeStore{corpusMates: []db.CorpusTeammate{{SteamID: 2, Name: "x", Together: 4}}}
	cfg := &config.Config{CORSOrigins: []string{"*"}} // bridge off
	s := NewServer(cfg, store, steam.New(""),
		leetify.New(leetify404.URL, "", leetify.WithLegacyURL(leetify404.URL)),
		nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))

	rr := httptest.NewRecorder()
	s.Router().ServeHTTP(rr, httptest.NewRequest("GET", "/api/players/1/teammates", nil))
	var body struct {
		Teammates []any `json:"teammates"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &body)
	if len(body.Teammates) != 0 {
		t.Errorf("bridge off should answer empty, got %v", body.Teammates)
	}
}

// A non-member now gets a profile from Leetify's app routes — stats, no
// teammate list. For the Friends panel that must count as no profile, so the
// corpus still answers exactly as it did when the miss was a plain 404.
func TestTeammatesAppProfileStillUsesCorpus(t *testing.T) {
	appLeetify := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/profile/76561197995150836/recent-games/available-data-sources":
			_, _ = w.Write([]byte(`{"dataSources":{"5v5":30}}`))
		case "/api/profile/76561197995150836/recent-games/5v5":
			_, _ = w.Write([]byte(`{"aimRating":80.5,"matchesPlayed":30,"kdRatio":1.1,"winRate":0.5}`))
		case "/api/profile/76561197995150836/meta":
			_, _ = w.Write([]byte(`{"steam64Id":"76561197995150836","name":"non-member"}`))
		default: // /v3/profile and anything else
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer appLeetify.Close()

	store := &fakeStore{corpusMates: []db.CorpusTeammate{
		{SteamID: 76561198000000002, Name: "mate", Together: 5, TogetherWins: 3, TotalMatches: 9},
	}}
	cfg := &config.Config{CORSOrigins: []string{"*"}, BridgeEnabled: true}
	s := NewServer(cfg, store, steam.New(""),
		leetify.New(appLeetify.URL, "", leetify.WithLegacyURL(appLeetify.URL)),
		nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))

	// The profile itself resolves through the app routes…
	rr := httptest.NewRecorder()
	s.Router().ServeHTTP(rr, httptest.NewRequest("GET", "/api/players/76561197995150836/leetify", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("leetify profile status = %d body %s", rr.Code, rr.Body.String())
	}
	var prof struct {
		Source string  `json:"source"`
		Aim    float64 `json:"-"`
		Rating struct {
			Aim float64 `json:"aim"`
		} `json:"rating"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &prof)
	if prof.Source != "app:5v5" || prof.Rating.Aim != 80.5 {
		t.Errorf("profile = %s", rr.Body.String())
	}

	// …and the teammates still come from the corpus.
	rr = httptest.NewRecorder()
	s.Router().ServeHTTP(rr, httptest.NewRequest("GET", "/api/players/76561197995150836/teammates", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("teammates status = %d", rr.Code)
	}
	var body struct {
		Teammates []map[string]any `json:"teammates"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &body)
	if len(body.Teammates) != 1 || body.Teammates[0]["name"] != "mate" {
		t.Errorf("teammates = %v, want the corpus row", body.Teammates)
	}
}

// While Leetify's public API is rate-limiting this address, the profile
// route says so — a 503 with a reason and no caching — instead of the
// "internal error" 500 that hid the outage for a day (827 of them in 24 h
// on 2026-09-30). A real 404 from Leetify is still a 404.
func TestLeetifyPausedAnswers503NotInternalError(t *testing.T) {
	var upstreamCalls int32
	limited := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&upstreamCalls, 1)
		if r.URL.Path == "/v3/profile" {
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":"Calm down son"}`))
			return
		}
		w.WriteHeader(http.StatusNotFound) // an app route — must not be asked while paused
	}))
	defer limited.Close()

	cfg := &config.Config{CORSOrigins: []string{"*"}}
	s := NewServer(cfg, &fakeStore{}, steam.New(""),
		leetify.New(limited.URL, "", leetify.WithLegacyURL(limited.URL)),
		nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))

	for i := 0; i < 2; i++ {
		rr := httptest.NewRecorder()
		s.Router().ServeHTTP(rr, httptest.NewRequest("GET", "/api/players/76561198200413817/leetify", nil))
		if rr.Code != http.StatusServiceUnavailable {
			t.Fatalf("view %d: status = %d body %s, want 503", i, rr.Code, rr.Body.String())
		}
		if !strings.Contains(rr.Body.String(), "rate-limiting") {
			t.Errorf("view %d: body = %s, want the reason", i, rr.Body.String())
		}
		if cc := rr.Header().Get("Cache-Control"); cc != "no-store" {
			t.Errorf("view %d: Cache-Control = %q, want no-store", i, cc)
		}
		if ra := rr.Header().Get("Retry-After"); ra != "60" {
			t.Errorf("view %d: Retry-After = %q, want 60", i, ra)
		}
	}
	// One /v3 attempt and nothing else: the app routes are not asked while
	// paused (for a member they would answer with a non-member summary), and
	// the second view asked nothing at all — the pause answered it.
	if n := atomic.LoadInt32(&upstreamCalls); n != 1 {
		t.Errorf("two paused views cost %d upstream requests, want the one /v3 attempt", n)
	}
	first := atomic.LoadInt32(&upstreamCalls)
	rr := httptest.NewRecorder()
	s.Router().ServeHTTP(rr, httptest.NewRequest("GET", "/api/players/76561198200413817/leetify", nil))
	if got := atomic.LoadInt32(&upstreamCalls); got != first {
		t.Errorf("a paused view still cost %d upstream requests", got-first)
	}

	// A genuine 404, not paused: still a 404.
	missing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer missing.Close()
	s = NewServer(cfg, &fakeStore{}, steam.New(""),
		leetify.New(missing.URL, "", leetify.WithLegacyURL(missing.URL)),
		nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	rr = httptest.NewRecorder()
	s.Router().ServeHTTP(rr, httptest.NewRequest("GET", "/api/players/76561198200413817/leetify", nil))
	if rr.Code != http.StatusNotFound {
		t.Errorf("404 upstream: status = %d, want 404", rr.Code)
	}
}

// A profile view during the pause must not schedule a bridge sync: it would
// fetch nothing. Without a cache shouldSync says yes to every thin profile;
// paused, it says no. What this cannot assert — Server.cache is the concrete
// Redis client, with no double to stand in for it — is that the tried key
// stays unwritten; that rests on the paused gate being the first thing in
// shouldSync, before the cache is touched (bridge.go).
func TestBridgeSkipsSyncWhilePaused(t *testing.T) {
	limited := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":"Calm down son"}`))
	}))
	defer limited.Close()
	lc := leetify.New(limited.URL, "", leetify.WithLegacyURL(limited.URL), leetify.WithAppFallback(false))
	cfg := &config.Config{CORSOrigins: []string{"*"}, BridgeEnabled: true}
	s := NewServer(cfg, &fakeStore{}, steam.New(""), lc,
		nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))

	ctx := context.Background()
	if !s.shouldSync(ctx, 76561198200413817, 0) {
		t.Fatal("a thin profile with nothing tried must sync when Leetify answers")
	}
	// Trip the pause the way production does: one 429 on a profile lookup.
	if _, err := lc.GetProfile(ctx, 76561198200413817); !errors.Is(err, leetify.ErrUnavailable) {
		t.Fatalf("GetProfile: err = %v", err)
	}
	if !lc.Paused() {
		t.Fatal("client should be paused")
	}
	if s.shouldSync(ctx, 76561198200413817, 0) {
		t.Error("shouldSync said yes while Leetify is paused")
	}
}

// Every copy the profile route serves carries fetched_at — the age the page
// shows once the copy is old — and it is a real time, never Go's zero time.
// The three writers of the cache key (this route, the teammates route and
// its per-friend rows) all stamp through fetchLeetifyProfile.
func TestLeetifyProfileCarriesFetchedAt(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v3/profile" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_, _ = w.Write([]byte(`{"name":"dane","steam64_id":"76561198200413817","total_matches":3,"privacy_mode":"public","recent_matches":[]}`))
	}))
	defer srv.Close()
	cfg := &config.Config{CORSOrigins: []string{"*"}}
	s := NewServer(cfg, &fakeStore{}, steam.New(""),
		leetify.New(srv.URL, "", leetify.WithLegacyURL(srv.URL)),
		nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))

	before := time.Now().Add(-time.Minute)
	rr := httptest.NewRecorder()
	s.Router().ServeHTTP(rr, httptest.NewRequest("GET", "/api/players/76561198200413817/leetify", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body %s", rr.Code, rr.Body.String())
	}
	var body struct {
		FetchedAt *time.Time `json:"fetched_at"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.FetchedAt == nil {
		t.Fatalf("fetched_at missing from %s", rr.Body.String())
	}
	if body.FetchedAt.Before(before) || body.FetchedAt.After(time.Now().Add(time.Minute)) {
		t.Errorf("fetched_at = %v, want about now", body.FetchedAt)
	}

	// The stamp is the API layer's, the same on every writer: the client
	// hands back an unstamped profile, and unstamped serialises as absent —
	// not as the year 1, which the page would have shown as an age.
	p, err := s.fetchLeetifyProfile(context.Background(), 76561198200413817)
	if err != nil || p.FetchedAt == nil {
		t.Fatalf("fetchLeetifyProfile: p = %+v, err = %v", p, err)
	}
	raw, _ := json.Marshal(&leetify.Profile{Name: "unstamped"})
	if strings.Contains(string(raw), "fetched_at") {
		t.Errorf("an unstamped profile serialised a stamp: %s", raw)
	}
}
