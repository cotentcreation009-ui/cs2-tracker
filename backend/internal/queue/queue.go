// Package queue is a minimal, durable-enough Redis job queue for the demo
// pipeline. The API enqueues parse jobs and returns immediately; stateless
// worker(s) block-pop jobs and parse off the request path. A Redis list with
// LPUSH/BRPOP gives us FIFO delivery and lets us scale workers horizontally —
// the queue is intentionally simple now and called out in the roadmap as the
// thing to upgrade (visibility timeouts, retries, dead-letter) as we scale.
package queue

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// JobType enumerates the kinds of work the worker understands.
type JobType string

const (
	// JobParseDemo asks a worker to parse a demo and persist the trusted
	// career/match results (the player-stats pipeline).
	JobParseDemo JobType = "parse_demo"
	// JobParseReplay asks a worker to parse a user-uploaded demo into the
	// normalized replay JSON (positions/events) for the private demo-analysis
	// library. Result goes to demo_results, never to career/leaderboard data.
	JobParseReplay JobType = "parse_replay"
)

// Job is a unit of work on the queue.
type Job struct {
	ID         string    `json:"id"`
	Type       JobType   `json:"type"`
	Source     string    `json:"source,omitempty"`    // local | valve | faceit | gcs | upload
	DemoPath   string    `json:"demoPath,omitempty"`  // local file path to a .dem
	DemoURL    string    `json:"demoUrl,omitempty"`   // remote .dem(.bz2) URL (e.g. Valve GOTV)
	ObjectKey  string    `json:"objectKey,omitempty"` // object-storage key (Source=="gcs")
	ShareCode  string    `json:"shareCode,omitempty"` // match-sharing code, if known
	EnqueuedAt time.Time `json:"enqueuedAt"`
}

// Queue is a handle to the Redis-backed job queue.
type Queue struct {
	rdb *redis.Client
	key string
}

// Connect dials Redis and returns a Queue bound to the given list key.
func Connect(redisURL, key string) (*Queue, error) {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("queue: parse redis url: %w", err)
	}
	return &Queue{rdb: redis.NewClient(opt), key: key}, nil
}

// Ping verifies connectivity.
func (q *Queue) Ping(ctx context.Context) error { return q.rdb.Ping(ctx).Err() }

// Close releases the Redis client.
func (q *Queue) Close() error { return q.rdb.Close() }

// Enqueue pushes a job. It assigns an ID and timestamp if missing.
func (q *Queue) Enqueue(ctx context.Context, job Job) (Job, error) {
	if job.ID == "" {
		job.ID = newID()
	}
	if job.EnqueuedAt.IsZero() {
		job.EnqueuedAt = time.Now().UTC()
	}
	b, err := json.Marshal(job)
	if err != nil {
		return job, err
	}
	if err := q.rdb.LPush(ctx, q.key, b).Err(); err != nil {
		return job, fmt.Errorf("queue: lpush: %w", err)
	}
	return job, nil
}

// Dequeue blocks up to timeout for the next job. It returns (nil, nil) on
// timeout so callers can loop and check for shutdown.
func (q *Queue) Dequeue(ctx context.Context, timeout time.Duration) (*Job, error) {
	res, err := q.rdb.BRPop(ctx, timeout, q.key).Result()
	if err == redis.Nil {
		return nil, nil // timed out, no job
	}
	if err != nil {
		return nil, fmt.Errorf("queue: brpop: %w", err)
	}
	// res = [key, payload]
	var job Job
	if err := json.Unmarshal([]byte(res[1]), &job); err != nil {
		return nil, fmt.Errorf("queue: unmarshal job: %w", err)
	}
	return &job, nil
}

// Depth returns the number of pending jobs (useful for health/metrics).
func (q *Queue) Depth(ctx context.Context) (int64, error) {
	return q.rdb.LLen(ctx, q.key).Result()
}

func newID() string {
	var b [12]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
