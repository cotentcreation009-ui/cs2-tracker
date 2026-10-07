package api

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/cs2tracker/server/internal/cache"
)

// The demo FILE route. Valve hosts replays over plain http
// (http://replayNNN.valve.net/730/<id>.dem.bz2), and Chrome refuses every
// download an https page starts towards an http host: a same-tab link, a tab
// opened by script and pointed at the file, a redirect through our own origin
// (the whole chain is inspected). The one seamless route is to hand the bytes
// out over https ourselves, so this route fetches the replay from Valve and
// streams it straight through — never buffered, Range passed along so a
// browser can resume. FACEIT's links are already https (signed storage), so
// those are a redirect, not a proxy.
//
//	GET /api/players/{steamid}/leetify-game/{gameId}/demo/file
//
// A demo is 100–400 MB, so the route is fenced: a few streams at a time on the
// box, two at a time and a bounded number per hour per visitor, a size cap,
// and a log line per stream with bytes and duration so the bandwidth it
// costs stays visible.
const (
	// demoFileMaxBytes refuses anything larger than a demo can honestly be.
	demoFileMaxBytes = 1 << 30
	// demoFileStreamLimit bounds one stream end to end (the route's own
	// timeout, in place of the API's 30 s): 400 MB at a slow 300 KB/s.
	demoFileStreamLimit = 30 * time.Minute
	// demoFileHeaderTimeout is how long Valve gets to start answering.
	demoFileHeaderTimeout = 20 * time.Second
	// Concurrency on the box, per visitor, and starts per visitor per hour.
	demoFileMaxStreams     = 6
	demoFileMaxPerIP       = 2
	demoFileStartsPerHour  = 20
	demoFileRetryAfterBusy = 30 * time.Second
	demoFileRetryAfterHour = 10 * time.Minute
)

// demoFileHTTP fetches replays. No overall timeout — a stream is bounded by
// the request context — but Valve must begin answering promptly.
var demoFileHTTP = &http.Client{Transport: &http.Transport{
	Proxy:                 http.ProxyFromEnvironment,
	ResponseHeaderTimeout: demoFileHeaderTimeout,
	MaxIdleConns:          8,
	IdleConnTimeout:       90 * time.Second,
}}

// demoStreamGate admits streams: a global ceiling, a per-visitor ceiling, and
// a per-visitor start budget (token bucket: a full hour's worth up front,
// refilled evenly over the hour).
type demoStreamGate struct {
	mu        sync.Mutex
	active    int
	perIP     map[string]int
	starts    *rateLimiter
	maxActive int
	maxPerIP  int
}

func newDemoStreamGate(maxActive, maxPerIP, startsPerHour int) *demoStreamGate {
	return &demoStreamGate{
		perIP:     map[string]int{},
		starts:    newRateLimiter(float64(startsPerHour)/3600, startsPerHour),
		maxActive: maxActive,
		maxPerIP:  maxPerIP,
	}
}

// demoStreamRefusal is why a stream was not admitted, with the wait to suggest.
type demoStreamRefusal struct {
	code       string
	reason     string
	retryAfter time.Duration
}

// acquire admits a stream for ip, returning the release to call when it ends,
// or the refusal. Concurrency is checked before the hourly budget so a refused
// request never spends a start.
func (g *demoStreamGate) acquire(ip string) (release func(), refused *demoStreamRefusal) {
	g.mu.Lock()
	defer g.mu.Unlock()
	switch {
	case g.active >= g.maxActive:
		return nil, &demoStreamRefusal{"busy", "Too many demos are downloading right now — try again in a moment.", demoFileRetryAfterBusy}
	case g.perIP[ip] >= g.maxPerIP:
		return nil, &demoStreamRefusal{"ip_concurrent", "You already have demos downloading — let one finish first.", demoFileRetryAfterBusy}
	case !g.starts.allow(ip):
		return nil, &demoStreamRefusal{"ip_hourly", "That's a lot of demos for one hour — try again later.", demoFileRetryAfterHour}
	}
	g.active++
	g.perIP[ip]++
	var once sync.Once
	return func() {
		once.Do(func() {
			g.mu.Lock()
			defer g.mu.Unlock()
			g.active--
			if g.perIP[ip] <= 1 {
				delete(g.perIP, ip)
			} else {
				g.perIP[ip]--
			}
		})
	}, nil
}

// demoFileStatus is the HTTP status an unavailable answer gets on the file
// route: 404 when the demo is simply not there (and will not be), 503 when a
// source is merely not answering right now.
func demoFileStatus(v demoDownload) int {
	switch v.Code {
	case "valve_expired", "valve_no_replay", "no_demo", "unknown_game", "faceit_no_demo", "steam_private":
		return http.StatusNotFound
	}
	return http.StatusServiceUnavailable
}

