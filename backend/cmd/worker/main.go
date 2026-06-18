// Command worker consumes parse jobs from the queue, parses each demo once,
// writes the structured results to Postgres (recomputing career aggregates in
// the same transaction), invalidates the affected players' caches, and deletes
// any demo it downloaded. It is stateless and horizontally scalable: run as many
// replicas as you have parsing throughput for.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/cs2tracker/server/internal/cache"
	"github.com/cs2tracker/server/internal/config"
	"github.com/cs2tracker/server/internal/db"
	"github.com/cs2tracker/server/internal/demosource"
	"github.com/cs2tracker/server/internal/models"
	"github.com/cs2tracker/server/internal/parser"
	"github.com/cs2tracker/server/internal/queue"
)

type worker struct {
	cfg     *config.Config
	db      *db.DB
	queue   *queue.Queue
	cache   *cache.Cache
	workDir string
	log     *slog.Logger
}

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if err := run(log); err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	database, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer database.Close()
	if err := database.Migrate(ctx); err != nil {
		return err
	}

	q, err := queue.Connect(cfg.RedisURL, cfg.DemoQueueKey)
	if err != nil {
		return err
	}
	defer q.Close()
	if err := q.Ping(ctx); err != nil {
		return err
	}

	var c *cache.Cache
	if cc, err := cache.Connect(cfg.RedisURL, cfg.CacheTTL); err == nil {
		c = cc
		defer c.Close()
	} else {
		log.Warn("cache unavailable; profiles will not be invalidated", "err", err)
	}

	workDir := demosource.CleanupDir(cfg.DemoWorkDir)
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return err
	}

	w := &worker{cfg: cfg, db: database, queue: q, cache: c, workDir: workDir, log: log}
	log.Info("worker started", "queue", cfg.DemoQueueKey, "workDir", workDir)

	for {
		select {
		case <-ctx.Done():
			log.Info("worker shutting down")
			return nil
		default:
		}

		job, err := q.Dequeue(ctx, 5*time.Second)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			log.Error("dequeue failed", "err", err)
			time.Sleep(time.Second) // brief backoff on transient Redis errors
			continue
		}
		if job == nil {
			continue // poll timeout, loop again
		}
		w.process(ctx, job)
	}
}

func (w *worker) process(ctx context.Context, job *queue.Job) {
	log := w.log.With("jobId", job.ID, "type", job.Type)
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

// runParse resolves, parses and persists a demo, returning the new match id.
func (w *worker) runParse(ctx context.Context, job *queue.Job, log *slog.Logger) (int64, error) {
	jobCtx, cancel := context.WithTimeout(ctx, w.cfg.JobTimeout)
	defer cancel()

	res, err := demosource.Resolve(jobCtx, *job, w.workDir)
	if err != nil {
		return 0, fmt.Errorf("resolve demo: %w", err)
	}
	// Always attempt to clean up a demo we downloaded.
	defer func() {
		if res.Downloaded && w.cfg.DeleteRawDemo {
			if err := os.Remove(res.Path); err != nil && !os.IsNotExist(err) {
				log.Warn("could not delete raw demo", "path", res.Path, "err", err)
			}
		}
	}()

	started := time.Now()
	pm, err := parser.ParseFile(res.Path)
	if err != nil {
		return 0, fmt.Errorf("parse %s: %w", res.Path, err)
	}

	pm.Match.DemoSource = job.Source
	pm.Match.ShareCode = job.ShareCode
	if pm.Match.PlayedAt.IsZero() {
		pm.Match.PlayedAt = job.EnqueuedAt
	}

	matchID, err := w.db.InsertParsedMatch(jobCtx, pm)
	if err != nil {
		return 0, fmt.Errorf("persist match: %w", err)
	}

	// Invalidate caches for every player in the match so the next read recomputes.
	if w.cache != nil {
		keys := make([]string, 0, len(pm.Players))
		for _, p := range pm.Players {
			keys = append(keys, cache.ProfileKey(p.SteamID64))
		}
		_ = w.cache.Delete(jobCtx, keys...)
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

// setStatus records a job status transition. It uses its own short-lived context
// so a failed/timed-out job is still recorded, and never fails the job over a
// status-write error.
func (w *worker) setStatus(id, status string, matchID *int64, errMsg string) {
	if w.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := w.db.SetJobStatus(ctx, id, status, matchID, errMsg); err != nil {
		w.log.Warn("could not update job status", "jobId", id, "err", err)
	}
}
