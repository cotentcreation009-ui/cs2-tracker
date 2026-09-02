package api

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
)

// The match-report bridge, served.
//
// Leetify answers profile lookups only for accounts registered with them. Their
// match reports still carry a row for every player in the lobby, so a player
// they will not describe can be assembled from the matches they played.
//
// The endpoint reads what is already stored and returns immediately. Filling a
// player in costs about a minute against a rate limit shared by the whole site,
// so it happens in the background and the next request sees the result. A page
// that waited would be a page that hangs.

const (
	// How long a player's assembled telemetry is considered current enough not
	// to bother the sources again. A match that finished during this window
	// simply appears on the next view.
	bridgeFreshFor = 30 * time.Minute
	// Below this many stored matches a player is worth topping up even if the
	// last attempt was recent — a profile with two matches is barely a profile.
	bridgeThinBelow = 4
)

// handleBridge serves a player's assembled match telemetry.
//
// Always answers from storage. When the stored set looks thin or stale it also
// kicks off a background sync, so the answer improves on a later view rather
// than making this one wait.
func (s *Server) handleBridge(w http.ResponseWriter, r *http.Request) {
	if s.bridge == nil {
		// Feature-flagged off, or no Leetify client. Not an error: callers
		// treat an absent bridge exactly like a player with nothing stored.
		writeJSON(w, http.StatusOK, map[string]any{"enabled": false})
		return
	}
	id, err := strconv.ParseUint(chi.URLParam(r, "steamid"), 10, 64)
	if err != nil || id == 0 {
		writeError(w, http.StatusBadRequest, "invalid SteamID64")
		return
	}

	agg, rows, err := s.bridge.Aggregated(r.Context(), id, 100)
	if err != nil {
		s.serverError(w, "bridge aggregate", err)
		return
	}

	// Our own parsed-demo stats for this player, if any exist yet.
	parsed, perr := s.db.ParsedRowsFor(r.Context(), id, 100)
	if perr != nil {
		s.log.Warn("bridge: reading our parsed rows failed", "steam", id, "err", perr)
	}

	if s.shouldSync(r.Context(), id, agg.Matches) {
		s.syncBridgeAsync(id)
	}

	// Cache briefly: a background sync only lands new rows every so often, and
	// this endpoint is read on every profile view.
	// Whether this account's owner connected their match history. The page
	// must say so: an already-connected profile inviting its owner to connect
	// reads as though the connection failed, and a visitor deserves to know
	// the difference between assembled-from-lobbies and owner-authorised data.
	connected := false
	if chain, cerr := s.db.AuthChainFor(r.Context(), id); cerr == nil {
		connected = chain.Status == "active"
	}

	setEdgeCache(w, 60*time.Second)
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled":   true,
		"connected": connected,
		// Converted to the units the scorer expects — Leetify's profile and
		// match surfaces disagree, and the conversion belongs on this side.
		"aggregate": agg.ProfileScale(),
		"span": map[string]any{
			"newest": nullableTime(agg.Newest),
			"oldest": nullableTime(agg.Oldest),
		},
		"matches": rows,
		// OUR numbers, from demos we parsed. Served under their own key and
		// never merged into the Leetify rows: the page has to be able to tell
		// a visitor which company measured what.
		"parsed": parsed,
	})
}

// shouldSync decides whether to spend rate budget on this player now.
func (s *Server) shouldSync(ctx context.Context, steamID uint64, have int) bool {
	if s.cache == nil {
		return have < bridgeThinBelow
	}
	// One attempt per player per window, whether or not it found anything —
	// otherwise a player nobody has data for is re-swept on every page view.
	key := "cs2:bridge:tried:" + strconv.FormatUint(steamID, 10)
	var tried bool
	if hit, _ := s.cache.GetJSON(ctx, key, &tried); hit {
		return false
	}
	window := bridgeFreshFor
	if have < bridgeThinBelow {
		// Thin profiles are worth retrying sooner: the sources may have had
		// nothing a moment ago and have something now.
		window = bridgeFreshFor / 3
	}
	_ = s.cache.SetJSONTTL(ctx, key, true, window)
	return true
}

// syncBridgeAsync runs a sync detached from the request.
func (s *Server) syncBridgeAsync(steamID uint64) {
	if s.bridge == nil || s.log == nil {
		return
	}
	go func() {
		// chi's Recoverer covers handler goroutines, not this one: without a
		// recover here a surprise from a source would take the process down.
		defer func() {
			if rec := recover(); rec != nil {
				s.log.Error("bridge sync panicked", "steam", steamID, "err", rec)
			}
		}()
		// Generous: a full sync is rate-limited to roughly a minute, and it
		// must not be cut short halfway through spending that budget.
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()

		res, err := s.bridge.Sync(ctx, steamID)
		if err != nil {
			s.log.Warn("bridge sync failed", "steam", steamID, "err", err)
			return
		}
		// New matches mean new demos worth parsing ourselves — but only for
		// accounts whose owner connected them, which enqueueParses checks.
		// Valve deletes demos after a month, so this cannot wait for a
		// nightly job.
		if res.Fetched > 0 {
			s.enqueueParses(ctx, steamID)
		}
		// Rank enrichment applies to every bridged profile, connected or not:
		// the matches are already stored, and this is what puts a number in
		// the rank column instead of a dash.
		s.fillRanks(ctx, steamID)
		if res.Fetched > 0 || res.Failed > 0 || res.Absent > 0 {
			s.log.Info("bridge sync", "steam", steamID,
				"offered", res.Offered, "new", res.New,
				"fetched", res.Fetched, "absent", res.Absent, "failed", res.Failed)
		}
	}()
}

// nullableTime renders a zero time as null rather than year 1, so the UI can
// tell "no matches" from "a match in the distant past".
func nullableTime(t time.Time) any {
	if t.IsZero() || t.Year() < 1972 {
		return nil
	}
	return t.UTC().Format(time.RFC3339)
}

// ratio is wins over total as a 0..1 fraction, 0 when the total is nothing —
// the shape the Friends panel already reads from the Leetify path.
func ratio(wins, total int) float64 {
	if total <= 0 {
		return 0
	}
	return float64(wins) / float64(total)
}
