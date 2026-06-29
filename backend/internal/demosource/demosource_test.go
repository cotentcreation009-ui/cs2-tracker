package demosource

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIsPublicIP(t *testing.T) {
	cases := map[string]bool{
		"8.8.8.8":         true,
		"1.1.1.1":         true,
		"203.0.113.10":    true,
		"127.0.0.1":       false, // loopback
		"::1":             false, // loopback v6
		"10.0.0.5":        false, // RFC1918
		"192.168.1.1":     false, // RFC1918
		"172.16.0.1":      false, // RFC1918
		"169.254.169.254": false, // cloud metadata (link-local)
		"100.64.0.1":      false, // CGNAT 100.64.0.0/10
		"0.0.0.0":         false, // unspecified
		"fd00::1":         false, // ULA private
		"fe80::1":         false, // link-local v6
	}
	for s, want := range cases {
		ip := net.ParseIP(s)
		if ip == nil {
			t.Fatalf("bad test IP %q", s)
		}
		if got := isPublicIP(ip); got != want {
			t.Errorf("isPublicIP(%s) = %v, want %v", s, got, want)
		}
	}
}

// download must refuse internal targets at dial time. httptest listens on
// loopback, so the SSRF dial guard should block the fetch even though the URL
// is well-formed and the server is reachable — this is the core SSRF defense.
func TestDownloadBlocksLoopback(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("not a real demo"))
	}))
	defer srv.Close()

	_, err := download(context.Background(), srv.URL+"/match.dem", t.TempDir(), 0)
	if err == nil {
		t.Fatal("expected download to be blocked (loopback), got nil error")
	}
	if !strings.Contains(err.Error(), "non-public") {
		t.Errorf("expected a non-public-address error, got: %v", err)
	}
}
