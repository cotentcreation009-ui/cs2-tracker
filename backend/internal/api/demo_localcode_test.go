package api

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/cs2tracker/server/internal/config"
	"github.com/cs2tracker/server/internal/leetify"
	"github.com/cs2tracker/server/internal/queue"
	"github.com/cs2tracker/server/internal/steam"
)

// One-click analysis must resolve a bridged match from OUR store before asking
// Leetify. Leetify's legacy endpoint only sometimes exposes a share code, and
// a match we fetched BY its share code used to come back "no demo reference
// available" — the reference was in our own table the whole time.
//
// The Leetify client here answers 404 to everything, so if the handler ever
// consulted it first these tests would see "match not found" instead of the
// outcomes the local branch produces. The queue is a lazily-connected client
// to a port nothing listens on: it satisfies the nil guard and is never used,
// because both cases decide before enqueueing.
func localCodeServer(t *testing.T, gcBotURL, code string, finished time.Time) *Server {
	t.Helper()
	ls := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(ls.Close)
	q, err := queue.Connect("redis://127.0.0.1:1/0", "test")
	if err != nil {
		t.Fatal(err)
	}
	store := &fakeStore{localCode: code, localFinished: finished}
	cfg := &config.Config{CORSOrigins: []string{"*"}, GCBotURL: gcBotURL}
	return NewServer(cfg, store, steam.New(""),
		leetify.New(ls.URL, "", leetify.WithLegacyURL(ls.URL)),
		nil, q, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

const bridgedGame = "f48722af-94ef-4c7c-b3d0-7954cba6c304"

func analyze(t *testing.T, s *Server) *httptest.ResponseRecorder {
	t.Helper()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/demos/analyze-match",
		strings.NewReader(`{"gameId":"`+bridgedGame+`"}`))
	req.Header.Set("Content-Type", "application/json")
	s.handleDemoAnalyzeMatch(rr, req)
	return rr
}

func TestAnalyzeUsesOurShareCodeBeforeLeetify(t *testing.T) {
	// A locally-known code for a match past Valve's replay window must answer
	// "expired" — a verdict only the local branch can reach, since Leetify
	// would have said "match not found".
	s := localCodeServer(t, "http://gc-bot:7300",
		"CSGO-X5EDM-CJCpX-dTvfS-kMP7u-EhMMB", time.Now().Add(-45*24*time.Hour))
	rr := analyze(t, s)
	if rr.Code != http.StatusGone {
		t.Fatalf("status = %d body=%s; want 410 from the local branch", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "expired") {
		t.Errorf("body = %s, want the expiry message", rr.Body.String())
	}
}

func TestAnalyzeLocalCodeStillNeedsTheBot(t *testing.T) {
	// Same local code, fresh match, but no gc-bot configured: the local branch
	// must report that plainly rather than falling through to a Leetify lookup
	// that cannot help.
	s := localCodeServer(t, "",
		"CSGO-X5EDM-CJCpX-dTvfS-kMP7u-EhMMB", time.Now().Add(-2*24*time.Hour))
	rr := analyze(t, s)
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d body=%s; want 503", rr.Code, rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), "not found") {
		t.Errorf("Leetify was consulted before our own store: %s", rr.Body.String())
	}
}

func TestAnalyzeWithoutLocalCodeFallsBackToLeetify(t *testing.T) {
	// No local reference: the old path runs, and with Leetify answering 404
	// that surfaces as "match not found" — proving the fallback is intact.
	s := localCodeServer(t, "http://gc-bot:7300", "", time.Time{})
	rr := analyze(t, s)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d body=%s; want 404 via the Leetify fallback", rr.Code, rr.Body.String())
	}
}
