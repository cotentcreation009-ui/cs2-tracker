package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRateLimiterAllow(t *testing.T) {
	cur := time.Unix(0, 0)
	rl := newRateLimiter(1, 3) // 1 token/sec, burst 3
	rl.now = func() time.Time { return cur }

	for i := 0; i < 3; i++ {
		if !rl.allow("ip1") {
			t.Fatalf("request %d should pass (within burst)", i+1)
		}
	}
	if rl.allow("ip1") {
		t.Error("4th request should be denied (burst exhausted, no refill)")
	}

	cur = cur.Add(time.Second) // ~1 token refills
	if !rl.allow("ip1") {
		t.Error("request after 1s refill should pass")
	}
	if rl.allow("ip1") {
		t.Error("should be denied again immediately after")
	}

	if !rl.allow("ip2") {
		t.Error("a different key has its own independent bucket")
	}
}

func TestRateLimitMiddleware429(t *testing.T) {
	cur := time.Unix(0, 0)
	rl := newRateLimiter(1, 2)
	rl.now = func() time.Time { return cur }
	h := rl.middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	hit := func() int {
		req := httptest.NewRequest(http.MethodGet, "/x", nil)
		req.RemoteAddr = "1.2.3.4:5555"
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		return w.Code
	}

	if hit() != http.StatusOK || hit() != http.StatusOK {
		t.Fatal("first two requests should pass")
	}
	if code := hit(); code != http.StatusTooManyRequests {
		t.Errorf("third request = %d, want 429", code)
	}
}
