// Package worker holds the parse-job processing logic, extracted from the
// command so its control flow (status transitions, error handling, demo
// cleanup) can be unit-tested with fakes — no Postgres, Redis or real demo
// required. The cmd/worker binary wires real implementations and runs the
// dequeue loop around Process.
package worker

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/cs2tracker/server/internal/blob"
	"github.com/cs2tracker/server/internal/cache"
	"github.com/cs2tracker/server/internal/demosource"
	"github.com/cs2tracker/server/internal/models"
	"github.com/cs2tracker/server/internal/parser"
	"github.com/cs2tracker/server/internal/queue"
)

// Dequeuer is the queue surface the run loop needs (satisfied by *queue.Queue).
type Dequeuer interface {
	Dequeue(ctx context.Context, timeout time.Duration) (*queue.Job, error)
}

// Store is the persistence the worker needs.
type Store interface {
	InsertParsedMatch(ctx context.Context, pm *models.ParsedMatch) (int64, error)
	SetJobStatus(ctx context.Context, id, status string, matchID *int64, errMsg string) error
	// Demo-analysis (user-uploaded replay) results.
	SetDemoStatus(ctx context.Context, id, status, errMsg string) error
	SaveDemoResult(ctx context.Context, id, mapName string, gzipData []byte) error
	// Our own per-player stats from a demo we parsed. Separate from the
	// Leetify mirror on purpose — this data is ours.
	SaveParsedMatch(ctx context.Context, shareCode, mapName string, finishedAt time.Time, rounds int, players []parser.PlayerSummary) error
	// Live stage/percent for the progress bar. Called throttled.
	SetDemoProgress(ctx context.Context, id, phase string, pct int) error
}

// progressReporter turns the stream of fractions from the download and parse
// readers into a sparse set of row updates: a write when the percentage moves
// by two points or the last write is over a second old, whichever comes first.
// Without the throttle a 300MB download would issue thousands of updates.
type progressReporter struct {
	ctx       context.Context
	store     Store
	id        string
	log       *slog.Logger
	lastPhase string
	lastPct   int
	lastAt    time.Time
}

func (p *progressReporter) report(phase string, fraction float64) {
	pct := -1
	if fraction >= 0 {
		pct = int(fraction*100 + 0.5)
		if pct > 100 {
			pct = 100
		}
	}
	if phase == p.lastPhase && pct >= 0 && pct-p.lastPct < 2 && time.Since(p.lastAt) < 1500*time.Millisecond {
		return
	}
	p.lastPhase, p.lastPct, p.lastAt = phase, pct, time.Now()
	if pct < 0 {
		pct = 0
	}
	if err := p.store.SetDemoProgress(p.ctx, p.id, phase, pct); err != nil {
		p.log.Warn("progress update failed", "id", p.id, "err", err)
	}
}

// countingReader reports bytes consumed against a known total — parse
// progress, since the parser reads the demo front to back.
type countingReader struct {
	r     io.Reader
	n     int64
	total int64
	fn    func(fraction float64)
}

func (c *countingReader) Read(b []byte) (int, error) {
	n, err := c.r.Read(b)
	if n > 0 {
		c.n += int64(n)
		if c.total > 0 {
			c.fn(float64(c.n) / float64(c.total))
		}
	}
	return n, err
}

// ReplayParseFunc extracts the normalized replay model from a demo reader.
type ReplayParseFunc func(r io.Reader) (*parser.ReplayMatch, error)

// Resolver turns a job into a local demo path on disk.
type Resolver func(ctx context.Context, job queue.Job, workDir string, maxBytes int64) (demosource.Resolved, error)

// ParseFunc parses a demo file into structured results.
type ParseFunc func(path string) (*models.ParsedMatch, error)

// Worker processes parse jobs. Resolve and Parse are injectable for testing;
// New wires the real demosource + parser.
type Worker struct {
	Store         Store
	Cache         *cache.Cache // may be nil; cache invalidation is best-effort
	Resolve       Resolver
	Parse         ParseFunc
	ReplayParse   ReplayParseFunc
	Blob          blob.Store // nil unless object-storage (GCS) demo upload is configured
	MaxDemoBytes  int64      // reject GCS objects larger than this (<=0 = unbounded)
	WorkDir       string
	DeleteRawDemo bool
	JobTimeout    time.Duration
	Log           *slog.Logger
}

