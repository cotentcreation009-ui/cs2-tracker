// Command api serves the HTTP API. It connects to Postgres (running migrations
// on boot), Redis (queue + cache) and the Steam Web API, then serves until it
// receives an interrupt.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/cs2tracker/server/internal/api"
	"github.com/cs2tracker/server/internal/cache"
	"github.com/cs2tracker/server/internal/config"
	"github.com/cs2tracker/server/internal/db"
	"github.com/cs2tracker/server/internal/leetify"
	"github.com/cs2tracker/server/internal/queue"
	"github.com/cs2tracker/server/internal/steam"
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
	log.Info("database ready, migrations applied")

	steamClient := steam.New(cfg.SteamAPIKey)
	if !steamClient.HasKey() {
		log.Warn("no STEAM_API_KEY set — vanity resolution and identity hydration are disabled until provided")
	}

	leetifyClient := leetify.New(cfg.LeetifyBaseURL, cfg.LeetifyAPIKey)

	// Redis-backed queue + cache are best-effort: the API still serves reads if
	// Redis is down, just without ingest/caching.
	var q *queue.Queue
	if qq, err := queue.Connect(cfg.RedisURL, cfg.DemoQueueKey); err != nil {
		log.Warn("queue unavailable", "err", err)
	} else if err := qq.Ping(ctx); err != nil {
		log.Warn("queue ping failed", "err", err)
		_ = qq.Close()
	} else {
		q = qq
		defer q.Close()
	}

	var c *cache.Cache
	if cc, err := cache.Connect(cfg.RedisURL, cfg.CacheTTL); err != nil {
		log.Warn("cache unavailable", "err", err)
	} else {
		c = cc
		defer c.Close()
	}

	srv := api.NewServer(cfg, database, steamClient, leetifyClient, q, c, log)
	httpSrv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           srv.Router(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Info("api listening", "addr", cfg.HTTPAddr)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("http server error", "err", err)
			stop()
		}
	}()

	<-ctx.Done()
	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return httpSrv.Shutdown(shutdownCtx)
}
