package api

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/cs2tracker/server/internal/cache"
	"github.com/cs2tracker/server/internal/steaminv"
)

// Steam's inventory budget is small enough that a request arriving mid-throttle
// simply cannot be served in time. Without somewhere to put that intent, the
// request accomplished nothing: the visitor saw "unavailable", no snapshot was
// written, and the next visitor to the same profile got exactly the same
// nothing. A profile could stay unreadable indefinitely while being asked for
// constantly.
//
// So a turned-away request queues the profile instead. One worker drains the
// queue at the pace Steam tolerates, and the read lands in the snapshot table
// whether or not anyone is still watching — which is what makes the next view
// a hit.
type backfill struct {
	mu     sync.Mutex
	queued map[uint64]struct{}
	ch     chan uint64
}

// backfillDepth bounds the queue. Past this we drop rather than build a backlog
// longer than the data would stay fresh — at one read per 20s, 200 entries is
// already over an hour of work.
const backfillDepth = 200

func newBackfill() *backfill {
	return &backfill{queued: make(map[uint64]struct{}), ch: make(chan uint64, backfillDepth)}
}

// enqueue asks for a profile to be read soon. Duplicates and overflow are
// dropped: this is best-effort repair, never a promise.
func (b *backfill) enqueue(steamID uint64) {
	b.mu.Lock()
	if _, dup := b.queued[steamID]; dup {
		b.mu.Unlock()
		return
	}
	b.queued[steamID] = struct{}{}
	b.mu.Unlock()

	select {
	case b.ch <- steamID:
	default: // queue full — forget it rather than block a request
		b.mu.Lock()
		delete(b.queued, steamID)
		b.mu.Unlock()
	}
}

func (b *backfill) done(steamID uint64) {
	b.mu.Lock()
	delete(b.queued, steamID)
	b.mu.Unlock()
}

// StartInventoryBackfill drains queued profiles one at a time, waiting out the
// circuit breaker rather than fighting it. Serial by design: the whole point is
// to stay inside the budget that a burst of live requests just exceeded.
func (s *Server) StartInventoryBackfill(ctx context.Context) {
	go func() {
		for {
			var id uint64
			select {
			case <-ctx.Done():
				return
			case id = <-s.invBackfill.ch:
			}
			s.invBackfill.done(id)
			s.fillInventory(ctx, id)

			// pace the next read even if this one failed fast
			select {
			case <-ctx.Done():
				return
			case <-time.After(steaminv.Spacing()):
			}
		}
	}()
}

// fillInventory reads one profile and stores it, retrying only the throttled
// case and only while the breaker says it is worth waiting for.
func (s *Server) fillInventory(ctx context.Context, steamID uint64) {
	for attempt := 0; attempt < 3; attempt++ {
		if d := steaminv.RetryAfter(); d > 0 {
			select {
			case <-ctx.Done():
				return
			case <-time.After(d + time.Second):
			}
		}
		v, err := steaminv.Build(ctx, s.invHTTP, steamID)
		if err == nil {
			if payload, mErr := json.Marshal(v); mErr == nil {
				if sErr := s.db.SaveInventorySnapshot(ctx, steamID, payload); sErr != nil {
					s.log.Warn("backfill snapshot save", "steam_id", steamID, "err", sErr)
					return
				}
			}
			if s.cache != nil {
				_ = s.cache.SetJSONTTL(ctx, cache.InventoryKey(steamID), v, s.cfg.ExternalCacheTTL)
			}
			s.log.Info("backfilled inventory", "steam_id", steamID, "items", v.ItemCount)
			return
		}
		if !errors.Is(err, steaminv.ErrRateLimited) {
			return // private, gone, or broken — retrying won't change it
		}
	}
}
