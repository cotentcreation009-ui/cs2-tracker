package api

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"github.com/cs2tracker/server/internal/config"
	"github.com/cs2tracker/server/internal/steam"
	"github.com/cs2tracker/server/internal/steaminv"
)

const invPath = "/api/players/76561198000000001/inventory"

type deadTransport struct{}

func (deadTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("steam unreachable")
}

// routerNoSteam builds a router whose inventory fetches can never reach Steam,
// standing in for the throttled/blocked case.
func routerNoSteam(store Store) http.Handler {
	cfg := &config.Config{CORSOrigins: []string{"*"}}
	s := NewServer(cfg, store, steam.New(""), nil, nil, nil, nil,
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	s.invHTTP = &http.Client{Transport: deadTransport{}}
	return s.Router()
}

func decodeInv(t *testing.T, body []byte) steaminv.View {
	t.Helper()
	var v steaminv.View
	if err := json.Unmarshal(body, &v); err != nil {
		t.Fatalf("decode: %v (%s)", err, body)
	}
	return v
}

// A recent snapshot must answer on its own — spending Steam's per-IP budget on
// an inventory we read an hour ago is what gets the site blocked.
func TestInventoryServesRecentSnapshot(t *testing.T) {
	stored, _ := json.Marshal(steaminv.View{TotalValue: 1234.5, ItemCount: 42})
	fetchedAt := time.Now().Add(-time.Hour)
	r := routerWith(&fakeStore{invSnapshot: stored, invFetchedAt: fetchedAt})

	w := doGET(r, invPath)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", w.Code)
	}
	v := decodeInv(t, w.Body.Bytes())
	if v.TotalValue != 1234.5 || v.ItemCount != 42 {
		t.Errorf("snapshot not served: %+v", v)
	}
	if v.Stale {
		t.Error("a snapshot inside the refresh window is current, not stale")
	}
	if got, want := v.FetchedAt, fetchedAt.UTC().Format(time.RFC3339); got != want {
		t.Errorf("fetched_at = %q, want the snapshot's own time %q", got, want)
	}
}

// When the snapshot is old enough to refresh but Steam won't answer, the old
// copy still beats an error page — flagged stale so the UI can say so.
func TestInventoryFallsBackToStaleSnapshot(t *testing.T) {
	stored, _ := json.Marshal(steaminv.View{TotalValue: 99, ItemCount: 7})
	fetchedAt := time.Now().Add(-2 * 24 * time.Hour)
	r := routerNoSteam(&fakeStore{invSnapshot: stored, invFetchedAt: fetchedAt})

	w := doGET(r, invPath)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", w.Code)
	}
	v := decodeInv(t, w.Body.Bytes())
	if v.TotalValue != 99 {
		t.Errorf("stale snapshot not served: %+v", v)
	}
	if !v.Stale {
		t.Error("want stale=true so the UI can label the age")
	}
}

// Past the stale cap we show nothing rather than keep mirroring a copy the
// player may have stopped sharing — a long Steam block must not turn our
// stored snapshot into an indefinite republication.
func TestInventoryStopsServingAncientSnapshot(t *testing.T) {
	stored, _ := json.Marshal(steaminv.View{TotalValue: 99, ItemCount: 7})
	r := routerNoSteam(&fakeStore{
		invSnapshot:  stored,
		invFetchedAt: time.Now().Add(-maxStaleAge - time.Hour),
	})

	v := decodeInv(t, doGET(r, invPath).Body.Bytes())
	if !v.Unavailable {
		t.Errorf("want unavailable past the stale cap, got %+v", v)
	}
	if v.ItemCount != 0 {
		t.Errorf("stale-capped snapshot still leaked items: %+v", v)
	}
}

// A player we have never read, while Steam is refusing, gets an honest
// "come back later" rather than a 500.
func TestInventoryUnavailableWithoutSnapshot(t *testing.T) {
	r := routerNoSteam(&fakeStore{})

	w := doGET(r, invPath)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200 with a reason", w.Code)
	}
	v := decodeInv(t, w.Body.Bytes())
	if !v.Unavailable {
		t.Errorf("want unavailable=true, got %+v", v)
	}
	if v.RetryAfterSec <= 0 {
		t.Errorf("retry_after_sec = %d, want a positive hint", v.RetryAfterSec)
	}
}
