// Command worker consumes parse jobs from the queue and runs each through the
// internal/worker package, which parses the demo once, persists the results,
// invalidates caches and records job status. It is stateless and horizontally
// scalable: run as many replicas as you have parsing throughput for.
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/cs2tracker/server/internal/blob"
	"github.com/cs2tracker/server/internal/cache"
	"github.com/cs2tracker/server/internal/config"
	"github.com/cs2tracker/server/internal/db"
	"github.com/cs2tracker/server/internal/demosource"
	"github.com/cs2tracker/server/internal/queue"
	"github.com/cs2tracker/server/internal/worker"
)

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

	w := worker.New(database, c, workDir, cfg.DeleteRawDemo, cfg.JobTimeout, log)

	// Attach object storage so the worker can pull browser-direct (GCS) uploads.
	if gcs, err := blob.NewGCS(ctx, cfg.DemoGCSBucket, cfg.DemoGCSCredentials); err != nil {
		log.Warn("object storage unavailable; gcs demo jobs will fail", "err", err)
	} else if gcs != nil {
		w.Blob = gcs
		w.MaxDemoBytes = cfg.DemoMaxBytes
		defer gcs.Close()
		log.Info("worker object-storage enabled", "bucket", cfg.DemoGCSBucket)
	}

	log.Info("worker started",
		"queue", cfg.DemoQueueKey, "workDir", workDir, "concurrency", cfg.WorkerConcurrency)

	// Blocks until ctx is cancelled and in-flight jobs drain.
	w.Run(ctx, q, cfg.WorkerConcurrency)
	log.Info("worker shutting down")
	return nil
}
