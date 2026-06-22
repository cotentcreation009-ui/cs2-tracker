package api

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/cs2tracker/server/internal/config"
	"github.com/cs2tracker/server/internal/steam"
)

func TestRequestLogging(t *testing.T) {
	var buf bytes.Buffer
	cfg := &config.Config{CORSOrigins: []string{"*"}}
	s := NewServer(cfg, &fakeStore{}, steam.New(""), nil, nil, nil, nil,
		slog.New(slog.NewTextHandler(&buf, nil)))

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	s.Router().ServeHTTP(httptest.NewRecorder(), req)

	out := buf.String()
	for _, want := range []string{"method=GET", "/api/health", "status=200"} {
		if !strings.Contains(out, want) {
			t.Errorf("request log missing %q; got: %s", want, out)
		}
	}
}
