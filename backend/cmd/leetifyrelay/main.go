// Command leetifyrelay is a keyed forwarder for the handful of Leetify app-API
// routes the profile fallback needs (internal/leetify/appprofile.go), meant to
// run on a network Leetify's bot wall answers.
//
// It exists because the wall refuses some hosting networks wholesale — Contabo's
// AS40021, where csrun.win lives, answers 511 on every request — while the rest
// of the world's datacenters get through (40 of 40 check-host nodes on hosting
// networks worldwide, and a home connection, on 2026-09-24). This program
// solves no challenge and fakes no header: it asks from an address Leetify
// answers, only for the exact routes listed in allowed, only with the shared
// key, and hands the answer back status and all — a 511 here is a 511 there.
//
//	LEETIFY_RELAY_KEY=<secret> leetifyrelay [-listen 127.0.0.1:7400] [-upstream https://api.cs-prod.leetify.com]
//
// Deployment (a €4 VPS on a clean network, or a Cloudflare Worker running the
// same forwarder): docs/LEETIFY-RELAY.md.
package main

import (
	"crypto/subtle"
	"flag"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"time"
)

// allowed is the whole surface this relay will forward: a 17-digit SteamID64's
// pool list, one pool's recent-games summary, its display name, and its last
// 30 games. Anything else is a 404 here before it becomes a request there.
var allowed = regexp.MustCompile(`^/api/profile/[0-9]{17}/(meta|match-history|recent-games/(available-data-sources|[a-z0-9_]{1,32}))$`)

// maxBody caps what is copied back; a recent-games summary is ~2 KB.
const maxBody = 4 << 20

func main() {
	listen := flag.String("listen", "127.0.0.1:7400", "address to listen on")
	upstream := flag.String("upstream", "https://api.cs-prod.leetify.com", "Leetify app host to forward to")
	flag.Parse()
	key := os.Getenv("LEETIFY_RELAY_KEY")
	if key == "" {
		log.Fatal("LEETIFY_RELAY_KEY is required: the relay answers only to the backend that shares it")
	}
	srv := &http.Server{
		Addr:              *listen,
		Handler:           newHandler(*upstream, key, &http.Client{Timeout: 15 * time.Second}),
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Printf("leetifyrelay listening on %s, forwarding to %s", *listen, *upstream)
	log.Fatal(srv.ListenAndServe())
}

// newHandler builds the forwarder: /healthz for the process supervisor, and
// the allowed routes for the backend.
func newHandler(upstream, key string, hc *http.Client) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "ok")
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "GET only", http.StatusMethodNotAllowed)
			return
		}
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Relay-Key")), []byte(key)) != 1 {
			http.Error(w, "relay key", http.StatusUnauthorized)
			return
		}
		if !allowed.MatchString(r.URL.Path) {
			http.Error(w, "not a relayed route", http.StatusNotFound)
			return
		}
		start := time.Now()
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, upstream+r.URL.Path, nil)
		if err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		req.Header.Set("Accept", "application/json")
		resp, err := hc.Do(req)
		if err != nil {
			log.Printf("%s upstream error: %v", r.URL.Path, err)
			http.Error(w, "upstream unreachable", http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()
		ct := resp.Header.Get("Content-Type")
		if ct == "" {
			ct = "application/json"
		}
		w.Header().Set("Content-Type", ct)
		w.WriteHeader(resp.StatusCode)
		n, _ := io.Copy(w, io.LimitReader(resp.Body, maxBody))
		log.Printf("%s %d %dB %s", r.URL.Path, resp.StatusCode, n, time.Since(start).Round(time.Millisecond))
	})
	return mux
}
