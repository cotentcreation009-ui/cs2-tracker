package faceit

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The Downloads API needs its OWN access token: approval does not add the
// scope to an existing Data API key. SignDemoURL must send the dedicated
// token when configured, and fall back to the Data key when it isn't.
func TestSignDemoURLUsesDownloadKey(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		_ = json.NewEncoder(w).Encode(map[string]any{"payload": map[string]string{"download_url": "https://cdn.example/demo.dem.zst"}})
	}))
	defer srv.Close()

	c := New("", "data-key", WithDownloadURL(srv.URL), WithDownloadKey("downloads-key"))
	u, err := c.SignDemoURL(context.Background(), "https://demos.example/x.dem.zst")
	if err != nil {
		t.Fatal(err)
	}
	if u != "https://cdn.example/demo.dem.zst" {
		t.Fatalf("url = %q", u)
	}
	if gotAuth != "Bearer downloads-key" {
		t.Fatalf("auth = %q, want the dedicated downloads token", gotAuth)
	}
	if !c.HasDownloadKey() {
		t.Error("HasDownloadKey should report true")
	}

	// no dedicated token → fall back to the Data API key
	c2 := New("", "data-key", WithDownloadURL(srv.URL))
	if _, err := c2.SignDemoURL(context.Background(), "https://demos.example/x.dem.zst"); err != nil {
		t.Fatal(err)
	}
	if gotAuth != "Bearer data-key" {
		t.Fatalf("fallback auth = %q, want the data key", gotAuth)
	}
}
