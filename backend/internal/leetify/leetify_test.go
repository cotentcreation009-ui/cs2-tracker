package leetify

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGetProfile(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The legacy profile endpoint was withdrawn upstream (July 2026); the
		// client must not ask for it at all.
		if strings.HasPrefix(r.URL.Path, "/api/profile/") {
			t.Errorf("dead legacy profile endpoint was called: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if r.URL.Path != "/v3/profile" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("steam64_id"); got != "76561198077030352" {
			t.Errorf("steam64_id = %s", got)
		}
		w.Write([]byte(`{
			"name":"Pod","steam64_id":"76561198077030352","total_matches":1971,
			"winrate":0.59,"privacy_mode":"public",
			"rating":{"aim":72.5,"positioning":61.2,"utility":55.0,"clutch":48.1,"opening":63.4,"ct_leetify":1.9,"t_leetify":1.4},
			"stats":{"accuracy_head":0.31,"preaim":4.2,"reaction_time_ms":540,"spray_accuracy":0.27,"trade_kills_success_percentage":0.62},
			"ranks":{"premier":{"rating":24500}}
		}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "", WithLegacyURL(srv.URL))
	p, err := c.GetProfile(context.Background(), 76561198077030352)
	if err != nil {
		t.Fatal(err)
	}
	if p.Name != "Pod" || p.TotalMatches != 1971 {
		t.Errorf("unexpected profile: %+v", p)
	}
	if p.Rating.Aim != 72.5 || p.Rating.CTLeetify != 1.9 {
		t.Errorf("rating not parsed: %+v", p.Rating)
	}
	if p.Winrate != 0.59 || p.Stats.AccuracyHead != 0.31 {
		t.Errorf("stats not parsed: %+v / %+v", p.Winrate, p.Stats)
	}
	if len(p.Ranks) == 0 {
		t.Error("ranks passthrough empty")
	}
}

func TestGetProfileNotFound(t *testing.T) {
	// A v3 miss costs at most ONE more round trip — the app's data-sources
	// route (appprofile.go). When that does not know the player either, the
	// answer is final: no per-source probing, and never the legacy profile
	// route that died upstream in July 2026.
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	c := New(srv.URL, "", WithLegacyURL(srv.URL))
	if _, err := c.GetProfile(context.Background(), 1); err != ErrNotFound {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
	want := []string{"/v3/profile", "/api/profile/1/recent-games/available-data-sources"}
	if strings.Join(paths, " ") != strings.Join(want, " ") {
		t.Errorf("requests = %v, want exactly %v", paths, want)
	}
}

// The self-serve key programme takes the raw key in the _leetify_key header —
// not a Bearer token. Keyless requests must carry no auth header at all.
func TestAPIKeyHeader(t *testing.T) {
	var got, auth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Get("_leetify_key")
		auth = r.Header.Get("Authorization")
		w.Write([]byte(`{"name":"x","steam64_id":"1","total_matches":1,"privacy_mode":"public"}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "the-key", WithLegacyURL(srv.URL))
	if _, err := c.GetProfile(context.Background(), 1); err != nil {
		t.Fatal(err)
	}
	if got != "the-key" || auth != "" {
		t.Errorf("_leetify_key=%q Authorization=%q; want the raw key and no Bearer", got, auth)
	}

	c = New(srv.URL, "", WithLegacyURL(srv.URL))
	if _, err := c.GetProfile(context.Background(), 1); err != nil {
		t.Fatal(err)
	}
	if got != "" {
		t.Errorf("keyless request sent _leetify_key=%q, want none", got)
	}
}
