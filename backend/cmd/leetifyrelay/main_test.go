package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRelayForwardsOnlyTheAllowedRoutesWithTheKey(t *testing.T) {
	var seen []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.URL.Path)
		if r.Header.Get("Accept") != "application/json" {
			t.Errorf("Accept = %q", r.Header.Get("Accept"))
		}
		switch r.URL.Path {
		case "/api/profile/76561197965792900/recent-games/5v5":
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_, _ = w.Write([]byte(`{"aimRating":72.2}`))
		case "/api/profile/76561197965792900/meta":
			// The wall, as it answers a refused network: passed through as is.
			w.WriteHeader(http.StatusNetworkAuthenticationRequired)
			_, _ = w.Write([]byte(`{"error":"bot_check_required"}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer upstream.Close()
	relay := httptest.NewServer(newHandler(upstream.URL, "s3cret", upstream.Client()))
	defer relay.Close()

	get := func(path, key, method string) (int, string) {
		t.Helper()
		req, _ := http.NewRequest(method, relay.URL+path, nil)
		if key != "" {
			req.Header.Set("X-Relay-Key", key)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, strings.TrimSpace(string(b))
	}

	if code, body := get("/api/profile/76561197965792900/recent-games/5v5", "s3cret", http.MethodGet); code != 200 || body != `{"aimRating":72.2}` {
		t.Errorf("allowed route = %d %q", code, body)
	}
	if code, _ := get("/api/profile/76561197965792900/meta", "s3cret", http.MethodGet); code != http.StatusNetworkAuthenticationRequired {
		t.Errorf("a 511 upstream must come back as 511, got %d", code)
	}
	if code, _ := get("/api/profile/76561197965792900/recent-games/5v5", "wrong", http.MethodGet); code != http.StatusUnauthorized {
		t.Errorf("wrong key = %d, want 401", code)
	}
	if code, _ := get("/api/profile/76561197965792900/recent-games/5v5", "", http.MethodGet); code != http.StatusUnauthorized {
		t.Errorf("no key = %d, want 401", code)
	}
	if code, _ := get("/api/profile/76561197965792900/recent-games/5v5", "s3cret", http.MethodPost); code != http.StatusMethodNotAllowed {
		t.Errorf("POST = %d, want 405", code)
	}
	for _, p := range []string{
		"/api/games/9a469ffd",                          // not a profile route
		"/api/profile/42/meta",                         // not a SteamID64
		"/api/profile/76561197965792900/recent-games",  // no pool
		"/api/profile/76561197965792900/recent-games/", // empty pool
		"/api/profile/76561197965792900/settings",      // not ours to ask
		"/v3/profile", // the public API is not relayed
	} {
		if code, _ := get(p, "s3cret", http.MethodGet); code != http.StatusNotFound {
			t.Errorf("%s = %d, want 404 without touching upstream", p, code)
		}
	}
	if code, body := get("/healthz", "", http.MethodGet); code != 200 || body != "ok" {
		t.Errorf("healthz = %d %q", code, body)
	}
	// Only the two allowed requests ever reached Leetify.
	if len(seen) != 2 {
		t.Errorf("upstream saw %v, want exactly the two allowed routes", seen)
	}
}
