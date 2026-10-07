package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/cs2tracker/server/internal/cache"
)

// The file route streams a Valve replay through this origin (Valve is plain
// http, which an https page cannot download from), redirects to FACEIT's
// https link, and says why when there is nothing to stream. These drive it
// against a fake Valve replay host in addition to the lookup's fakes.

// fakeReplayHost serves one .dem.bz2 with byte-range support, like Valve's
// replay servers do; hold blocks each response until the channel is closed.
type fakeReplayHost struct {
	body   []byte
	status int
	hold   chan struct{}
	// declare, when set, is sent as Content-Length in place of the real size.
	declare int64
	hits    int
	mu      sync.Mutex
}

func (f *fakeReplayHost) serve(t *testing.T) string {
	t.Helper()
	if f.status == 0 {
		f.status = http.StatusOK
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.hits++
		f.mu.Unlock()
		if f.hold != nil {
			<-f.hold
		}
		if f.status != http.StatusOK {
			w.WriteHeader(f.status)
			return
		}
		if f.declare > 0 {
			w.Header().Set("Content-Length", strconv.FormatInt(f.declare, 10))
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(f.body)
			return
		}
		// http.ServeContent gives Content-Length, Accept-Ranges and 206s.
		w.Header().Set("Content-Type", "application/octet-stream")
		http.ServeContent(w, r, "x.dem.bz2", time.Unix(1_700_000_000, 0), bytes.NewReader(f.body))
	}))
	t.Cleanup(srv.Close)
	return srv.URL + "/730/003771234567890123456_0123456789.dem.bz2"
}

func getDemoFile(h http.Handler, gameID, query string, hdr map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/api/players/"+dlSteam+"/leetify-game/"+gameID+"/demo/file"+query, nil)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func decodeDemo(t *testing.T, w *httptest.ResponseRecorder) demoDownload {
	t.Helper()
	var v demoDownload
	if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode %q: %v", w.Body.String(), err)
	}
	return v
}

func TestDemoFileStreamsValveReplayThrough(t *testing.T) {
	body := bytes.Repeat([]byte("demo-bytes-"), 4096)
	host := &fakeReplayHost{body: body}
	u := &dlUpstreams{listedID: bridgedGame, source: "matchmaking", ref: dlShareCode, finishedAt: hoursAgo(48),
		botStatus: http.StatusOK, botURL: host.serve(t)}
	s, _ := u.server(t)
	h := s.Router()

	w := getDemoFile(h, bridgedGame, "", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s; want the replay streamed", w.Code, w.Body.String())
	}
	if !bytes.Equal(w.Body.Bytes(), body) {
		t.Errorf("got %d bytes, want the %d-byte replay unchanged", w.Body.Len(), len(body))
	}
	want := map[string]string{
		"Content-Type":        "application/octet-stream",
		"Content-Disposition": `attachment; filename=003771234567890123456_0123456789.dem.bz2`,
		"Content-Length":      strconv.Itoa(len(body)),
		"Accept-Ranges":       "bytes",
		"Cache-Control":       "no-store",
	}
	for k, v := range want {
		if got := w.Header().Get(k); got != v {
			t.Errorf("%s = %q, want %q", k, got, v)
		}
	}

	// A browser resuming: its Range reaches Valve, and the 206 comes back whole.
	w = getDemoFile(h, bridgedGame, "", map[string]string{"Range": "bytes=10-19"})
	if w.Code != http.StatusPartialContent {
		t.Fatalf("ranged status = %d, want 206", w.Code)
	}
	if got := w.Body.String(); got != string(body[10:20]) {
		t.Errorf("ranged body = %q", got)
	}
	if cr := w.Header().Get("Content-Range"); cr != "bytes 10-19/"+strconv.Itoa(len(body)) {
		t.Errorf("Content-Range = %q", cr)
	}
	if w.Header().Get("Content-Disposition") == "" {
		t.Error("a ranged answer lost its filename")
	}
	// Both clicks resolved the link once: the bot was asked a single time.
	if n := u.botCalls.Load(); n != 1 {
		t.Errorf("gc-bot asked %d times, want 1 (the file route shares the link cache)", n)
	}
}

