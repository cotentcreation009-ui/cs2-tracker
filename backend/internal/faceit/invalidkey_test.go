package faceit

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// FACEIT signals a revoked/rotated key with 400 {"error":"invalid_token"},
// not 401 — mapping it to a generic error made the UI say "internal error"
// instead of surfacing that the key needs replacing.
func TestInvalidTokenMapsToErrInvalidKey(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_token","error_description":"Token was not recognised"}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "stale-key", WithDownloadURL(srv.URL+"/download"))
	if _, err := c.MatchDemoResource(context.Background(), "1-abc"); !errors.Is(err, ErrInvalidKey) {
		t.Fatalf("MatchDemoResource err = %v, want ErrInvalidKey", err)
	}
	if _, err := c.GetProfile(context.Background(), 76561198000000000); !errors.Is(err, ErrInvalidKey) {
		t.Fatalf("GetProfile err = %v, want ErrInvalidKey", err)
	}
	if _, err := c.SignDemoURL(context.Background(), "https://demos.example/x.dem.zst"); !errors.Is(err, ErrInvalidKey) {
		t.Fatalf("SignDemoURL err = %v, want ErrInvalidKey", err)
	}
}

// A 400 that is NOT a token problem must stay a generic error.
func TestOtherBadRequestStaysGeneric(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"errors":[{"message":"bad match id"}]}`))
	}))
	defer srv.Close()
	c := New(srv.URL, "key")
	err := c.get(context.Background(), "/x", &struct{}{})
	if errors.Is(err, ErrInvalidKey) || err == nil {
		t.Fatalf("err = %v, want a generic non-token error", err)
	}
}
