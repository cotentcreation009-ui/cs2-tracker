package leetify

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetProfile(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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

	c := New(srv.URL, "")
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
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	if _, err := New(srv.URL, "").GetProfile(context.Background(), 1); err != ErrNotFound {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
}
