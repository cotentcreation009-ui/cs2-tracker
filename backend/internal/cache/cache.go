// Package cache is a thin JSON cache over Redis for hot aggregate payloads
// (e.g. a player's profile). Reads check the cache first; the worker invalidates
// a player's key after ingesting a new match so the next read recomputes.
package cache

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// Cache wraps a Redis client with a default TTL.
type Cache struct {
	rdb *redis.Client
	ttl time.Duration
}

// Connect dials Redis for caching.
func Connect(redisURL string, ttl time.Duration) (*Cache, error) {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("cache: parse redis url: %w", err)
	}
	return &Cache{rdb: redis.NewClient(opt), ttl: ttl}, nil
}

// Close releases the Redis client.
func (c *Cache) Close() error { return c.rdb.Close() }

// GetJSON loads key into dst. It returns false (no error) on a cache miss.
func (c *Cache) GetJSON(ctx context.Context, key string, dst any) (bool, error) {
	b, err := c.rdb.Get(ctx, key).Bytes()
	if errors.Is(err, redis.Nil) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := json.Unmarshal(b, dst); err != nil {
		return false, err
	}
	return true, nil
}

// SetJSON stores v at key with the default TTL.
func (c *Cache) SetJSON(ctx context.Context, key string, v any) error {
	return c.SetJSONTTL(ctx, key, v, c.ttl)
}

// SetJSONTTL stores v at key with an explicit TTL (used for live third-party
// data, which gets a longer TTL than our own recomputed aggregates).
func (c *Cache) SetJSONTTL(ctx context.Context, key string, v any, ttl time.Duration) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return c.rdb.Set(ctx, key, b, ttl).Err()
}

// Delete removes keys (used to invalidate after a write).
func (c *Cache) Delete(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	return c.rdb.Del(ctx, keys...).Err()
}

// ProfileKey is the canonical cache key for a player's profile payload.
func ProfileKey(steamID uint64) string {
	return fmt.Sprintf("cs2:profile:%d", steamID)
}

// Cache keys for live third-party payloads (TTL-expired, not invalidated).
func LeetifyKey(steamID uint64) string { return fmt.Sprintf("cs2:leetify:%d", steamID) }
func FaceitKey(steamID uint64) string  { return fmt.Sprintf("cs2:faceit:%d", steamID) }
func SteamExtrasKey(steamID uint64) string {
	return fmt.Sprintf("cs2:steamextras:%d", steamID)
}
