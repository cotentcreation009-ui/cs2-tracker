package api

import (
	"context"
	"time"

	"github.com/cs2tracker/server/internal/queue"
)

// Queueing our own demo parses for accounts whose owners connected them.
//
// Only connected accounts are parsed, and that is a deliberate line rather
// than a technical limit. Their owner authorised us to read their match
// history; nobody else did. It also happens to be the only place we reliably
// have fresh share codes, so the ethical and practical boundaries agree.
//
// Valve deletes demos after about a month, so this is a race with a deadline:
// a match not parsed within the window can never be parsed at all.

const (
	// How many demos one sweep will queue for a single player. A demo is a
	// ~300MB download and tens of CPU-seconds; a newly connected account with
	// a long history must not swamp the box in one go. The rest arrive on
	// later sweeps.
	maxParseEnqueuePerPlayer = 3
	// Valve's retention. Older matches are unparseable, so queueing them would
	// spend a download slot on a guaranteed 404.
	demoRetention = 30 * 24 * time.Hour
)

// enqueueParses queues demo parses for a connected player's recent matches
// that we have not parsed yet. Best-effort throughout: this is an enrichment
// pass, and no failure here may affect the sync that triggered it.
func (s *Server) enqueueParses(ctx context.Context, steamID uint64) {
	if s.queue == nil || s.bridge == nil {
		return
	}
	// Only for accounts whose owner connected them.
	chain, err := s.db.AuthChainFor(ctx, steamID)
	if err != nil || chain.Status != "active" {
		return
	}

	rows, err := s.db.PlayerMatches(ctx, steamID, 40)
	if err != nil {
		s.log.Warn("parse queue: reading matches failed", "steam", steamID, "err", err)
		return
	}

	cutoff := time.Now().Add(-demoRetention)
	var codes []string
	byCode := map[string]time.Time{}
	for _, r := range rows {
		// The share code lives on the match row we fetched it by; without one
		// there is nothing to resolve a demo from.
		if r.ShareCode == "" || r.FinishedAt.Before(cutoff) {
			continue
		}
		if _, dup := byCode[r.ShareCode]; dup {
			continue
		}
		byCode[r.ShareCode] = r.FinishedAt
		codes = append(codes, r.ShareCode)
	}
	if len(codes) == 0 {
		return
	}

	done, err := s.db.ParsedShareCodes(ctx, codes)
	if err != nil {
		s.log.Warn("parse queue: dedupe failed", "steam", steamID, "err", err)
		return
	}

	queued := 0
	for _, c := range codes {
		if queued >= maxParseEnqueuePerPlayer {
			break
		}
		if done[c] {
			continue
		}
		if _, err := s.queue.Enqueue(ctx, queue.Job{
			Type:      queue.JobParseDemo,
			Source:    "valve",
			ShareCode: c,
		}); err != nil {
			s.log.Warn("parse queue: enqueue failed", "code", c, "err", err)
			break
		}
		queued++
	}
	if queued > 0 {
		s.log.Info("queued our own demo parses",
			"steam", steamID, "queued", queued, "candidates", len(codes))
	}
}
