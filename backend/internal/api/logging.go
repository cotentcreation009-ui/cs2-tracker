package api

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5/middleware"
)

// requestLogger logs one structured line per request (method, path, status,
// bytes, latency, request id, client IP). 5xx logs at error, 4xx at warn.
func (s *Server) requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		start := time.Now()
		next.ServeHTTP(ww, r)

		level := slog.LevelInfo
		switch {
		case ww.Status() >= 500:
			level = slog.LevelError
		case ww.Status() >= 400:
			level = slog.LevelWarn
		}
		s.log.LogAttrs(r.Context(), level, "http request",
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.Int("status", ww.Status()),
			slog.Int("bytes", ww.BytesWritten()),
			slog.Duration("dur", time.Since(start)),
			slog.String("reqId", middleware.GetReqID(r.Context())),
			slog.String("ip", clientIP(r)),
		)
	})
}
