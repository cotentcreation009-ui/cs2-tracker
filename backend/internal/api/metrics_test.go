package api

import (
	"strings"
	"testing"
)

func TestMetricsEndpoint(t *testing.T) {
	r := routerWith(&fakeStore{}) // health -> 200; unknown player -> 404

	doGET(r, "/api/health")                    // 2xx
	doGET(r, "/api/players/76561198000000001") // 4xx (not tracked, no Steam key)

	// At render time the prior two requests are counted; the /metrics request
	// itself is observed only after its handler returns.
	w := doGET(r, "/metrics")
	if w.Code != 200 {
		t.Fatalf("metrics code = %d, want 200", w.Code)
	}
	body := w.Body.String()
	for _, want := range []string{
		"# TYPE cs2_http_requests_total counter",
		`cs2_http_requests_total{class="2xx"} 1`,
		`cs2_http_requests_total{class="4xx"} 1`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("metrics output missing %q; got:\n%s", want, body)
		}
	}
}