// New builds a Worker with the real demosource and parser.
func New(store Store, c *cache.Cache, workDir string, deleteRaw bool, jobTimeout time.Duration, log *slog.Logger) *Worker {
	return &Worker{
		Store:         store,
		Cache:         c,
		Resolve:       demosource.Resolve,
		Parse:         parser.ParseFile,
		ReplayParse:   parser.ParseReplay,
		WorkDir:       workDir,
		DeleteRawDemo: deleteRaw,
		JobTimeout:    jobTimeout,
		Log:           log,
	}
}

// Run starts `concurrency` goroutines that each block-pop jobs and Process them
// until ctx is cancelled, then waits for in-flight jobs to finish. This is the
// per-worker parallelism knob for scaling parse throughput.
func (w *Worker) Run(ctx context.Context, q Dequeuer, concurrency int) {
	if concurrency < 1 {
		concurrency = 1
	}
	var wg sync.WaitGroup
	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				if ctx.Err() != nil {
					return
				}
				job, err := q.Dequeue(ctx, 5*time.Second)
				if err != nil {
					if ctx.Err() != nil {
						return
					}
					w.Log.Error("dequeue failed", "err", err)
					select { // cancel-aware backoff on transient errors
					case <-ctx.Done():
						return
					case <-time.After(time.Second):
					}
					continue
				}
				if job == nil {
					continue // poll timeout
				}
				w.Process(job)
			}
		}()
	}
	wg.Wait()
}

// Process runs one job to a terminal status (done | failed). It is independent
// of any dequeue/shutdown context: an accepted job gets its own timeout and runs
// to completion, so the run loop can stop taking new work on shutdown while
// in-flight jobs drain.
func (w *Worker) Process(job *queue.Job) {
	log := w.Log.With("jobId", job.ID, "type", job.Type)
	switch job.Type {
	case queue.JobParseDemo:
		w.setStatus(job.ID, models.JobRunning, nil, "")
		matchID, err := w.runParse(job, log)
		if err != nil {
			log.Error("job failed", "err", err)
			w.setStatus(job.ID, models.JobFailed, nil, err.Error())
			return
		}
		w.setStatus(job.ID, models.JobDone, &matchID, "")
	case queue.JobParseReplay:
		w.setDemoStatus(job.ID, "running", "")
		if err := w.runReplay(job, log); err != nil {
			log.Error("replay job failed", "err", err)
			w.setDemoStatus(job.ID, "failed", err.Error())
			return
		}
		// runReplay marks the result done on success.
	default:
		log.Warn("unknown job type, skipping")
		w.setStatus(job.ID, models.JobFailed, nil, "unknown job type")
	}
}

// runReplay parses a user-uploaded demo into the normalized replay model, gzips
// it, and stores it. The raw .dem is always deleted afterward.
func (w *Worker) runReplay(job *queue.Job, log *slog.Logger) error {
	jobCtx, cancel := context.WithTimeout(context.Background(), w.JobTimeout)
	defer cancel()
	rep := &progressReporter{ctx: jobCtx, store: w.Store, id: job.ID, log: log}
	jobCtx = demosource.WithProgress(jobCtx, rep.report)

	// Resolve the demo to a local file. A "gcs" job was uploaded straight to
	// object storage by the browser, so we pull it down here (and delete it from
	// the bucket after); other sources go through the normal resolver.
	var path string
	if job.Source == "gcs" {
		if w.Blob == nil {
			return fmt.Errorf("gcs job but object storage is not configured")
		}
		path = filepath.Join(w.WorkDir, job.ID+".dem")
		if _, err := w.Blob.Download(jobCtx, job.ObjectKey, path, w.MaxDemoBytes); err != nil {
			return fmt.Errorf("download demo from object storage: %w", err)
		}
		defer func() {
			if err := w.Blob.Delete(context.Background(), job.ObjectKey); err != nil {
				log.Warn("could not delete object-storage demo", "key", job.ObjectKey, "err", err)
			}
		}()
	} else {
		res, err := w.Resolve(jobCtx, *job, w.WorkDir, w.MaxDemoBytes)
		if err != nil {
			return fmt.Errorf("resolve demo: %w", err)
		}
		path = res.Path
	}
	defer func() {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			log.Warn("could not delete uploaded demo", "path", path, "err", err)
		}
	}()

	started := time.Now()
	f, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open demo: %w", err)
	}
	defer f.Close()

	var src io.Reader = f
	if st, serr := f.Stat(); serr == nil && st.Size() > 0 {
		src = &countingReader{r: f, total: st.Size(), fn: func(fr float64) { rep.report("parsing", fr) }}
	}
	rm, err := w.ReplayParse(src)
	if err != nil {
		return fmt.Errorf("parse replay: %w", err)
	}
	rep.report("saving", 1)

	jsonB, err := json.Marshal(rm)
	if err != nil {
		return fmt.Errorf("marshal replay: %w", err)
	}
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err := gz.Write(jsonB); err != nil {
		return fmt.Errorf("gzip: %w", err)
	}
	if err := gz.Close(); err != nil {
		return fmt.Errorf("gzip close: %w", err)
	}

	if err := w.Store.SaveDemoResult(jobCtx, job.ID, rm.Map, buf.Bytes()); err != nil {
		return fmt.Errorf("save result: %w", err)
	}

	// A demo fetched by share code is a match we can attribute to real players,
	// so keep the per-player stats too. Best-effort: the viewer result above is
	// what the requester is waiting on, and losing the durable rows must not
	// fail a job the user watched succeed.
	if job.ShareCode != "" {
		players := parser.SummarisePlayers(rm)
		if err := w.Store.SaveParsedMatch(jobCtx, job.ShareCode, rm.Map,
			time.Time{}, len(rm.RoundData), players); err != nil {
			log.Warn("could not save parsed player stats",
				"shareCode", job.ShareCode, "err", err)
		} else {
			var ranked int
			for _, p := range players {
				if p.RankNew > 0 {
					ranked++
				}
			}
			log.Info("stored our own match stats",
				"shareCode", job.ShareCode, "players", len(players), "with_rank", ranked)
		}
	}
	log.Info("demo replay parsed",
		"map", rm.Map, "rounds", rm.Rounds, "players", len(rm.Players),
		"jsonBytes", len(jsonB), "gzipBytes", buf.Len(), "took", time.Since(started).String())
	return nil
}