func TestDemoFileRedirectsToFaceitSignedLink(t *testing.T) {
	u := &dlUpstreams{listedID: bridgedGame, source: "faceit", ref: dlFaceitID, finishedAt: hoursAgo(5),
		faceitSign: http.StatusOK}
	s, _ := u.server(t)
	w := getDemoFile(s.Router(), bridgedGame, "", nil)
	if w.Code != http.StatusFound {
		t.Fatalf("status = %d body=%s; want a 302 to FACEIT's https link", w.Code, w.Body.String())
	}
	if loc := w.Header().Get("Location"); !strings.HasPrefix(loc, "https://signed.faceit-cdn.net/") {
		t.Errorf("Location = %q", loc)
	}
	if cc := w.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q; a signed link must not be kept", cc)
	}
}

func TestDemoFileExpiredIs404WithTheLookupsReason(t *testing.T) {
	u := &dlUpstreams{listedID: bridgedGame, source: "matchmaking", ref: dlShareCode, finishedAt: hoursAgo(45 * 24),
		botStatus: http.StatusOK, botURL: dlValveURL}
	s, _ := u.server(t)
	w := getDemoFile(s.Router(), bridgedGame, "", nil)
	v := decodeDemo(t, w)
	if w.Code != http.StatusNotFound || v.Available || v.Code != "valve_expired" {
		t.Fatalf("status=%d answer=%+v; want 404 valve_expired", w.Code, v)
	}
	if v.Reason != reasonValveExpired {
		t.Errorf("reason = %q", v.Reason)
	}
}

func TestDemoFileTemporaryRefusalIs503(t *testing.T) {
	u := &dlUpstreams{listedID: bridgedGame, source: "matchmaking", ref: dlShareCode, finishedAt: hoursAgo(5),
		botStatus: http.StatusServiceUnavailable}
	s, _ := u.server(t)
	w := getDemoFile(s.Router(), bridgedGame, "", nil)
	if v := decodeDemo(t, w); w.Code != http.StatusServiceUnavailable || v.Code != "bot_unavailable" {
		t.Fatalf("status=%d answer=%+v; want 503 bot_unavailable", w.Code, v)
	}
}

func TestDemoFileValveGoneAfterLinkWasCached(t *testing.T) {
	// The link was remembered for hours; Valve dropped the file meanwhile.
	host := &fakeReplayHost{status: http.StatusNotFound}
	u := &dlUpstreams{listedID: bridgedGame, source: "matchmaking", ref: dlShareCode, finishedAt: hoursAgo(48),
		botStatus: http.StatusOK, botURL: host.serve(t)}
	s, kv := u.server(t)
	h := s.Router()
	if _, link := getDemo(t, h, bridgedGame, ""); !link.Available {
		t.Fatalf("lookup = %+v; want the (stale) link first", link)
	}
	w := getDemoFile(h, bridgedGame, "", nil)
	if v := decodeDemo(t, w); w.Code != http.StatusNotFound || v.Available || v.Code != "valve_expired" {
		t.Fatalf("status=%d answer=%+v; want 404 valve_expired", w.Code, v)
	}
	// ...and the memory is corrected, so the next click does not retry Valve.
	var cached demoDownload
	if hit, _ := kv.GetJSON(t.Context(), cache.LeetifyGameDemoKey(bridgedGame, 76561198019780871), &cached); !hit || cached.Available || cached.Code != "valve_expired" {
		t.Errorf("cached after Valve's 404 = %+v (hit=%v); want the gone answer", cached, hit)
	}
	if _, link := getDemo(t, h, bridgedGame, ""); link.Available {
		t.Errorf("lookup after Valve's 404 = %+v; still handing out the dead link", link)
	}
}

func TestDemoFileRefusesAnOversizeReplay(t *testing.T) {
	host := &fakeReplayHost{body: []byte("x"), declare: demoFileMaxBytes + 1}
	u := &dlUpstreams{listedID: bridgedGame, source: "matchmaking", ref: dlShareCode, finishedAt: hoursAgo(48),
		botStatus: http.StatusOK, botURL: host.serve(t)}
	s, _ := u.server(t)
	w := getDemoFile(s.Router(), bridgedGame, "", nil)
	if v := decodeDemo(t, w); w.Code != http.StatusBadGateway || v.Code != "too_large" {
		t.Fatalf("status=%d answer=%+v; want 502 too_large", w.Code, v)
	}
}

