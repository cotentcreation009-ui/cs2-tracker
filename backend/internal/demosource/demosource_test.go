package demosource

import (
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/klauspost/compress/zstd"
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

// decompressor must pick the decoder from the URL PATH extension — including
// signed URLs whose query strings carry tokens — and round-trip the payload.
// FACEIT demos are .dem.zst, legacy FACEIT .dem.gz, GOTV .dem.bz2, Valve .dem.
func TestDecompressor(t *testing.T) {
	payload := []byte("HL2DEMO fake demo payload for round-trip")

	gzBuf := &bytes.Buffer{}
	gw := gzip.NewWriter(gzBuf)
	_, _ = gw.Write(payload)
	_ = gw.Close()

	zstBuf := &bytes.Buffer{}
	zw, err := zstd.NewWriter(zstBuf)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = zw.Write(payload)
	_ = zw.Close()

	cases := []struct {
		name string
		url  string
		body []byte
	}{
		{"plain dem", "https://replay1.valve.net/730/x.dem", payload},
		{"gzip", "https://demos.faceit-cdn.net/old/x.dem.gz", gzBuf.Bytes()},
		{"zstd", "https://demos-us-east.backblaze.faceit-cdn.net/cs2/x.dem.zst", zstBuf.Bytes()},
		{"zstd signed url (query string)", "https://cdn.example.net/cs2/x.dem.zst?sig=abc123&expires=999", zstBuf.Bytes()},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			src, closeDec, err := decompressor(tc.url, bytes.NewReader(tc.body))
			if err != nil {
				t.Fatalf("decompressor: %v", err)
			}
			defer closeDec()
			got, err := io.ReadAll(src)
			if err != nil {
				t.Fatalf("read: %v", err)
			}
			if !bytes.Equal(got, payload) {
				t.Errorf("round-trip mismatch: got %q", got)
			}
		})
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
