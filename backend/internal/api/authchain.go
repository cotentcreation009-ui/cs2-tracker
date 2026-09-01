package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"time"

	"github.com/cs2tracker/server/internal/leetify"
	"github.com/cs2tracker/server/internal/valvechain"
)

// Connecting an account's match history — the "chain" endpoints.
//
// The owner hands over two things once: the match-history authentication code
// Steam issues them, and one recent share code. From then on the chain walker
// discovers every future match automatically. This is Leetify's and csstats'
// onboarding mechanism, done first-party.
//
// The API sits behind the internal token like everything else, so today it is
// operator-only (curl from the VM). The public "Connect your account" flow
// will front it later; the contract is already shaped for that.

var authCodeRe = regexp.MustCompile(`^[A-Z0-9]{4}-[A-Z0-9]{5}-[A-Z0-9]{4}$`)

// chainPollEvery is how often the background poller walks each active chain.
// A new match surfaces one poll after Valve records it — minutes, not weeks.
const chainPollEvery = 10 * time.Minute

// handleChainConnect registers (or re-seeds) an account's chain.
//
// The pair is verified against Valve before anything is stored: a mistyped
// auth code or a stale seed fails HERE, loudly, with a message naming which of
// the two the owner must fix — not silently three days later in a poller log.
func (s *Server) handleChainConnect(w http.ResponseWriter, r *http.Request) {
	if s.chainValve == nil {
		writeError(w, http.StatusServiceUnavailable,
			"chain walking not configured (needs STEAM_API_KEY and the bridge)")
		return
	}
	id, ok := steamIDParam(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid SteamID64")
		return
	}
	var body struct {
		AuthCode  string `json:"authCode"`
		ShareCode string `json:"shareCode"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "body must be JSON with authCode and shareCode")
		return
	}
	if !authCodeRe.MatchString(body.AuthCode) {
		writeError(w, http.StatusBadRequest,
			"authCode must look like XXXX-XXXXX-XXXX (from Steam's match-history help page)")
		return
	}
	if !leetify.ValidShareCode(body.ShareCode) {
		writeError(w, http.StatusBadRequest,
			"shareCode must look like CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx")
		return
	}

	// One live probe settles whether the pair works before it is stored.
	_, err := s.chainValve.Next(r.Context(), id, body.AuthCode, body.ShareCode)
	switch {
	case err == nil, errors.Is(err, valvechain.ErrCaughtUp):
		// Either "here is the next code" or "that IS the newest" — both prove
		// the pair is valid.
	case errors.Is(err, valvechain.ErrBadAuth):
		writeError(w, http.StatusUnprocessableEntity,
			"Valve rejected the auth code — regenerate it on Steam's help page")
		return
	case errors.Is(err, valvechain.ErrStaleCode):
		writeError(w, http.StatusUnprocessableEntity,
			"Valve rejected the share code — use one from the game client's last 8 (Watch → Your Matches); codes older than a month are refused")
		return
	default:
		s.serverError(w, "chain verification", err)
		return
	}

	if err := s.db.UpsertAuthChain(r.Context(), id, body.AuthCode, body.ShareCode); err != nil {
		s.serverError(w, "chain store", err)
		return
	}
	// Catch up right away in the background — the whole point of connecting.
	s.syncBridgeAsync(id)
	writeJSON(w, http.StatusOK, map[string]any{
		"connected": true,
		"note":      "chain verified against Valve; catch-up sync started",
	})
}

// handleChainStatus reports a connected account's walking state — never the
// auth code itself, which must not leave the backend.
func (s *Server) handleChainStatus(w http.ResponseWriter, r *http.Request) {
	id, ok := steamIDParam(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid SteamID64")
		return
	}
	chain, err := s.db.AuthChainFor(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"connected": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"connected": true,
		"status":    chain.Status,
		"headCode":  chain.HeadCode,
		"walkedAt":  nullableTime(chain.WalkedAt),
	})
}

// chainPoller walks every active chain on a fixed cadence, independent of
// page views — freshness must not depend on someone happening to look.
//
// Runs while the process lives; each round is sequential and rate-limited by
// the valvechain limiter, so fifty accounts is under a minute of API time.
func (s *Server) chainPoller(ctx context.Context) {
	t := time.NewTicker(chainPollEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		// Housekeeping first: fetched and hopeless retry rows drop away, so
		// the retry set stays a handful of rows per active player.
		if err := s.db.PruneRetryCodes(ctx); err != nil {
			s.log.Warn("chain poller: prune failed", "err", err)
		}
		chains, err := s.db.ActiveAuthChains(ctx, 100)
		if err != nil {
			s.log.Warn("chain poller: listing failed", "err", err)
			continue
		}
		for _, c := range chains {
			// Sync pulls from all sources — the chain walk happens inside it,
			// and everything downstream (dedupe, caps, rate limits) applies.
			if _, err := s.bridge.Sync(ctx, c.SteamID); err != nil {
				s.log.Warn("chain poller: sync failed", "steam", c.SteamID, "err", err)
			}
		}
	}
}