func TestDemoFileGlobalStreamCapAnswers429(t *testing.T) {
	host := &fakeReplayHost{body: []byte("demo"), hold: make(chan struct{})}
	u := &dlUpstreams{listedID: bridgedGame, source: "matchmaking", ref: dlShareCode, finishedAt: hoursAgo(48),
		botStatus: http.StatusOK, botURL: host.serve(t)}
	s, _ := u.server(t)
	s.demoFiles = newDemoStreamGate(1, 5, 50)
	h := s.Router()

	// One stream held open on the box...
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		if w := getDemoFile(h, bridgedGame, "", nil); w.Code != http.StatusOK {
			t.Errorf("held stream status = %d", w.Code)
		}
	}()
	deadline := time.Now().Add(5 * time.Second)
	for {
		host.mu.Lock()
		hits := host.hits
		host.mu.Unlock()
		if hits == 1 || time.Now().After(deadline) {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}

	// ...and the next one is turned away with a wait, not queued.
	w := getDemoFile(h, bridgedGame, "", nil)
	if v := decodeDemo(t, w); w.Code != http.StatusTooManyRequests || v.Code != "busy" {
		t.Fatalf("status=%d answer=%+v; want 429 busy", w.Code, v)
	}
	if ra := w.Header().Get("Retry-After"); ra != "30" {
		t.Errorf("Retry-After = %q", ra)
	}

	// Once the first finishes, the slot is free again.
	close(host.hold)
	wg.Wait()
	if w := getDemoFile(h, bridgedGame, "", nil); w.Code != http.StatusOK {
		t.Errorf("after release status = %d, want 200", w.Code)
	}
}

func TestDemoFilePerIPHourlyBudget(t *testing.T) {
	host := &fakeReplayHost{body: []byte("demo")}
	u := &dlUpstreams{listedID: bridgedGame, source: "matchmaking", ref: dlShareCode, finishedAt: hoursAgo(48),
		botStatus: http.StatusOK, botURL: host.serve(t)}
	s, _ := u.server(t)
	s.demoFiles = newDemoStreamGate(6, 2, 2)
	h := s.Router()
	for i := 0; i < 2; i++ {
		if w := getDemoFile(h, bridgedGame, "", nil); w.Code != http.StatusOK {
			t.Fatalf("start %d status = %d, want 200", i+1, w.Code)
		}
	}
	w := getDemoFile(h, bridgedGame, "", nil)
	if v := decodeDemo(t, w); w.Code != http.StatusTooManyRequests || v.Code != "ip_hourly" {
		t.Fatalf("third start: status=%d answer=%+v; want 429 ip_hourly", w.Code, v)
	}
	if ra := w.Header().Get("Retry-After"); ra != "600" {
		t.Errorf("Retry-After = %q", ra)
	}
	// The refusal did not spend a token, and nothing stays counted as active.
	if s.demoFiles.active != 0 || len(s.demoFiles.perIP) != 0 {
		t.Errorf("gate after three short streams: active=%d perIP=%v", s.demoFiles.active, s.demoFiles.perIP)
	}
	// A FACEIT redirect and a refusal are not streams and cost no budget: the
	// link route next door is untouched too.
	if w := doGET(h, "/api/players/"+dlSteam+"/leetify-game/"+bridgedGame+"/demo"); w.Code != http.StatusOK {
		t.Errorf("the link route answered %d after the file budget ran out", w.Code)
	}
}

func TestDemoFileRejectsBadIDs(t *testing.T) {
	u := &dlUpstreams{}
	s, _ := u.server(t)
	h := s.Router()
	if w := getDemoFile(h, "not_a_game", "", nil); w.Code != http.StatusBadRequest {
		t.Errorf("bad game id = %d, want 400", w.Code)
	}
	if w := doGET(h, "/api/players/nobody/leetify-game/"+bridgedGame+"/demo/file"); w.Code != http.StatusBadRequest {
		t.Errorf("bad steam id = %d, want 400", w.Code)
	}
}

func TestDemoFileName(t *testing.T) {
	for in, want := range map[string]string{
		"003771234567890123456_0123456789.dem.bz2": "003771234567890123456_0123456789.dem.bz2",
		`a"b\c d.dem.zst`:                           "a_b_c_d.dem.zst",
		"":                                          "match.dem.bz2",
		"...":                                       "match.dem.bz2",
	} {
		if got := demoFileName(in); got != want {
			t.Errorf("demoFileName(%q) = %q, want %q", in, got, want)
		}
	}
}
