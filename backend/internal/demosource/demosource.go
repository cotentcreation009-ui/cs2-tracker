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
	"errors"
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

// ShareCodeResolver turns a match share code (CSGO-xxxxx-…) into a downloadable
// replay URL — satisfied by (*gcbot.Client).Resolve when the sidecar is deployed.
type ShareCodeResolver func(ctx context.Context, shareCode string) (string, error)

// Resolve turns a job into a local .dem path. For DemoURL jobs the file is
// downloaded into workDir (and transparently decompressed). For DemoPath jobs
// the user's file is used in place and never deleted. ShareCode jobs need a
// Game Coordinator resolver — use NewResolver to supply one.
// ProgressFunc receives a stage name and that stage's completion in 0..1.
// A fraction below zero means "in progress, size unknown".
type ProgressFunc func(phase string, fraction float64)

type progressKey struct{}

// WithProgress attaches a progress callback to ctx. Carried in the context
// rather than a parameter so the resolver's signature — shared by two call
// sites and a test fake — stays the same; a resolver without one reports
// nothing and costs nothing.
func WithProgress(ctx context.Context, fn ProgressFunc) context.Context {
	if fn == nil {
		return ctx
	}
	return context.WithValue(ctx, progressKey{}, fn)
}

func progressFrom(ctx context.Context) ProgressFunc {
	fn, _ := ctx.Value(progressKey{}).(ProgressFunc)
	return fn
}

// progressReader reports how much of the COMPRESSED body has been consumed
// against Content-Length. Compressed bytes are what the wire delivers, so this
// is the honest measure of download progress even though the output on disk
// is decompressed.
type progressReader struct {
	r     io.Reader
	rb    *resumeBody
	total int64
	fn    ProgressFunc
}

func (p *progressReader) Read(b []byte) (int, error) {
	n, err := p.r.Read(b)
	if n > 0 && p.fn != nil {
		if p.total > 0 {
			p.fn("downloading", float64(p.rb.off)/float64(p.total))
		} else {
			p.fn("downloading", -1)
		}
	}
	return n, err
}

func Resolve(ctx context.Context, job queue.Job, workDir string, maxBytes int64) (Resolved, error) {
	return resolve(ctx, job, workDir, maxBytes, nil)
}

// NewResolver returns a Resolve-shaped function with share-code support wired
// to sc (the gc-bot sidecar). The share code resolves to a replay URL, then the
// normal download path takes over.
func NewResolver(sc ShareCodeResolver) func(ctx context.Context, job queue.Job, workDir string, maxBytes int64) (Resolved, error) {
	return func(ctx context.Context, job queue.Job, workDir string, maxBytes int64) (Resolved, error) {
		return resolve(ctx, job, workDir, maxBytes, sc)
	}
}

func resolve(ctx context.Context, job queue.Job, workDir string, maxBytes int64, sc ShareCodeResolver) (Resolved, error) {
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
		if sc == nil {
			return Resolved{}, fmt.Errorf("demosource: share-code ingest needs the Game Coordinator bot (GC_BOT_URL not configured)")
		}
		demoURL, err := sc(ctx, job.ShareCode)
		if err != nil {
			return Resolved{}, fmt.Errorf("demosource: resolve share code: %w", err)
		}
		path, err := download(ctx, demoURL, workDir, maxBytes)
		if err != nil {
			return Resolved{}, err
		}
		return Resolved{Path: path, Downloaded: true}, nil

	default:
		return Resolved{}, fmt.Errorf("demosource: job has neither demoPath, demoUrl nor shareCode")
	}
}

// downloadTimeout bounds a single remote demo fetch end to end.
const downloadTimeout = 5 * time.Minute

// downloadAttempts is how many times a demo transfer may be re-opened after
// the remote drops it mid-stream. Valve's replay hosts reset long transfers
// routinely, and a demo is tens to hundreds of MB, so one reset used to fail
// the whole job.
const downloadAttempts = 4

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

