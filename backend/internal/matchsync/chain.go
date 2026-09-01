package matchsync

import (
	"context"
	"errors"
	"log/slog"

	"github.com/cs2tracker/server/internal/db"
	"github.com/cs2tracker/server/internal/valvechain"
)

// ChainStore is the auth-chain persistence ChainSource needs. *db.DB satisfies it.
type ChainStore interface {
	AuthChainFor(ctx context.Context, steamID uint64) (db.AuthChain, error)
	AdvanceAuthChain(ctx context.Context, steamID uint64, headCode string) error
	MarkAuthChain(ctx context.Context, steamID uint64, status string) error
}

// Walker walks a share-code chain. *valvechain.Client satisfies it.
type Walker interface {
	Walk(ctx context.Context, steamID uint64, authCode, known string, maxSteps int) ([]string, error)
}

// chainMaxSteps caps one walk. A month-dormant account catching up is the
// worst case; sixty steps at a second each is a minute of budget, and the
// next poll continues where this one stopped.
const chainMaxSteps = 60

// ChainSource supplies share codes for accounts whose owners connected their
// match history (auth code + seed). This is the only source that is fresh,
// complete and sanctioned — the other sources exist for everyone else.
type ChainSource struct {
	Store ChainStore
	Valve Walker
	Log   *slog.Logger
}

// ShareCodes walks the account's chain forward and returns the new codes.
// An unconnected account returns nothing, silently: for most players this
// source simply has no opinion.
//
// The head advances to the newest walked code even though fetching those
// matches can still fail downstream. Deliberate: a code Leetify has no report
// for stays absent forever (nobody in the lobby was a user), so holding the
// head back would wedge the chain on it permanently. The cost is that a
// transient fetch failure loses that one match from this source — the corpus
// and tracker fallback are the safety net for exactly that.
func (s ChainSource) ShareCodes(ctx context.Context, steamID uint64) ([]string, error) {
	chain, err := s.Store.AuthChainFor(ctx, steamID)
	if errors.Is(err, db.ErrNoChain) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if chain.Status != "active" {
		// Owner action pending (reseed or reissue); walking cannot help.
		return nil, nil
	}

	walked, walkErr := s.Valve.Walk(ctx, steamID, chain.AuthCode, chain.HeadCode, chainMaxSteps)
	// The head itself is offered too, not only what lies beyond it: the seed a
	// player connects with names a real match of theirs, and without this line
	// that one match was never fetched. Costless — the store's dedupe skips it
	// once stored, and the retry set covers it while Leetify still processes.
	codes := append([]string{chain.HeadCode}, walked...)

	if len(walked) > 0 {
		if err := s.Store.AdvanceAuthChain(ctx, steamID, walked[len(walked)-1]); err != nil {
			// The walk succeeded but the head did not persist: return nothing
			// rather than codes that would be re-walked AND re-fetched next
			// time — the store dedupe protects fetches, not the walk budget.
			return nil, err
		}
	} else if walkErr == nil {
		// Caught up with nothing new: stamp walked_at so the poller's
		// least-recently-walked ordering keeps rotating fairly.
		_ = s.Store.AdvanceAuthChain(ctx, steamID, chain.HeadCode)
	}

	switch {
	case errors.Is(walkErr, valvechain.ErrBadAuth):
		// Terminal until the owner reissues; stop spending budget on it.
		_ = s.Store.MarkAuthChain(ctx, steamID, "revoked")
		s.log().Warn("chain: auth code rejected", "steam", steamID)
	case errors.Is(walkErr, valvechain.ErrStaleCode):
		_ = s.Store.MarkAuthChain(ctx, steamID, "needs_reseed")
		s.log().Warn("chain: head code too old, owner must re-seed", "steam", steamID)
	case walkErr != nil:
		// Throttling and transient failures: keep the account active and let
		// the next poll retry from the persisted head.
		s.log().Warn("chain: walk interrupted", "steam", steamID, "err", walkErr)
	}

	return codes, nil
}

func (s ChainSource) log() *slog.Logger {
	if s.Log != nil {
		return s.Log
	}
	return slog.Default()
}
