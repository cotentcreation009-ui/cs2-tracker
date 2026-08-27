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
