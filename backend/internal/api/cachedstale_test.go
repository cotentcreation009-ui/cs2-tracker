package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"golang.org/x/sync/singleflight"
)

// mapKV is a jsonKV over a map: the same JSON round trip Redis does, with the
// TTL recorded per key so a test can check which copy got which lifetime.
type mapKV struct {
	data map[string][]byte
	ttl  map[string]time.Duration
}

func newMapKV() *mapKV {
	return &mapKV{data: map[string][]byte{}, ttl: map[string]time.Duration{}}
}

func (m *mapKV) GetJSON(_ context.Context, key string, dst any) (bool, error) {
	b, ok := m.data[key]
	if !ok {
		return false, nil
	}
	return true, json.Unmarshal(b, dst)
}

func (m *mapKV) SetJSONTTL(_ context.Context, key string, v any, ttl time.Duration) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	m.data[key] = b
	m.ttl[key] = ttl
	return nil
}

type stalePayload struct {
	Rows []string `json:"rows"`
}

func quietLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestCachedStaleFreshHitSkipsFetch(t *testing.T) {
	kv := newMapKV()
	_ = kv.SetJSONTTL(context.Background(), "k", stalePayload{Rows: []string{"cached"}}, time.Hour)
	var sf singleflight.Group
	calls := 0
	got, isStale, err := cachedStale(kv, &sf, context.Background(), "k", time.Hour, 24*time.Hour, quietLog(),
		func() (stalePayload, error) {
			calls++
			return stalePayload{Rows: []string{"fetched"}}, nil
		})
	if err != nil || isStale {
		t.Fatalf("err = %v, stale = %v", err, isStale)
	}
	if calls != 0 {
		t.Errorf("a fresh hit still ran the fetch %d times", calls)
	}
	if len(got.Rows) != 1 || got.Rows[0] != "cached" {
		t.Errorf("got %+v, want the cached copy", got)
	}
}

func TestCachedStaleSuccessWritesBothCopies(t *testing.T) {
	kv := newMapKV()
	var sf singleflight.Group
	got, isStale, err := cachedStale(kv, &sf, context.Background(), "k", time.Hour, 24*time.Hour, quietLog(),
		func() (stalePayload, error) { return stalePayload{Rows: []string{"fetched"}}, nil })
	if err != nil || isStale {
		t.Fatalf("err = %v, stale = %v", err, isStale)
	}
	if got.Rows[0] != "fetched" {
		t.Errorf("got %+v", got)
	}
	if kv.ttl["k"] != time.Hour {
		t.Errorf("fresh ttl = %v, want 1h", kv.ttl["k"])
	}
	if kv.ttl["k:stale"] != 24*time.Hour {
		t.Errorf("stale ttl = %v, want 24h", kv.ttl["k:stale"])
	}
	var twin stalePayload
	if hit, _ := kv.GetJSON(context.Background(), "k:stale", &twin); !hit || twin.Rows[0] != "fetched" {
		t.Errorf("stale twin = %+v (hit %v), want the same payload", twin, hit)
	}
}

func TestCachedStaleServesStaleCopyOnFetchError(t *testing.T) {
	kv := newMapKV()
	// Only the stale twin is present: the fresh copy has expired.
	_ = kv.SetJSONTTL(context.Background(), "k:stale", stalePayload{Rows: []string{"yesterday"}}, 24*time.Hour)
	var sf singleflight.Group
	boom := errors.New("faceit is down")
	got, isStale, err := cachedStale(kv, &sf, context.Background(), "k", time.Hour, 24*time.Hour, quietLog(),
		func() (stalePayload, error) { return stalePayload{}, boom })
	if err != nil {
		t.Fatalf("err = %v, want the stale copy instead", err)
	}
	if !isStale {
		t.Error("isStale = false, want true so the caller can say how old the data is")
	}
	if len(got.Rows) != 1 || got.Rows[0] != "yesterday" {
		t.Errorf("got %+v, want yesterday's copy", got)
	}
	// The failure must not have been written as a fresh copy.
	if _, ok := kv.data["k"]; ok {
		t.Error("a failed fetch was cached as fresh")
	}
}

func TestCachedStaleErrorWithNothingToServe(t *testing.T) {
	kv := newMapKV()
	var sf singleflight.Group
	boom := errors.New("faceit is down")
	_, isStale, err := cachedStale(kv, &sf, context.Background(), "k", time.Hour, 24*time.Hour, quietLog(),
		func() (stalePayload, error) { return stalePayload{}, boom })
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v, want the fetch error", err)
	}
	if isStale {
		t.Error("isStale = true with nothing served")
	}
}

func TestCachedStaleNilKVFetchesPlainly(t *testing.T) {
	var sf singleflight.Group
	got, isStale, err := cachedStale[stalePayload](nil, &sf, context.Background(), "k", time.Hour, 24*time.Hour, nil,
		func() (stalePayload, error) { return stalePayload{Rows: []string{"live"}}, nil })
	if err != nil || isStale || got.Rows[0] != "live" {
		t.Errorf("got %+v stale %v err %v", got, isStale, err)
	}
	// A typed-nil *cache.Cache must become a nil interface, not a live one.
	s := &Server{}
	if s.kv() != nil {
		t.Error("kv() of a server without a cache must be a nil interface")
	}
}
