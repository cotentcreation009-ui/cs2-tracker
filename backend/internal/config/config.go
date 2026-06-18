// Package config loads runtime configuration from the environment. Every
// service (api, worker, CLIs) builds its Config the same way so behaviour stays
// consistent across the stack. Values come from real environment variables in
// production/containers; for local development a .env file is loaded best-effort.
package config

import (
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/joho/godotenv"
)

// Config is the fully-resolved configuration for the backend services.
type Config struct {
	// HTTP
	HTTPAddr    string   // address the API server binds to, e.g. ":8080"
	CORSOrigins []string // allowed browser origins for the API

	// Datastores
	DatabaseURL string // postgres connection string (pgx format)
	RedisURL    string // redis connection string, e.g. redis://localhost:6379/0

	// Steam Web API
	SteamAPIKey string // key from https://steamcommunity.com/dev/apikey (optional until provided)

	// Demo pipeline
	DemoQueueKey  string        // redis list key used as the parse job queue
	DemoWorkDir   string        // scratch dir where demos are downloaded/extracted before parsing
	DeleteRawDemo bool          // delete the raw .dem after a successful parse (parse-once policy)
	JobTimeout    time.Duration // max time a single parse job may run

	// Caching
	CacheTTL time.Duration // TTL for cached aggregate payloads in redis
}

// Load reads configuration from the environment, applying sensible defaults so
// the services start cleanly in local development. It never fails on a missing
// Steam key: that is provided later and validated at call time instead.
func Load() (*Config, error) {
	// Best-effort .env load from the working dir and up to two parents. Each path
	// is loaded independently because godotenv.Load stops at the first missing
	// file (so passing all three at once would bail before reaching a parent).
	// godotenv never overrides already-set environment variables, so real env
	// still wins.
	for _, p := range []string{".env", "../.env", "../../.env"} {
		_ = godotenv.Load(p)
	}

	cfg := &Config{
		HTTPAddr:      getEnv("HTTP_ADDR", ":8080"),
		CORSOrigins:   splitAndTrim(getEnv("CORS_ORIGINS", "http://localhost:3000")),
		DatabaseURL:   getEnv("DATABASE_URL", "postgres://cs2:cs2@localhost:5432/cs2tracker?sslmode=disable"),
		RedisURL:      getEnv("REDIS_URL", "redis://localhost:6379/0"),
		SteamAPIKey:   getEnv("STEAM_API_KEY", ""),
		DemoQueueKey:  getEnv("DEMO_QUEUE_KEY", "cs2:demos:parse"),
		DemoWorkDir:   getEnv("DEMO_WORK_DIR", os.TempDir()),
		DeleteRawDemo: getBool("DELETE_RAW_DEMO", true),
		JobTimeout:    getDuration("JOB_TIMEOUT", 10*time.Minute),
		CacheTTL:      getDuration("CACHE_TTL", 5*time.Minute),
	}

	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("config: DATABASE_URL is required")
	}
	return cfg, nil
}

// HasSteamKey reports whether a Steam Web API key has been configured. Handlers
// that need the key should check this and return a clear error otherwise.
func (c *Config) HasSteamKey() bool { return c.SteamAPIKey != "" }

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

func getBool(key string, fallback bool) bool {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		b, err := strconv.ParseBool(v)
		if err == nil {
			return b
		}
	}
	return fallback
}

func getDuration(key string, fallback time.Duration) time.Duration {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		d, err := time.ParseDuration(v)
		if err == nil {
			return d
		}
	}
	return fallback
}

func splitAndTrim(s string) []string {
	var out []string
	start := 0
	for i := 0; i <= len(s); i++ {
		if i == len(s) || s[i] == ',' {
			part := s[start:i]
			// trim spaces
			for len(part) > 0 && part[0] == ' ' {
				part = part[1:]
			}
			for len(part) > 0 && part[len(part)-1] == ' ' {
				part = part[:len(part)-1]
			}
			if part != "" {
				out = append(out, part)
			}
			start = i + 1
		}
	}
	return out
}
