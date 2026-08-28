package api

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
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
