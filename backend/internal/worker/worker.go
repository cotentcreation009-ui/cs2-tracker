// Package worker holds the parse-job processing logic, extracted from the
// command so its control flow (status transitions, error handling, demo
// cleanup) can be unit-tested with fakes — no Postgres, Redis or real demo
// required. The cmd/worker binary wires real implementations and runs the
// dequeue loop around Process.
package worker

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/cs2tracker/server/internal/cache"
	"github.com/cs2tracker/server/internal/demosource"
	"github.com/cs2tracker/server/internal/models"
	"github.com/cs2tracker/server/internal/parser"
	"github.com/cs2tracker/server/internal/queue"
)

// Store is the persistence the worker needs.
type Store interface {
	InsertParsedMatch(ctx context.Context, pm *models.ParsedMatch) (int64, error)
	SetJobStatus(ctx context.Context, id, status string, matchID *int64, errMsg string) error
}

// Resolver turns a job into a local demo path on disk.
type Resolver func(ctx context.Context, job queue.Job, workDir string) (demosource.Resolved, error)

// ParseFunc parses a demo file into structured results.
type ParseFunc func(path string) (*models.ParsedMatch, error)

// Worker processes parse jobs. Resolve and Parse are injectable for testing;
// New wires the real demosource + parser.
type Worker struct {
	Store         Store
	Cache         *cache.Cache // may be nil; cache invalidation is best-effort
	Resolve       Resolver
	Parse         ParseFunc
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
		WorkDir:       workDir,
		DeleteRawDemo: deleteRaw,
		JobTimeout:    jobTimeout,
		Log:           log,
	}
}

// Process runs one job to a terminal status (done | failed).
func (w *Worker) Process(ctx context.Context, job *queue.Job) {
	log := w.Log.With("jobId", job.ID, "type", job.Type)
	if job.Type != queue.JobParseDemo {
		log.Warn("unknown job type, skipping")
		w.setStatus(job.ID, models.JobFailed, nil, "unknown job type")
		return
	}

	w.setStatus(job.ID, models.JobRunning, nil, "")
	matchID, err := w.runParse(ctx, job, log)
	if err != nil {
		log.Error("job failed", "err", err)
		w.setStatus(job.ID, models.JobFailed, nil, err.Error())
		return
	}
	w.setStatus(job.ID, models.JobDone, &matchID, "")
}

func (w *Worker) runParse(ctx context.Context, job *queue.Job, log *slog.Logger) (int64, error) {
	jobCtx, cancel := context.WithTimeout(ctx, w.JobTimeout)
	defer cancel()

	res, err := w.Resolve(jobCtx, *job, w.WorkDir)
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
