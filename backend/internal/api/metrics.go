package api

import (
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
)

// metrics holds lightweight, concurrency-safe HTTP counters exposed at /metrics
// in Prometheus text exposition format. For a single binary this is plenty; a
// multi-instance deployment would scrape each replica.
type metrics struct {
	total atomic.Int64
	c2xx  atomic.Int64
	c3xx  atomic.Int64
	c4xx  atomic.Int64
	c5xx  atomic.Int64
}

func (m *metrics) observe(status int) {
	m.total.Add(1)
	switch status / 100 {
	case 2:
		m.c2xx.Add(1)
	case 3:
		m.c3xx.Add(1)
	case 4:
		m.c4xx.Add(1)
	case 5:
		m.c5xx.Add(1)
	}
}

func (m *metrics) render() string {
	var b strings.Builder
	b.WriteString("# HELP cs2_http_requests_total Total HTTP requests by status class.\n")
	b.WriteString("# TYPE cs2_http_requests_total counter\n")
	fmt.Fprintf(&b, "cs2_http_requests_total{class=\"2xx\"} %d\n", m.c2xx.Load())
	fmt.Fprintf(&b, "cs2_http_requests_total{class=\"3xx\"} %d\n", m.c3xx.Load())
	fmt.Fprintf(&b, "cs2_http_requests_total{class=\"4xx\"} %d\n", m.c4xx.Load())
	fmt.Fprintf(&b, "cs2_http_requests_total{class=\"5xx\"} %d\n", m.c5xx.Load())
	return b.String()
}

func (s *Server) handleMetrics(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(s.metrics.render()))
}