// transient reports whether a transfer failure is worth re-opening: the remote
// closing the socket (RST/EPIPE), a truncated body, or a stalled read.
func transient(err error) bool {
	if err == nil || errors.Is(err, io.EOF) {
		return false
	}
	if errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, syscall.ECONNRESET) || errors.Is(err, syscall.EPIPE) {
		return true
	}
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return true
	}
	// http2/transport wrappers don't always expose a typed cause
	s := err.Error()
	return strings.Contains(s, "connection reset by peer") ||
		strings.Contains(s, "unexpected EOF") ||
		strings.Contains(s, "broken pipe")
}

func humanBytes(n int64) string {
	switch {
	case n >= 1<<30:
		return fmt.Sprintf("%.1f GB", float64(n)/float64(1<<30))
	case n >= 1<<20:
		return fmt.Sprintf("%.0f MB", float64(n)/float64(1<<20))
	default:
		return fmt.Sprintf("%.0f KB", float64(n)/float64(1<<10))
	}
}

// resumeBody streams a remote response and, when the connection drops partway
// through, silently re-opens it with a Range request and continues where it
// left off. It wraps the COMPRESSED bytes, so the decompressor above it sees
// one uninterrupted stream and never has to restart.
type resumeBody struct {
	ctx    context.Context
	url    string
	body   io.ReadCloser
	off    int64 // compressed bytes already handed to the caller
	tries  int
	failed error // last transport error, for the user-facing message
}

func (r *resumeBody) Read(p []byte) (int, error) {
	for {
		n, err := r.body.Read(p)
		if n > 0 {
			r.off += int64(n)
			// Defer any error to the next Read (allowed by io.Reader) so the
			// bytes we did get are never dropped.
			return n, nil
		}
		if err == nil {
			return 0, nil
		}
		if errors.Is(err, io.EOF) {
			return 0, io.EOF
		}
		if !transient(err) || r.tries >= downloadAttempts {
			r.failed = err
			return 0, err
		}
		r.tries++
		if reErr := r.reopen(); reErr != nil {
			r.failed = err
			return 0, err // report the original network failure, not the retry's
		}
	}
}

func (r *resumeBody) reopen() error {
	_ = r.body.Close()
	select {
	case <-r.ctx.Done():
		return r.ctx.Err()
	case <-time.After(time.Duration(r.tries) * 500 * time.Millisecond):
	}
	req, err := http.NewRequestWithContext(r.ctx, http.MethodGet, r.url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-", r.off))
	resp, err := safeClient.Do(req)
	if err != nil {
		return err
	}
	switch resp.StatusCode {
	case http.StatusPartialContent:
		r.body = resp.Body
		return nil
	case http.StatusOK:
		// Host ignored the Range header and restarted the file — skip what we
		// already wrote so the stream stays continuous.
		if _, err := io.CopyN(io.Discard, resp.Body, r.off); err != nil {
			_ = resp.Body.Close()
			return err
		}
		r.body = resp.Body
		return nil
	default:
		_ = resp.Body.Close()
		return fmt.Errorf("resume status %d", resp.StatusCode)
	}
}

func (r *resumeBody) Close() error { return r.body.Close() }

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

	rb := &resumeBody{ctx: ctx, url: rawURL, body: resp.Body}
	var raw io.Reader = rb
	if fn := progressFrom(ctx); fn != nil {
		raw = &progressReader{r: rb, rb: rb, total: resp.ContentLength, fn: fn}
	}
	src, closeDec, err := decompressor(rawURL, raw)
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
		// Raw socket errors embed our container's internal IP and mean nothing
		// to a player ("read tcp 172.18.0.6:36862->34.126.230.235:80: read:
		// connection reset by peer"), so say what actually happened instead.
		if transient(err) || rb.failed != nil {
			return "", fmt.Errorf("demosource: the demo host closed the connection after %s and %d retries — this is usually temporary, try again in a moment",
				humanBytes(rb.off), rb.tries)
		}
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