// handleLeetifyGameDemoFile serves one listed game's demo file over this
// origin. Resolution is the link route's, cache included; a FACEIT demo is a
// redirect to its signed https link; a Valve demo is streamed through.
func (s *Server) handleLeetifyGameDemoFile(w http.ResponseWriter, r *http.Request) {
	sid, gameID, legacy, ok := demoDownloadParams(w, r)
	if !ok {
		return
	}
	w.Header().Set("Cache-Control", "no-store")

	v := s.resolveDemoDownload(r, sid, gameID, legacy)
	if !v.Available {
		writeJSON(w, demoFileStatus(v), v)
		return
	}
	if v.Source == "faceit" {
		// https → https: the browser may follow this itself.
		http.Redirect(w, r, v.URL, http.StatusFound)
		return
	}

	ip := clientIP(r)
	release, refused := s.demoFiles.acquire(ip)
	if refused != nil {
		w.Header().Set("Retry-After", strconv.Itoa(int(refused.retryAfter.Seconds())))
		writeJSON(w, http.StatusTooManyRequests, demoUnavailable(refused.code, refused.reason))
		return
	}
	defer release()

	up, err := http.NewRequestWithContext(r.Context(), http.MethodGet, v.URL, nil)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, demoUnavailable("valve_unreachable", "Valve's replay server could not be asked for this demo."))
		return
	}
	// Resume support: the browser's range goes to Valve as-is, and Valve's
	// 206 + Content-Range come back the same way.
	for _, h := range []string{"Range", "If-Range"} {
		if val := r.Header.Get(h); val != "" {
			up.Header.Set(h, val)
		}
	}
	up.Header.Set("User-Agent", "csrun.win demo relay (+https://csrun.win)")

	res, err := demoFileHTTP.Do(up)
	if err != nil {
		s.log.Warn("demo stream: upstream unreachable", "game", gameID, "url", v.URL, "err", err)
		writeJSON(w, http.StatusBadGateway, demoUnavailable("valve_unreachable", "Valve's replay server didn't answer — try again shortly."))
		return
	}
	defer res.Body.Close()

	switch res.StatusCode {
	case http.StatusOK, http.StatusPartialContent:
	case http.StatusNotFound, http.StatusGone, http.StatusForbidden:
		// Valve dropped the replay after the link was remembered: say so,
		// and remember THAT instead so the next click does not try again.
		gone := demoUnavailable("valve_expired", reasonValveExpired)
		if kv := s.kv(); kv != nil {
			_ = kv.SetJSONTTL(r.Context(), cache.LeetifyGameDemoKey(gameID, sid), gone, demoDLGoneTTL)
		}
		writeJSON(w, http.StatusNotFound, gone)
		return
	case http.StatusRequestedRangeNotSatisfiable:
		if cr := res.Header.Get("Content-Range"); cr != "" {
			w.Header().Set("Content-Range", cr)
		}
		w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
		return
	default:
		s.log.Warn("demo stream: upstream refused", "game", gameID, "status", res.StatusCode)
		writeJSON(w, http.StatusBadGateway, demoUnavailable("valve_unreachable", "Valve's replay server answered "+strconv.Itoa(res.StatusCode)+" — try again shortly."))
		return
	}
	if res.ContentLength > demoFileMaxBytes {
		s.log.Warn("demo stream: refused oversize replay", "game", gameID, "bytes", res.ContentLength)
		writeJSON(w, http.StatusBadGateway, demoUnavailable("too_large", "This replay is larger than a demo can be ("+strconv.FormatInt(res.ContentLength>>20, 10)+" MB), so it is not relayed."))
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": demoFileName(v.Filename)}))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	for _, h := range []string{"Content-Length", "Content-Range", "Accept-Ranges", "Last-Modified", "ETag"} {
		if val := res.Header.Get(h); val != "" {
			w.Header().Set(h, val)
		}
	}
	w.WriteHeader(res.StatusCode)

	started := time.Now()
	s.log.Info("demo stream started", "game", gameID, "ip", ip, "file", v.Filename, "status", res.StatusCode, "bytes_expected", res.ContentLength)
	n, cerr := io.Copy(w, io.LimitReader(res.Body, demoFileMaxBytes+1))
	// If the length was unknown and the cap was passed, what the browser got
	// is an incomplete file; the stream is cut here rather than continued.
	if n > demoFileMaxBytes && cerr == nil {
		cerr = errors.New("size cap reached mid-stream")
	}
	if cerr != nil {
		// A browser that went away reads as a write error here; Valve going
		// quiet as a read error. Either way the transfer is incomplete, and
		// the connection is cut so the browser sees a failed download, never
		// a short file that looks whole.
		s.log.Info("demo stream ended early", "game", gameID, "ip", ip, "bytes", n, "took", time.Since(started).Round(time.Millisecond), "err", cerr)
		_ = http.NewResponseController(w).SetWriteDeadline(time.Now())
		return
	}
	s.log.Info("demo stream finished", "game", gameID, "ip", ip, "bytes", n, "took", time.Since(started).Round(time.Millisecond))
}

// demoFileName keeps a downloaded demo's name to what a filename= parameter
// can carry plainly (the names Valve and FACEIT use are ASCII already).
func demoFileName(name string) string {
	name = strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			return r
		case r == '.', r == '_', r == '-':
			return r
		}
		return '_'
	}, strings.TrimSpace(name))
	if strings.Trim(name, "._-") == "" {
		return "match.dem.bz2"
	}
	return name
}
