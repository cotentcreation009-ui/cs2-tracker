// Package demosource resolves a parse job to a local .dem file ready for the
// parser. It handles the two cases that work end-to-end today — a local file
// path and a direct HTTP(S) URL to a (optionally bz2-compressed) GOTV demo —
// and clearly reports that share-code-only jobs still need the Game Coordinator
// step, which is a roadmap item.
package demosource

import (
	"compress/bzip2"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/cs2tracker/server/internal/queue"
)

// Resolved is the outcome of resolving a job to a demo on disk.
type Resolved struct {
	Path       string // local path to the .dem file
	Downloaded bool   // true if we fetched it (and may delete it afterwards)
}

// Resolve turns a job into a local .dem path. For DemoURL jobs the file is
// downloaded into workDir (and transparently bz2-decompressed). For DemoPath
// jobs the user's file is used in place and never deleted.
func Resolve(ctx context.Context, job queue.Job, workDir string) (Resolved, error) {
	switch {
	case job.DemoPath != "":
		if _, err := os.Stat(job.DemoPath); err != nil {
			return Resolved{}, fmt.Errorf("demosource: stat %q: %w", job.DemoPath, err)
		}
		return Resolved{Path: job.DemoPath, Downloaded: false}, nil

	case job.DemoURL != "":
		path, err := download(ctx, job.DemoURL, workDir)
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

func download(ctx context.Context, url, workDir string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	resp, err := http.DefaultClient.Do(req)
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

	var src io.Reader = resp.Body
	if strings.HasSuffix(strings.ToLower(url), ".bz2") {
		src = bzip2.NewReader(resp.Body) // GOTV demos are distributed bz2-compressed
	}
	if _, err := io.Copy(out, src); err != nil {
		_ = os.Remove(out.Name())
		return "", fmt.Errorf("demosource: write demo: %w", err)
	}
	return out.Name(), nil
}

// CleanupDir returns the standard scratch directory name under a base work dir.
func CleanupDir(base string) string { return filepath.Join(base, "cs2-demos") }
