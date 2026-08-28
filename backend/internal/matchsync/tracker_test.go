package matchsync

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"golang.org/x/time/rate"
)

const trackerBody = `{"data":{"matches":[
 {"metadata":{"shareCode":"CSGO-X5EDM-CJCpX-dTvfS-kMP7u-EhMMB","timestamp":"2026-07-07T09:06:43+00:00"}},
 {"metadata":{"shareCode":"CSGO-OLBnc-niHAz-ER5uT-oUpH6-wyTaK","timestamp":"2026-04-05T07:27:15+00:00"}},
 {"metadata":{"timestamp":"2025-09-06T06:31:59+00:00"}}
]}}`

func unlimited(t *testing.T) {
	t.Helper()
	prev := trackerLimiter
	trackerLimiter = rate.NewLimiter(rate.Inf, 1)
	t.Cleanup(func() { trackerLimiter = prev })
}

func TestTrackerShareCodes(t *testing.T) {
	unlimited(t)
	var gotPath, gotUA string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotUA = r.URL.Path, r.Header.Get("User-Agent")
		w.Write([]byte(trackerBody))
	}))
	defer srv.Close()

	got, err := TrackerSource{BaseURL: srv.URL}.ShareCodes(context.Background(), 76561197995150836)
	if err != nil {
		t.Fatal(err)
	}
	if gotPath != "/v2/cs2/standard/matches/steam/76561197995150836" {
		t.Errorf("path = %s", gotPath)
	}
	// Attributable: an undocumented endpoint used without an agreement should at
	// least let the operator find us.
	if gotUA == "" || gotUA == "Go-http-client/1.1" {
		t.Errorf("user agent = %q, want an identifying one", gotUA)
	}
	// The third match carries no share code — it is skipped, not emitted empty.
	if len(got) != 2 {
		t.Fatalf("codes = %v, want the 2 that carry one", got)
	}
	if got[0] != "CSGO-X5EDM-CJCpX-dTvfS-kMP7u-EhMMB" {
		t.Errorf("first = %s", got[0])
	}
}

func TestTrackerAbsenceIsNotFailure(t *testing.T) {
	unlimited(t)
	// A player tracker has never seen is a normal answer, not an error — the
	// sync must carry on to its other sources.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	got, err := TrackerSource{BaseURL: srv.URL}.ShareCodes(context.Background(), 1)
	if err != nil || len(got) != 0 {
		t.Errorf("404 gave %v, %v; want no codes and no error", got, err)
	}

	// An endpoint that starts refusing us IS an error worth logging — it is
	// undocumented and can be gated at any time.
	srv2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv2.Close()
	if _, err := (TrackerSource{BaseURL: srv2.URL}).ShareCodes(context.Background(), 1); err == nil {
		t.Error("401 should surface as an error so it is visible in logs")
	}
}

func TestTrackerLimiterIsPolite(t *testing.T) {
	// Somebody else's server, answering for free, with no agreement in place.
	// The budget should look like a person browsing, not a crawler.
	if burst := trackerLimiter.Burst(); burst != 1 {
		t.Errorf("burst = %d, want 1", burst)
	}
	if lim := trackerLimiter.Limit(); lim > rate.Every(2*time.Second) {
		t.Errorf("limit = %v, want no faster than one every 2s", lim)
	}
}
