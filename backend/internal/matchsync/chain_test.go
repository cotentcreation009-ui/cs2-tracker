package matchsync

import (
	"context"
	"testing"

	"github.com/cs2tracker/server/internal/db"
	"github.com/cs2tracker/server/internal/valvechain"
)

type fakeChainStore struct {
	chain   db.AuthChain
	noChain bool
	head    string
	stamped int
	marked  string
	advErr  error
}

func (f *fakeChainStore) AuthChainFor(context.Context, uint64) (db.AuthChain, error) {
	if f.noChain {
		return db.AuthChain{}, db.ErrNoChain
	}
	return f.chain, nil
}

func (f *fakeChainStore) AdvanceAuthChain(_ context.Context, _ uint64, head string) error {
	if f.advErr != nil {
		return f.advErr
	}
	f.head = head
	f.stamped++
	return nil
}

func (f *fakeChainStore) MarkAuthChain(_ context.Context, _ uint64, status string) error {
	f.marked = status
	return nil
}

type fakeWalker struct {
	codes []string
	err   error
}

func (f fakeWalker) Walk(context.Context, uint64, string, string, int) ([]string, error) {
	return f.codes, f.err
}

func TestChainAdvancesHeadToNewestCode(t *testing.T) {
	c := codes(3)
	store := &fakeChainStore{chain: db.AuthChain{SteamID: 1, AuthCode: "a", HeadCode: "old", Status: "active"}}
	src := ChainSource{Store: store, Valve: fakeWalker{codes: c}, Log: quiet()}

	got, err := src.ShareCodes(context.Background(), 1)
	// Head first, then the walked codes: the seed names a real match too.
	if err != nil || len(got) != 4 || got[0] != "old" {
		t.Fatalf("codes = %v, %v", got, err)
	}
	if store.head != c[2] {
		t.Errorf("head = %s, want the newest walked code %s", store.head, c[2])
	}
}

func TestChainUnconnectedAccountIsSilent(t *testing.T) {
	// Most players never connect anything: this source must have no opinion,
	// not an error — an error would be logged on every profile view forever.
	src := ChainSource{Store: &fakeChainStore{noChain: true}, Valve: fakeWalker{}, Log: quiet()}
	got, err := src.ShareCodes(context.Background(), 1)
	if err != nil || got != nil {
		t.Errorf("unconnected gave %v, %v; want silence", got, err)
	}
}

func TestChainTerminalFailuresParkTheAccount(t *testing.T) {
	// A rejected auth code cannot be fixed by retrying — only the owner can.
	// The account must be parked so the poller stops spending budget on it.
	store := &fakeChainStore{chain: db.AuthChain{Status: "active", HeadCode: "h"}}
	src := ChainSource{Store: store, Valve: fakeWalker{err: valvechain.ErrBadAuth}, Log: quiet()}
	if _, err := src.ShareCodes(context.Background(), 1); err != nil {
		t.Fatal(err)
	}
	if store.marked != "revoked" {
		t.Errorf("marked = %q, want revoked", store.marked)
	}

	store2 := &fakeChainStore{chain: db.AuthChain{Status: "active", HeadCode: "h"}}
	src2 := ChainSource{Store: store2, Valve: fakeWalker{err: valvechain.ErrStaleCode}, Log: quiet()}
	_, _ = src2.ShareCodes(context.Background(), 1)
	if store2.marked != "needs_reseed" {
		t.Errorf("marked = %q, want needs_reseed", store2.marked)
	}

	// And a parked account is silent thereafter.
	store2.chain.Status = "needs_reseed"
	got, err := src2.ShareCodes(context.Background(), 1)
	if err != nil || got != nil {
		t.Errorf("parked account gave %v, %v; want silence", got, err)
	}
}

func TestChainPartialWalkStillDeliversCodes(t *testing.T) {
	// Throttled mid-walk: the codes already earned are real matches and must
	// reach the sync; the account stays active for the next poll.
	c := codes(2)
	store := &fakeChainStore{chain: db.AuthChain{Status: "active", HeadCode: "h"}}
	src := ChainSource{Store: store, Valve: fakeWalker{codes: c, err: valvechain.ErrThrottled}, Log: quiet()}
	got, err := src.ShareCodes(context.Background(), 1)
	if err != nil || len(got) != 3 {
		t.Fatalf("partial = %v, %v", got, err)
	}
	if store.marked != "" {
		t.Errorf("throttle parked the account: %q", store.marked)
	}
	if store.head != c[1] {
		t.Errorf("head = %s, want %s so the retry resumes, not repeats", store.head, c[1])
	}
}
