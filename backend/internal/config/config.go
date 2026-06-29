// Package config loads runtime configuration from the environment. Every
// service (api, worker, CLIs) builds its Config the same way so behaviour stays
// consistent across the stack. Values come from real environment variables in
// production/containers; for local development a .env file is loaded best-effort.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

// Config is the fully-resolved configuration for the backend services.
type Config struct {
	// HTTP
	HTTPAddr    string   // address the API server binds to, e.g. ":8080"
	CORSOrigins []string // allowed browser origins for the API
	// InternalAPISecret, when set, gates every route except /api/health behind a
	// matching X-Internal-Token header. Used when the backend is exposed on a
	// public host (e.g. Fly.io) and only the trusted frontend should reach it.
	InternalAPISecret string

	// Datastores
	DatabaseURL string // postgres connection string (pgx format)
	RedisURL    string // redis connection string, e.g. redis://localhost:6379/0

	// Steam Web API
	SteamAPIKey string // key from https://steamcommunity.com/dev/apikey (optional until provided)

	// Leetify public API (keyless; key optional for higher rate limits)
	LeetifyBaseURL string
	LeetifyAPIKey  string

	// FACEIT Data API (requires a free key from https://developers.faceit.com)
	FaceitBaseURL string
	FaceitAPIKey  string

	// AI interpretation. Preferred provider is Vertex AI (Gemini) — on GCE it
	// uses the VM's service account (no key, billed to the GCP project). Anthropic
	// is an optional fallback. When neither is configured the AI-read endpoint
	// reports "not configured".
	VertexProject  string // GCP project for Vertex; auto-detected from GCE metadata when empty
	VertexLocation string // Vertex region, e.g. us-central1
	VertexModel    string // Gemini model id, e.g. gemini-2.0-flash-001

	AnthropicAPIKey string
	AnthropicModel  string

	// Demo pipeline
	DemoQueueKey      string        // redis list key used as the parse job queue
	DemoWorkDir       string        // scratch dir where demos are downloaded/extracted before parsing
	DeleteRawDemo     bool          // delete the raw .dem after a successful parse (parse-once policy)
	JobTimeout        time.Duration // max time a single parse job may run
	WorkerConcurrency int           // number of jobs a single worker parses in parallel

	// Demo direct-upload object storage (GCS). When DemoGCSBucket is set, the API
	// signs direct-to-bucket upload URLs so the browser PUTs a .dem straight to
	// the bucket (bypassing our servers and Cloudflare's body-size limit) and the
	// worker pulls it back to parse. When unset, demos fall back to the
	// through-server multipart upload (capped at demoMaxUploadBytes).
	DemoGCSBucket      string        // bucket name; empty disables direct upload
	DemoGCSCredentials string        // path to a service-account JSON key (empty = Application Default Credentials)
	DemoMaxBytes       int64         // hard cap for a single direct (GCS) upload
	DemoURLTTL         time.Duration // signed upload-URL lifetime

	// Caching
	CacheTTL         time.Duration // TTL for cached aggregate payloads in redis
	ExternalCacheTTL time.Duration // TTL for cached live third-party payloads (Leetify/FACEIT/steam-extras)

	// Rate limiting (per client IP). RateLimitRPS <= 0 disables it.
	RateLimitRPS   float64 // sustained requests per second
	RateLimitBurst int     // burst capacity
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
		HTTPAddr:          getEnv("HTTP_ADDR", ":8080"),
		CORSOrigins:       splitAndTrim(getEnv("CORS_ORIGINS", "http://localhost:3000")),
		InternalAPISecret: getEnv("INTERNAL_API_SECRET", ""),
		DatabaseURL:       getEnv("DATABASE_URL", "postgres://cs2:cs2@localhost:5432/cs2tracker?sslmode=disable"),
		RedisURL:          getEnv("REDIS_URL", "redis://localhost:6379/0"),
		SteamAPIKey:       getEnv("STEAM_API_KEY", ""),
		LeetifyBaseURL:    getEnv("LEETIFY_BASE_URL", "https://api-public.cs-prod.leetify.com"),
		LeetifyAPIKey:     getEnv("LEETIFY_API_KEY", ""),
		FaceitBaseURL:     getEnv("FACEIT_BASE_URL", "https://open.faceit.com/data/v4"),
		FaceitAPIKey:      getEnv("FACEIT_API_KEY", ""),
		VertexProject:     getEnv("VERTEX_PROJECT", getEnv("GCP_PROJECT", getEnv("GOOGLE_CLOUD_PROJECT", ""))),
		VertexLocation:    getEnv("VERTEX_LOCATION", "us-central1"),
		VertexModel:       getEnv("VERTEX_MODEL", "gemini-2.0-flash-001"),
		AnthropicAPIKey:   getEnv("ANTHROPIC_API_KEY", ""),
		AnthropicModel:    getEnv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001"),
		DemoQueueKey:      getEnv("DEMO_QUEUE_KEY", "cs2:demos:parse"),
		DemoWorkDir:       getEnv("DEMO_WORK_DIR", os.TempDir()),
		DeleteRawDemo:     getBool("DELETE_RAW_DEMO", true),
		JobTimeout:        getDuration("JOB_TIMEOUT", 10*time.Minute),
		WorkerConcurrency: getInt("WORKER_CONCURRENCY", 1),

		DemoGCSBucket:      getEnv("DEMO_GCS_BUCKET", ""),
		DemoGCSCredentials: getEnv("DEMO_GCS_CREDENTIALS", getEnv("GOOGLE_APPLICATION_CREDENTIALS", "")),
		DemoMaxBytes:       int64(getInt("DEMO_MAX_MB", 600)) << 20,
		DemoURLTTL:         getDuration("DEMO_URL_TTL", 15*time.Minute),
		CacheTTL:           getDuration("CACHE_TTL", 5*time.Minute),
		ExternalCacheTTL:   getDuration("EXTERNAL_CACHE_TTL", 15*time.Minute),
		RateLimitRPS:       getFloat("RATE_LIMIT_RPS", 10),
		RateLimitBurst:     getInt("RATE_LIMIT_BURST", 20),
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
	// Trim surrounding whitespace so a key pasted from a dashboard with a stray
	// space/newline (e.g. FACEIT_API_KEY) doesn't silently corrupt a header.
	if v, ok := os.LookupEnv(key); ok {
		if v = strings.TrimSpace(v); v != "" {
			return v
		}
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

func getFloat(key string, fallback float64) float64 {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return fallback
}

func getInt(key string, fallback int) int {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
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
