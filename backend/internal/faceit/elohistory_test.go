package faceit

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// An active player's history spans several pages, and the later pages are the
// ones a datacenter IP gets 403'd on. Losing page 2 must never cost the month
// of matches already fetched in page 1 — that exact bug made elo movement
// vanish for precisely the most active FACEIT players, while short-history
// players (one page, no burst) worked fine.
func TestEloHistoryKeepsPartialOnMidPageBlock(t *testing.T) {
	rows := func(n, start int) string {
		var b strings.Builder
		b.WriteString("[")
		for i := 0; i < n; i++ {
			if i > 0 {
				b.WriteString(",")
			}
			fmt.Fprintf(&b, `{"matchId":"m%d","date":%d,"i1":"de_mirage","elo":"%d","elo_delta":"25"}`,
				start+i, 1754400000000-int64(start+i)*3600000, 2000+start+i)
		}
		b.WriteString("]")
		return b.String()
	}
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if r.URL.Query().Get("page") == "0" {
			_, _ = w.Write([]byte(rows(100, 0)))
			return
		}
		w.WriteHeader(http.StatusForbidden) // Cloudflare says no to the burst
	}))
	t.Cleanup(srv.Close)

	prev := statsHost
	statsHost = srv.URL
	t.Cleanup(func() { statsHost = prev })
	statsMu.Lock()
	statsPause = time.Time{}
	statsMu.Unlock()
	t.Cleanup(func() {
		statsMu.Lock()
		statsPause = time.Time{}
		statsMu.Unlock()
	})

	c := New("", "test-key")
	got, err := c.EloHistory(context.Background(), "player-1", 300)
	if err != nil {
		t.Fatalf("partial block must not error: %v", err)
	}
	if len(got) != 100 {
		t.Fatalf("got %d rows, want the 100 from page 0 kept", len(got))
	}
	if got[0].Elo != 2000 || !got[0].HasDelta {
		t.Errorf("row content wrong: %+v", got[0])
	}
	if hits != 2 {
		t.Errorf("made %d requests, want 2 (page 0 + the blocked page 1)", hits)
	}
	if !statsBlocked() {
		t.Error("the 403 should still open the breaker for future calls")
	}
}