func (w *Worker) setDemoStatus(id, status, errMsg string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := w.Store.SetDemoStatus(ctx, id, status, errMsg); err != nil {
		w.Log.Warn("could not update demo status", "jobId", id, "err", err)
	}
}

func (w *Worker) runParse(job *queue.Job, log *slog.Logger) (int64, error) {
	// Rooted in Background (not the shutdown ctx) so an accepted job is not
	// aborted mid-parse on shutdown; bounded only by JobTimeout.
	jobCtx, cancel := context.WithTimeout(context.Background(), w.JobTimeout)
	defer cancel()

	res, err := w.Resolve(jobCtx, *job, w.WorkDir, w.MaxDemoBytes)
	if err != nil {
		return 0, fmt.Errorf("resolve demo: %w", err)
	}
	defer func() {
		if res.Downloaded && w.DeleteRawDemo {
			if err := os.Remove(res.Path); err != nil && !os.IsNotExist(err) {
				log.Warn("could not delete raw demo", "path", res.Path, "err", err)
			}
		}
	}()

	started := time.Now()
	pm, err := w.Parse(res.Path)
	if err != nil {
		return 0, fmt.Errorf("parse %s: %w", res.Path, err)
	}

	pm.Match.DemoSource = job.Source
	pm.Match.ShareCode = job.ShareCode
	if pm.Match.PlayedAt.IsZero() {
		pm.Match.PlayedAt = job.EnqueuedAt
	}
	// Stamp the demo's content hash so re-ingesting the same file is deduped.
	if h, err := parser.HashFile(res.Path); err == nil {
		pm.Match.DemoHash = h
	} else {
		log.Warn("could not hash demo for dedup", "path", res.Path, "err", err)
	}

	matchID, err := w.Store.InsertParsedMatch(jobCtx, pm)
	if err != nil {
		return 0, fmt.Errorf("persist match: %w", err)
	}

	if w.Cache != nil {
		keys := make([]string, 0, len(pm.Players))
		for _, p := range pm.Players {
			keys = append(keys, cache.ProfileKey(p.SteamID64))
		}
		_ = w.Cache.Delete(jobCtx, keys...)
	}

	log.Info("match parsed and stored",
		"matchId", matchID,
		"map", pm.Match.Map,
		"rounds", pm.Match.RoundsTotal,
		"players", len(pm.Players),
		"took", time.Since(started).String(),
	)
	return matchID, nil
}

// setStatus records a status transition using its own short-lived context, so a
// failed/timed-out job is still recorded; a status-write error never fails the job.
func (w *Worker) setStatus(id, status string, matchID *int64, errMsg string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := w.Store.SetJobStatus(ctx, id, status, matchID, errMsg); err != nil {
		w.Log.Warn("could not update job status", "jobId", id, "err", err)
	}
}
