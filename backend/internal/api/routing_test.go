package api

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/cs2tracker/server/internal/config"
	"github.com/cs2tracker/server/internal/steam"
)

// testRouter builds the real router with nil datastores. Handlers that touch the
// (nil) DB will panic and be converted to 500 by the Recoverer middleware — that
// is fine here: this test only asserts that requests are ROUTED (not 404), which
// catches chi trailing-slash mistakes in the route tree.
func testRouter() http.Handler {
	cfg := &config.Config{CORSOrigins: []string{"*"}}
	s := NewServer(cfg, nil, steam.New(""), nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	return s.Router()
}

func TestRoutesAreMatched(t *testing.T) {
	r := testRouter()
	cases := []struct{ method, path string }{
		{"GET", "/api/health"},
		{"GET", "/api/resolve?q=76561198000000001"},
		{"GET", "/api/leaderboard"},
		{"GET", "/api/players/76561198000000001"}, // no trailing slash — the chi gotcha
		{"GET", "/api/players/76561198000000001/matches"},
		{"GET", "/api/players/76561198000000001/weapons"},
		{"GET", "/api/players/76561198000000001/maps"},
		{"GET", "/api/players/76561198000000001/steam-stats"},
		{"GET", "/api/matches/5"},
		{"GET", "/api/matches/5/kills"},
		{"GET", "/api/queue"},
	}
	for _, c := range cases {
		req := httptest.NewRequest(c.method, c.path, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code == http.StatusNotFound {
			t.Errorf("%s %s => 404: route not matched", c.method, c.path)
		}
	}
}

func TestHealthOK(t *testing.T) {
	r := testRouter()
	req := httptest.NewRequest("GET", "/api/health", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("health => %d, want 200", w.Code)
	}
}
