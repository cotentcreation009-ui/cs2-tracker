package demosource

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
)

// withLoopbackClient swaps the SSRF-guarded client for a plain one so a
// loopback httptest server is reachable. The guard itself stays covered by
// TestDownloadBlocksLoopback.
func withLoopbackClient(t *testing.T) {
	t.Helper()
	prev := safeClient
	safeClient = &http.Client{Timeout: downloadTimeout}
	t.Cleanup(func() { safeClient = prev })
}

// A demo host that resets the connection partway through must not fail the
// job: the transfer resumes with a Range request and the file lands complete.
// This is the failure the user hit — "read: connection reset by peer" while
// writing the demo.
func TestDownloadResumesAfterMidStreamReset(t *testing.T) {
	withLoopbackClient(t)
	full := bytes.Repeat([]byte("HL2DEMO-"), 40_000) // 320 KB
	var hits int32

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&hits, 1)
		start := 0
		if rg := r.Header.Get("Range"); rg != "" {
			_, _ = fmt.Sscanf(rg, "bytes=%d-", &start)
		}
		if start > 0 {
			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, len(full)-1, len(full)))
			w.WriteHeader(http.StatusPartialContent)
		}
		if n == 1 {
			// serve a slice, then kill the TCP connection abruptly
			_, _ = w.Write(full[:50_000])
			w.(http.Flusher).Flush()
			conn, _, err := w.(http.Hijacker).Hijack()
			if err == nil {
				_ = conn.Close()
			}
			return
		}
		_, _ = w.Write(full[start:])
	}))
	defer srv.Close()

	path, err := download(context.Background(), srv.URL+"/match.dem", t.TempDir(), 0)
	if err != nil {
		t.Fatalf("download after reset: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, full) {
		t.Fatalf("resumed file wrong: got %d bytes, want %d", len(got), len(full))
	}
	if atomic.LoadInt32(&hits) < 2 {
		t.Errorf("expected a resume request, server saw %d hits", hits)
	}
}

// A host that ignores Range and restarts the file must still yield a correct
// download — the already-written prefix is skipped, not duplicated.
func TestDownloadResumesWhenServerIgnoresRange(t *testing.T) {
	withLoopbackClient(t)
	full := bytes.Repeat([]byte("ABCDEFGH"), 20_000)
	var hits int32

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if atomic.AddInt32(&hits, 1) == 1 {
			_, _ = w.Write(full[:30_000])
			w.(http.Flusher).Flush()
			conn, _, err := w.(http.Hijacker).Hijack()
			if err == nil {
				_ = conn.Close()
			}
			return
		}
		_, _ = w.Write(full) // 200 OK, whole file again
	}))
	defer srv.Close()

	path, err := download(context.Background(), srv.URL+"/match.dem", t.TempDir(), 0)
	if err != nil {
		t.Fatalf("download: %v", err)
	}
	got, _ := os.ReadFile(path)
	if !bytes.Equal(got, full) {
		t.Fatalf("got %d bytes, want %d", len(got), len(full))
	}
}

// When the host keeps dropping, the user must get an actionable message —
// never a raw socket error carrying our container's internal IP.
func TestDownloadGivesFriendlyErrorAfterRepeatedResets(t *testing.T) {
	withLoopbackClient(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(bytes.Repeat([]byte("x"), 8_000))
		w.(http.Flusher).Flush()
		conn, _, err := w.(http.Hijacker).Hijack()
		if err == nil {
			_ = conn.Close()
		}
	}))
	defer srv.Close()

	_, err := download(context.Background(), srv.URL+"/match.dem", t.TempDir(), 0)
	if err == nil {
		t.Fatal("expected an error after repeated resets")
	}
	if !strings.Contains(err.Error(), "usually temporary") {
		t.Errorf("error not user-facing: %v", err)
	}
	for _, leak := range []string{"read tcp", "->", "connection reset by peer"} {
		if strings.Contains(err.Error(), leak) {
			t.Errorf("raw socket detail leaked to the user (%q): %v", leak, err)
		}
	}
}
