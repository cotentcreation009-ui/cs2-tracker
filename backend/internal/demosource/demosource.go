// Package demosource resolves a parse job to a local .dem file ready for the
// parser. It handles the two cases that work end-to-end today — a local file
// path and a direct HTTP(S) URL to a (optionally bz2-compressed) GOTV demo —
// and clearly reports that share-code-only jobs still need the Game Coordinator
// step, which is a roadmap item.
package demosource

import (
	"compress/bzip2"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/cs2tracker/server/internal/queue"
	"github.com/klauspost/compress/zstd"
)

// Resolved is the outcome of resolving a job to a demo on disk.
type Resolved struct {
	Path       string // local path to the .dem file
	Downloaded bool   // true if we fetched it (and may delete it afterwards)
}

// Resolve turns a job into a local .dem path. For DemoURL jobs the file is
// downloaded into workDir (and transparently bz2-decompressed). For DemoPath
// jobs the user's file is used in place and never deleted.
func Resolve(ctx context.Context, job queue.Job, workDir string, maxBytes int64) (Resolved, error) {
	switch {
	case job.DemoPath != "":
		if _, err := os.Stat(job.DemoPath); err != nil {
			return Resolved{}, fmt.Errorf("demosource: stat %q: %w", job.DemoPath, err)
		}
		return Resolved{Path: job.DemoPath, Downloaded: false}, nil

	case job.DemoURL != "":
		path, err := download(ctx, job.DemoURL, workDir, maxBytes)
		if err != nil {
			return Resolved{}, err
		}
		return Resolved{Path: path, Downloaded: true}, nil

	case job.ShareCode != "":
		// Decoding the share code is implemented (internal/sharecode); turning it
		// into a demo URL requires authenticating to the CS2 Game Coordinator and
		// requesting match details. That GC client is the next pipeline milestone.
		return Resolved{}, fmt.Errorf("demosource: share-code ingest requires the Game Coordinator client (roadmap); provide DemoPath or DemoURL for now")

	default:
		return Resolved{}, fmt.Errorf("demosource: job has neither demoPath, demoUrl nor shareCode")
	}
}

// downloadTimeout bounds a single remote demo fetch end to end.
const downloadTimeout = 5 * time.Minute

// isPublicIP rejects loopback, private (RFC1918/ULA), link-local (including the
// 169.254.169.254 cloud-metadata endpoint), unspecified, and carrier-grade-NAT
// addresses — the ranges an SSRF would target.
func isPublicIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsInterfaceLocalMulticast() || ip.IsUnspecified() {
		return false
	}
	if ip4 := ip.To4(); ip4 != nil && ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127 {
		return false // 100.64.0.0/10 CGNAT, not covered by IsPrivate
	}
	return true
}

// safeControl runs for every TCP connection the client dials — including each
// redirect hop and after any DNS change — and refuses non-public destinations.
// This is the real SSRF boundary: it closes both the redirect bypass and the
// DNS-rebinding TOCTOU that a submit-time host check alone cannot.
func safeControl(_, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("demosource: bad dial address %q: %w", address, err)
	}
	ip := net.ParseIP(host)
	if ip == nil || !isPublicIP(ip) {
		return fmt.Errorf("demosource: refusing to connect to non-public address %q", host)
	}
	return nil
}

// safeClient downloads remote demos. The submit-time isPublicHost check in the
// API is only for fast user feedback; this client (dial guard + redirect cap +
// timeout) is what actually enforces the boundary at fetch time.
var safeClient = &http.Client{
	Timeout: downloadTimeout,
	Transport: &http.Transport{
		DialContext: (&net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second, Control: safeControl}).DialContext,
	},
	CheckRedirect: func(_ *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return fmt.Errorf("demosource: too many redirects")
		}
		return nil
	},
}

// decompressor wraps body with the decoder implied by the URL's PATH extension
// (query strings — e.g. signed-URL tokens — are ignored). GOTV demos ship as
// .dem.bz2, FACEIT demos as .dem.zst (older ones .dem.gz); plain .dem passes
// through. The returned close func releases decoder resources (never the body).
func decompressor(rawURL string, body io.Reader) (io.Reader, func(), error) {
	path := rawURL
	if u, err := url.Parse(rawURL); err == nil && u.Path != "" {
		path = u.Path
	}
	switch {
	case strings.HasSuffix(strings.ToLower(path), ".bz2"):
		return bzip2.NewReader(body), func() {}, nil
	case strings.HasSuffix(strings.ToLower(path), ".gz"):
		gz, err := gzip.NewReader(body)
		if err != nil {
			return nil, nil, fmt.Errorf("demosource: gzip: %w", err)
		}
		return gz, func() { _ = gz.Close() }, nil
	case strings.HasSuffix(strings.ToLower(path), ".zst"):
		zr, err := zstd.NewReader(body)
		if err != nil {
			return nil, nil, fmt.Errorf("demosource: zstd: %w", err)
		}
		return zr, zr.Close, nil
	default:
		return body, func() {}, nil
	}
}

func download(ctx context.Context, rawURL, workDir string, maxBytes int64) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", err
	}
	resp, err := safeClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("demosource: download: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("demosource: download status %d", resp.StatusCode)
	}

	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return "", err
	}
	out, err := os.CreateTemp(workDir, "cs2demo-*.dem")
	if err != nil {
		return "", err
	}
	defer out.Close()

	src, closeDec, err := decompressor(rawURL, resp.Body)
	if err != nil {
		_ = os.Remove(out.Name())
		return "", err
	}
	defer closeDec()
	// Cap the DECOMPRESSED size so a small compressed "bomb" can't fill the disk.
	if maxBytes > 0 {
		src = io.LimitReader(src, maxBytes+1)
	}
	n, err := io.Copy(out, src)
	if err != nil {
		_ = os.Remove(out.Name())
		return "", fmt.Errorf("demosource: write demo: %w", err)
	}
	if maxBytes > 0 && n > maxBytes {
		_ = os.Remove(out.Name())
		return "", fmt.Errorf("demosource: demo exceeds size limit of %d bytes", maxBytes)
	}
	return out.Name(), nil
}

// CleanupDir returns the standard scratch directory name under a base work dir.
func CleanupDir(base string) string { return filepath.Join(base, "cs2-demos") }
