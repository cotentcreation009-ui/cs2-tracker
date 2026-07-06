package gcbot

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResolve(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/resolve" || r.Method != http.MethodPost {
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
		var body struct {
			ShareCode string `json:"shareCode"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.ShareCode != "CSGO-yOJk4-YmmVm-KsSa5-rPTwZ-jPocG" {
			t.Errorf("shareCode = %q", body.ShareCode)
		}
		w.Write([]byte(`{"demoUrl":"http://replay389.valve.net/730/x.dem.bz2"}`))
	}))
	defer srv.Close()

	got, err := New(srv.URL).Resolve(context.Background(), "CSGO-yOJk4-YmmVm-KsSa5-rPTwZ-jPocG")
	if err != nil {
		t.Fatal(err)
	}
	if got != "http://replay389.valve.net/730/x.dem.bz2" {
		t.Errorf("url = %q", got)
	}
}

func TestResolveErrors(t *testing.T) {
	cases := []struct {
		status int
		want   error
	}{
		{http.StatusNotFound, ErrNotFound},
		{http.StatusServiceUnavailable, ErrUnavailable},
	}
	for _, tc := range cases {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(tc.status)
			w.Write([]byte(`{"error":"x"}`))
		}))
		if _, err := New(srv.URL).Resolve(context.Background(), "CSGO-aaaaa-aaaaa-aaaaa-aaaaa-aaaaa"); !errors.Is(err, tc.want) {
			t.Errorf("status %d: err = %v, want %v", tc.status, err, tc.want)
		}
		srv.Close()
	}
}
