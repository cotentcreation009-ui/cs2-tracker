// Package cache is a thin JSON cache over Redis for hot aggregate payloads
// (e.g. a player's profile). Reads check the cache first; the worker invalidates
// a player's key after ingesting a new match so the next read recomputes.
package cache

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
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
// LeetifyKey caches a player's live Leetify profile. v2: per-game kills/deaths,
// FACEIT elo and rating movement were added to the payload — the bump drops
// old-shape entries the moment this deploys (v3: FACEIT-authoritative elo),
// instead of serving matches with no K-D until they age out.
func LeetifyKey(steamID uint64) string { return fmt.Sprintf("cs2:leetify:v3:%d", steamID) }
func FaceitKey(steamID uint64) string  { return fmt.Sprintf("cs2:faceit:%d", steamID) }

// InventoryKey caches a player's aggregated CS2 skin inventory showcase.
// v2: the whole item list ships (not the top 60) and items carry tradable, so
// the panel can filter by category and explain an unpriced item — old entries
// would filter over a truncated list. v3: prices are the median of real sales
// where volume allows, so old entries carry figures from a different method.
// v4: a name whose finishes are priced separately (Doppler phases) takes the
// median across them instead of whichever row happened to land last.
// v5: entries carry per-copy detail (stickers, float, seed, inspect payload)
// and stickered/float-bearing copies no longer merge. v6: applied stickers
// carry their own market price.
func InventoryKey(steamID uint64) string { return fmt.Sprintf("cs2:inv:v6:%d", steamID) }

// LeetifyGameKey caches one player's deep scoreboard line for one Leetify game
// (expanded-row stats — ADR/KAST/rating). Immutable once the game finished.
// v2: team scores now derive from per-player rounds-won (the teamScores array
// mis-attributed sides) — the bump flushes boards cached with swapped scores.
// v7: per-player FACEIT elo joined the board (v6: at-match ranks).
func LeetifyGameKey(gameID string, steamID uint64) string {
	return fmt.Sprintf("cs2:leetify:game:v7:%s:%d", strings.ToLower(gameID), steamID)
}

// ProTeamRecentKey caches a team's recent past-series list (schedule only).
func ProTeamRecentKey(teamID string) string { return "cs2:pro:teamrecent2:" + teamID }

// ProSeriesResultKey caches a series' outcome (maps won per team + per-map
// games). v4: "Default-Map" placeholder games are now filtered out — the bump
// flushes entries with the polluted map names instead of waiting out 12h.
func ProSeriesResultKey(seriesID string) string { return "cs2:pro:seriesresult4:" + seriesID }

// ProTeamRosterKey caches a team's current player nicknames.
func ProTeamRosterKey(teamID string) string { return "cs2:pro:roster2:" + teamID }

// The FACEIT leaderboard for one region — a real ranking, and the only list on
// the spotlight rails that claims to be one.
// Counter-Strike's official Regional Standings — Valve regenerates them about
// monthly, so this is cached hard.
// ProStandingsKey caches Valve's ENTIRE Regional Standings table (not just the
// top 20 — the team page needs rows further down). Versioned because the
// cached payload changed shape.
func ProStandingsKey() string { return "cs2:pro:standings2" }

// Learned org-name -> GRID team id pairings, accumulated from every board poll
// so a ranked team becomes linkable the first time we see it play.
func ProTeamIndexKey() string { return "cs2:pro:teamindex1" }

// ProTeamLookupKey marks that we have already asked GRID to resolve an org
// name, so a name GRID does not know is not re-asked on every page view.
func ProTeamLookupKey(key string) string { return "cs2:pro:tlookup:" + key }

func ProFaceitRankingKey(region string) string {
	return "cs2:pro:faceitrank1:" + strings.ToLower(region)
}

// ProSeriesDetailKey caches a full on-demand MatchState for a series that has
// aged out of the live board (historical results).
func ProSeriesDetailKey(seriesID string) string { return "cs2:pro:seriesdetail2:" + seriesID }

// ProPlayerImgKey caches a pro player's Liquipedia photo bytes by nickname.
func ProPlayerImgKey(nick string) string { return "cs2:pro:pimg:" + strings.ToLower(nick) }

// ProPlayerCardKey caches a pro player's Liquipedia identity card (real name,
// country, role, SteamID64) by nickname. Versioned: cards are held for 14 days,
// so adding a field to the payload needs a new key or the old, thinner cards
// keep answering for a fortnight.
func ProPlayerCardKey(nick string) string { return "cs2:pro:pcard2:" + strings.ToLower(nick) }

// ProPlayerStatsKey caches a player's official GRID aggregates per window.
func ProPlayerStatsKey(playerID, window string) string {
	return "cs2:pro:pstats2:" + playerID + ":" + window
}
func SteamExtrasKey(steamID uint64) string {
	return fmt.Sprintf("cs2:steamextras:%d", steamID)
}
