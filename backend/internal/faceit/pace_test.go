package faceit

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Reading a ten-player room fires ~60 Data API calls at once. Unpaced, FACEIT
// 429s a share of them, the per-board failure is swallowed, and a room ends up
// with numbers for some players and em-dashes for the rest. This asserts the
// two properties that prevent that: bounded concurrency, and spacing.
func TestPaceBoundsBurst(t *testing.T) {
	var inFlight, peak int64
	var mu sync.Mutex
	var stamps []time.Time

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt64(&inFlight, 1)
		for {
			p := atomic.LoadInt64(&peak)
			if n <= p || atomic.CompareAndSwapInt64(&peak, p, n) {
				break
			}
		}
		mu.Lock()
		stamps = append(stamps, time.Now())
		mu.Unlock()
		time.Sleep(5 * time.Millisecond)
		atomic.AddInt64(&inFlight, -1)
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "key")
	const n = 20
	var wg sync.WaitGroup
	start := time.Now()
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			var dst map[string]any
			_ = c.get(context.Background(), "/players/x", &dst)
		}()
	}
	wg.Wait()
	elapsed := time.Since(start)

	if p := atomic.LoadInt64(&peak); p > 4 {
		t.Errorf("peak concurrent requests = %d, want <= 4", p)
	}
	// 20 requests spaced 90ms apart cannot finish faster than ~19*90ms.
	if min := 19 * 90 * time.Millisecond; elapsed < min/2 {
		t.Errorf("20 requests took %v — too fast to have been paced (want >= ~%v)", elapsed, min/2)
	}
	mu.Lock()
	got := len(stamps)
	mu.Unlock()
	if got != n {
		t.Errorf("server saw %d requests, want %d — pacing must delay, never drop", got, n)
	}
}

// A context that expires while waiting for a slot must not leak the slot.
func TestPaceReleasesOnCancel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "key")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	// drain the pacer far into the future so this call has to wait
	c.rateMu.Lock()
	c.nextAt = time.Now().Add(5 * time.Second)
	c.rateMu.Unlock()

	var dst map[string]any
	if err := c.get(ctx, "/players/x", &dst); err == nil {
		t.Fatal("want an error when the context expires while pacing")
	}
	// the slot must be back, or every later caller blocks for ever
	select {
	case c.sem <- struct{}{}:
		<-c.sem
	default:
		t.Error("pacing slot leaked after context cancellation")
	}
}
