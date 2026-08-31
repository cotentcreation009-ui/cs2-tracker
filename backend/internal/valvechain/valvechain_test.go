package valvechain

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"golang.org/x/time/rate"
)

func unlimited(t *testing.T) {
	t.Helper()
	prev := limiter
	limiter = rate.NewLimiter(rate.Inf, 1)
	t.Cleanup(func() { limiter = prev })
}

const (
	c1 = "CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE"
	c2 = "CSGO-FFFFF-GGGGG-HHHHH-JJJJJ-KKKKK"
	c3 = "CSGO-LLLLL-MMMMM-NNNNN-PPPPP-QQQQQ"
)

// A fake Valve: c1 -> c2 -> c3 -> head.
func fakeValve(t *testing.T) *httptest.Server {
	t.Helper()
	chain := map[string]string{c1: c2, c2: c3}
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("steamidkey") != "GOOD-CODES-HERE" {
			// Valve's error bodies are HTML — reproduce that so a decoder that
			// runs on non-200 would fail loudly in tests.
			w.WriteHeader(http.StatusForbidden)
			w.Write([]byte("<html><body>Access is denied.</body></html>"))
			return
		}
		known := r.URL.Query().Get("knowncode")
		next, ok := chain[known]
		if !ok {
			if known == c3 {
				// Both caught-up spellings exist in the wild; serve the 202 one.
				w.WriteHeader(http.StatusAccepted)
				w.Write([]byte(`{"result":{"nextcode":"n/a"}}`))
				return
			}
			w.WriteHeader(http.StatusPreconditionFailed)
			w.Write([]byte("<html>Precondition Failed</html>"))
			return
		}
		w.Write([]byte(`{"result":{"nextcode":"` + next + `"}}`))
	}))
}

func TestWalkFollowsToHead(t *testing.T) {
	unlimited(t)
	srv := fakeValve(t)
	defer srv.Close()
	c := &Client{Key: "k", BaseURL: srv.URL}

	got, err := c.Walk(context.Background(), 1, "GOOD-CODES-HERE", c1, 24)
	if err != nil {
		t.Fatal(err)
	}
	// Reaching the head is success: the walk ends quietly with what it found.
	if len(got) != 2 || got[0] != c2 || got[1] != c3 {
		t.Errorf("walk = %v, want [%s %s]", got, c2, c3)
	}
}

func TestWalkRespectsTheCap(t *testing.T) {
	unlimited(t)
	srv := fakeValve(t)
	defer srv.Close()
	c := &Client{Key: "k", BaseURL: srv.URL}
	got, err := c.Walk(context.Background(), 1, "GOOD-CODES-HERE", c1, 1)
	if err != nil || len(got) != 1 {
		t.Errorf("capped walk = %v, %v; want exactly 1 code", got, err)
	}
}

func TestFailureModesAreDistinct(t *testing.T) {
	unlimited(t)
	srv := fakeValve(t)
	defer srv.Close()

	// Bad auth code: the owner's problem, not a retry candidate. The HTML body
	// must not reach a JSON decoder.
	bad := &Client{Key: "k", BaseURL: srv.URL}
	if _, err := bad.Next(context.Background(), 1, "WRONG", c1); !errors.Is(err, ErrBadAuth) {
		t.Errorf("bad auth gave %v, want ErrBadAuth", err)
	}

	// Stale/foreign known code: distinct from bad auth, because the fixes are
	// different people's jobs (owner reissues auth vs owner supplies new seed).
	good := &Client{Key: "k", BaseURL: srv.URL}
	if _, err := good.Next(context.Background(), 1, "GOOD-CODES-HERE",
		"CSGO-RRRRR-SSSSS-TTTTT-UUUUU-VVVVV"); !errors.Is(err, ErrStaleCode) {
		t.Errorf("stale code gave %v, want ErrStaleCode", err)
	}

	// Head of the chain: not an error condition at all.
	if _, err := good.Next(context.Background(), 1, "GOOD-CODES-HERE", c3); !errors.Is(err, ErrCaughtUp) {
		t.Errorf("head gave %v, want ErrCaughtUp", err)
	}
}

func TestPartialWalkReturnsWhatItFound(t *testing.T) {
	unlimited(t)
	// The chain serves one link then starts throttling: the caller must still
	// receive the link it paid for — those are real matches.
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			w.Write([]byte(`{"result":{"nextcode":"` + c2 + `"}}`))
			return
		}
		w.WriteHeader(http.StatusTooManyRequests)
		w.Write([]byte("<html>Too Many Requests</html>"))
	}))
	defer srv.Close()
	c := &Client{Key: "k", BaseURL: srv.URL}
	got, err := c.Walk(context.Background(), 1, "GOOD-CODES-HERE", c1, 24)
	if !errors.Is(err, ErrThrottled) {
		t.Fatalf("err = %v, want ErrThrottled", err)
	}
	if len(got) != 1 || got[0] != c2 {
		t.Errorf("partial walk = %v, want the one earned code", got)
	}
}
