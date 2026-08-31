package api

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/cs2tracker/server/internal/config"
	"github.com/cs2tracker/server/internal/leetify"
	"github.com/cs2tracker/server/internal/steam"
	"github.com/cs2tracker/server/internal/valvechain"
)

const chainURL = "/api/players/76561197995150836/chain"

// A server with the bridge on and the chain walker pointed at a fake Valve.
func chainServer(t *testing.T, valve http.HandlerFunc) (*Server, *fakeStore) {
	t.Helper()
	vs := httptest.NewServer(valve)
	t.Cleanup(vs.Close)
	ls := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(ls.Close)

	store := &fakeStore{}
	cfg := &config.Config{CORSOrigins: []string{"*"}, BridgeEnabled: true, SteamAPIKey: "k"}
	s := NewServer(cfg, store, steam.New(""),
		leetify.New(ls.URL, "", leetify.WithLegacyURL(ls.URL)),
		nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	s.chainValve = &valvechain.Client{Key: "k", BaseURL: vs.URL}
	return s, store
}

func postChain(t *testing.T, s *Server, body string) *httptest.ResponseRecorder {
	t.Helper()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("POST", chainURL, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	s.Router().ServeHTTP(rr, req)
	return rr
}

func TestChainConnectVerifiesBeforeStoring(t *testing.T) {
	s, store := chainServer(t, func(w http.ResponseWriter, r *http.Request) {
		// Valve says "that pair is valid and already at the head".
		w.WriteHeader(http.StatusAccepted)
	})

	rr := postChain(t, s, `{"authCode":"AAAA-BBBBB-CCCC","shareCode":"CSGO-X5EDM-CJCpX-dTvfS-kMP7u-EhMMB"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
	}
	if store.chain.AuthCode != "AAAA-BBBBB-CCCC" || store.chain.Status != "active" {
		t.Errorf("stored chain = %+v", store.chain)
	}
}

func TestChainConnectRejectsWithoutStoring(t *testing.T) {
	// A mistyped auth code must fail HERE with a message naming the fix — not
	// silently three days later in a poller log — and nothing may be stored.
	s, store := chainServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte("<html>Access is denied.</html>"))
	})
	rr := postChain(t, s, `{"authCode":"AAAA-BBBBB-CCCC","shareCode":"CSGO-X5EDM-CJCpX-dTvfS-kMP7u-EhMMB"}`)
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "auth code") {
		t.Errorf("error does not name the culprit: %s", rr.Body.String())
	}
	if store.chain.SteamID != 0 {
		t.Errorf("a rejected pair was stored: %+v", store.chain)
	}
}

func TestChainConnectValidatesShapesLocally(t *testing.T) {
	// Garbage must not reach Valve at all — their 403 punishment escalates.
	s, _ := chainServer(t, func(w http.ResponseWriter, r *http.Request) {
		t.Error("Valve was called for locally-invalid input")
	})
	for _, body := range []string{
		`{"authCode":"not-a-code","shareCode":"CSGO-X5EDM-CJCpX-dTvfS-kMP7u-EhMMB"}`,
		`{"authCode":"AAAA-BBBBB-CCCC","shareCode":"garbage"}`,
	} {
		if rr := postChain(t, s, body); rr.Code != http.StatusBadRequest {
			t.Errorf("body %s gave %d, want 400", body, rr.Code)
		}
	}
}

func TestChainStatusNeverLeaksTheAuthCode(t *testing.T) {
	s, store := chainServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
	})
	postChain(t, s, `{"authCode":"AAAA-BBBBB-CCCC","shareCode":"CSGO-X5EDM-CJCpX-dTvfS-kMP7u-EhMMB"}`)
	_ = store

	rr := httptest.NewRecorder()
	s.Router().ServeHTTP(rr, httptest.NewRequest("GET", chainURL, nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d", rr.Code)
	}
	// The auth code is a credential for the account's history. It goes in,
	// it never comes back out — not in status, not anywhere.
	if strings.Contains(rr.Body.String(), "AAAA-BBBBB-CCCC") {
		t.Fatalf("auth code leaked: %s", rr.Body.String())
	}
	var got map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &got)
	if got["connected"] != true || got["status"] != "active" {
		t.Errorf("status = %v", got)
	}
}
