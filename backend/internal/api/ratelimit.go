package api

import (
	"net"
	"net/http"
	"sync"
	"time"
)

// rateLimiter is a simple per-key token-bucket limiter. It is concurrency-safe
// and evicts idle buckets opportunistically so memory does not grow unbounded
// with unique client IPs. For multi-instance deployments this would move to a
// shared store (Redis) — noted in the roadmap.
type rateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	rate    float64 // tokens added per second
	burst   float64 // max tokens
	now     func() time.Time
}

type bucket struct {
	tokens float64
	last   time.Time
}

func newRateLimiter(rps float64, burst int) *rateLimiter {
	return &rateLimiter{
		buckets: make(map[string]*bucket),
		rate:    rps,
		burst:   float64(burst),
		now:     time.Now,
	}
}

// allow reports whether a request for key may proceed, consuming a token.
func (rl *rateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := rl.now()
	b := rl.buckets[key]
	if b == nil {
		// New client starts with a full burst, minus this request.
		rl.maybeSweep(now)
		rl.buckets[key] = &bucket{tokens: rl.burst - 1, last: now}
		return true
	}

	b.tokens += now.Sub(b.last).Seconds() * rl.rate
	if b.tokens > rl.burst {
		b.tokens = rl.burst
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// maybeSweep evicts long-idle buckets when the map grows large. Caller holds mu.
func (rl *rateLimiter) maybeSweep(now time.Time) {
	if len(rl.buckets) < 4096 {
		return
	}
	for k, b := range rl.buckets {
		if now.Sub(b.last) > 10*time.Minute {
			delete(rl.buckets, k)
		}
	}
}

// middleware enforces the limit per client IP.
func (rl *rateLimiter) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !rl.allow(clientIP(r)) {
			w.Header().Set("Retry-After", "1")
			writeError(w, http.StatusTooManyRequests, "rate limited")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// clientIP extracts the IP from RemoteAddr (which chi's RealIP middleware will
// have already rewritten from X-Forwarded-For / X-Real-IP when behind a proxy).
func clientIP(r *http.Request) string {
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}
