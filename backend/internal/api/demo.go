package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/cs2tracker/server/internal/db"
	"github.com/cs2tracker/server/internal/faceit"
	"github.com/cs2tracker/server/internal/gcbot"
	"github.com/cs2tracker/server/internal/leetify"
	"github.com/cs2tracker/server/internal/queue"
	"github.com/cs2tracker/server/internal/steam"
	"github.com/go-chi/chi/v5"
)

// Demo-analysis upload limits. These bound cost on a single bounded worker:
// per-IP and global daily caps stop abuse, and the hard byte cap stops a single
// upload from filling the disk. Tune as capacity grows.
const (
	// 95 MB keeps a single upload under Cloudflare's 100 MB free-plan request-body
	// limit (the proxy in front of us), so oversized demos fail cleanly here
	// instead of with a confusing edge 413. Most 5v5 competitive demos fit; larger
	// demos need object-storage direct upload (a future upgrade).
	demoMaxUploadBytes  = 95 << 20
	demoMaxPerIPPerDay  = 15
	demoMaxGlobalPerDay = 300
)

func randID() string {
	var b [12]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// demoQuotaOK reports whether this request is within the per-IP and global daily
// demo caps. ok=false means send (status, msg). Counting only ever sees rows
// that represent real submissions (multipart uploads + triggered direct uploads),
// not abandoned presigns, so an unfinished upload never burns a user's quota.
func (s *Server) demoQuotaOK(r *http.Request) (ok bool, status int, msg string) {
	ip := clientIP(r)
	since := time.Now().Add(-24 * time.Hour)
	if n, err := s.db.CountDemoJobsByIPSince(r.Context(), ip, since); err == nil && n >= demoMaxPerIPPerDay {
		return false, http.StatusTooManyRequests, "daily demo limit reached — try again tomorrow"
	}
	if n, err := s.db.CountDemoJobsSince(r.Context(), since); err == nil && n >= demoMaxGlobalPerDay {
		return false, http.StatusServiceUnavailable, "demo parsing is at capacity — please try again later"
	}
	return true, 0, ""
}

// handleDemoUpload accepts a multipart .dem upload, streams it to disk, enqueues
// a replay-parse job, and returns the job id to poll. Public + quota'd.
func (s *Server) handleDemoUpload(w http.ResponseWriter, r *http.Request) {
	if s.queue == nil {
		writeError(w, http.StatusServiceUnavailable, "demo parsing is not available right now")
		return
	}

	ip := clientIP(r)
	if ok, status, msg := s.demoQuotaOK(r); !ok {
		writeError(w, status, msg)
		return
	}

	mr, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "expected a multipart form upload")
		return
	}

	if err := os.MkdirAll(s.cfg.DemoWorkDir, 0o755); err != nil {
		s.serverError(w, "create work dir", err)
		return
	}
	id := randID()
	dest := filepath.Join(s.cfg.DemoWorkDir, id+".dem")

	var filename string
	var written int64
	saved := false
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			_ = os.Remove(dest)
			writeError(w, http.StatusBadRequest, "could not read upload")
			return
		}
		if part.FormName() != "demo" {
			_ = part.Close()
			continue
		}
		filename = part.FileName()
		f, err := os.Create(dest)
		if err != nil {
			_ = part.Close()
			s.serverError(w, "create demo file", err)
			return
		}
		written, err = io.Copy(f, io.LimitReader(part, demoMaxUploadBytes+1))
		_ = f.Close()
		_ = part.Close()
		if err != nil {
			_ = os.Remove(dest)
			s.serverError(w, "save upload", err)
			return
		}
		if written > demoMaxUploadBytes {
			_ = os.Remove(dest)
			writeError(w, http.StatusRequestEntityTooLarge, "demo exceeds the size limit")
			return
		}
		saved = true
		break
	}

	if !saved || written == 0 {
		_ = os.Remove(dest)
		writeError(w, http.StatusBadRequest, "no demo file in the upload (field name 'demo')")
		return
	}
	if !strings.HasSuffix(strings.ToLower(filename), ".dem") {
		_ = os.Remove(dest)
		writeError(w, http.StatusBadRequest, "file must be a .dem")
		return
	}

	// Record the row BEFORE enqueuing so a fast worker can never process a job
	// whose status row doesn't exist yet (which would make the result unwritable
	// and the poll 404 forever).
	if err := s.db.CreateDemoJob(r.Context(), id, ip, filename, written); err != nil {
		_ = os.Remove(dest)
		s.serverError(w, "record demo job", err)
		return
	}
	job, err := s.queue.Enqueue(r.Context(), queue.Job{
		ID:       id,
		Type:     queue.JobParseReplay,
		Source:   "upload",
		DemoPath: dest,
	})
	if err != nil {
		_ = os.Remove(dest)
		_ = s.db.SetDemoStatus(r.Context(), id, "failed", "could not enqueue")
		s.serverError(w, "enqueue", err)
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{"id": job.ID, "status": "queued"})
}

// isPublicHost guards the from-URL ingest against SSRF: the worker will fetch
// whatever URL we accept, so reject hosts that resolve to loopback/private/
// link-local space (incl. the cloud metadata IP). Not bullet-proof against DNS
// rebinding, but blocks the obvious internal-target attacks.
func isPublicHost(host string) bool {
	if host == "" {
		return false
	}
	h := strings.ToLower(host)
	if h == "localhost" || strings.HasSuffix(h, ".localhost") || h == "metadata.google.internal" {
		return false
	}
	ips, err := net.LookupIP(host)
	if err != nil || len(ips) == 0 {
		return false
	}
	for _, ip := range ips {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
			ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return false
		}
	}
	return true
}

// faceitRoomRe matches a FACEIT match-room id, e.g. "1-2e6c6720-5486-40be-9549-0b3657a8d4f7".
var faceitRoomRe = regexp.MustCompile(`^[0-9]+-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// faceitRoomID extracts a FACEIT match id from user input: either a bare match
// id, or a match-room link like https://www.faceit.com/en/cs2/room/1-…/scoreboard.
// Returns "" when the input isn't a FACEIT room reference.
func faceitRoomID(raw string, u *url.URL) string {
	if faceitRoomRe.MatchString(raw) {
		return raw
	}
	if u == nil {
		return ""
	}
	host := strings.ToLower(u.Hostname())
	if host != "faceit.com" && !strings.HasSuffix(host, ".faceit.com") {
		return ""
	}
	segs := strings.Split(u.Path, "/")
	for i, seg := range segs {
		if seg == "room" && i+1 < len(segs) && faceitRoomRe.MatchString(segs[i+1]) {
			return segs[i+1]
		}
	}
	return ""
}

// resolveFaceitDemo turns a FACEIT match id into a signed, downloadable demo URL
// (Data API → demo resource → Download API signed URL).
func (s *Server) resolveFaceitDemo(ctx context.Context, matchID string) (string, error) {
	if s.faceit == nil || !s.faceit.HasKey() {
		return "", faceit.ErrNoAPIKey
	}
	resource, err := s.faceit.MatchDemoResource(ctx, matchID)
	if err != nil {
		return "", err
	}
	return s.faceit.SignDemoURL(ctx, resource)
}

// handleDemoFromURL enqueues a replay parse for a demo the server fetches itself,
// so the user never downloads/uploads the file. Accepts a FACEIT match-room link
// (or bare match id) — resolved to a signed demo URL via the FACEIT API — or a
// direct .dem/.bz2/.gz/.zst URL (e.g. a Valve GOTV replay link). Public +
// quota'd + SSRF-guarded.
func (s *Server) handleDemoFromURL(w http.ResponseWriter, r *http.Request) {
	if s.queue == nil {
		writeError(w, http.StatusServiceUnavailable, "demo parsing is not available right now")
		return
	}
	if ok, status, msg := s.demoQuotaOK(r); !ok {
		writeError(w, status, msg)
		return
	}
	var req struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	raw := strings.TrimSpace(req.URL)
	source := "url"

	// A bare FACEIT match id isn't a URL — check before url.Parse.
	roomID := faceitRoomID(raw, nil)
	if roomID == "" {
		if u, err := url.Parse(raw); err == nil {
			roomID = faceitRoomID(raw, u)
		}
	}
	if roomID != "" {
		signed, err := s.resolveFaceitDemo(r.Context(), roomID)
		switch {
		case err == nil:
			raw = signed
			source = "faceit"
		case errors.Is(err, faceit.ErrNoDemo):
			writeError(w, http.StatusBadRequest, "that FACEIT match has no demo available (it may be too old or not finished)")
			return
		case errors.Is(err, faceit.ErrNoDownloadScope):
			writeError(w, http.StatusServiceUnavailable, "FACEIT demo downloads aren't enabled yet on our API key — paste a direct demo file URL for now")
			return
		case errors.Is(err, faceit.ErrNotFound):
			writeError(w, http.StatusBadRequest, "FACEIT match not found — check the room link")
			return
		case errors.Is(err, faceit.ErrNoAPIKey):
			writeError(w, http.StatusServiceUnavailable, "FACEIT integration isn't configured")
			return
		default:
			s.serverError(w, "resolve faceit demo", err)
			return
		}
	}

	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		writeError(w, http.StatusBadRequest, "paste a FACEIT match-room link or a direct http(s) demo URL")
		return
	}
	lower := strings.ToLower(u.Path)
	if !strings.HasSuffix(lower, ".dem") && !strings.HasSuffix(lower, ".bz2") &&
		!strings.HasSuffix(lower, ".gz") && !strings.HasSuffix(lower, ".zst") {
		writeError(w, http.StatusBadRequest, "url must point to a .dem (optionally .bz2/.gz/.zst) file")
		return
	}
	if !isPublicHost(u.Hostname()) {
		writeError(w, http.StatusBadRequest, "that url host is not allowed")
		return
	}

	id := randID()
	name := filepath.Base(u.Path)
	if name == "" || name == "." || name == "/" {
		name = "remote.dem"
	}
	if err := s.db.CreateDemoJob(r.Context(), id, clientIP(r), name, 0); err != nil {
		s.serverError(w, "record demo job", err)
		return
	}
	job, err := s.queue.Enqueue(r.Context(), queue.Job{
		ID:      id,
		Type:    queue.JobParseReplay,
		Source:  source,
		DemoURL: raw,
	})
	if err != nil {
		_ = s.db.SetDemoStatus(r.Context(), id, "failed", "could not enqueue")
		s.serverError(w, "enqueue", err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"id": job.ID, "status": "queued"})
}

// leetifyUUIDRe matches a v3 Leetify game id (UUID). Leetify's /api/games/{id}
// resolves these to a demo reference (share code / FACEIT id), so these are the
// matches one-click analysis can actually handle.
var leetifyUUIDRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// leetifyLegacyIDRe matches the legacy "<hex>-<hex>" id (e.g.
// 7c9bc801f1a8bb51-6e7cc3) carried by profiles Leetify only serves from its
// legacy endpoint. Leetify's /api/games/ rejects these (400) and the legacy
// profile record exposes no share code — so there's no demo to resolve. We
// detect them to return a clear message instead of a generic error.
var leetifyLegacyIDRe = regexp.MustCompile(`^[0-9a-fA-F]{6,32}-[0-9a-fA-F]{4,32}$`)

// valveReplayMaxAge is how long Valve keeps GOTV replays around. Matches older
// than this get a clear "expired" error instead of a doomed download attempt.
const valveReplayMaxAge = 31 * 24 * time.Hour

// handleDemoAnalyzeMatch enqueues a demo parse for a match listed on a profile,
// identified by its Leetify game id. The server looks the match up on Leetify:
// FACEIT matches resolve via the FACEIT Download API; Premier/MM matches carry a
// Valve share code, resolved to a replay URL by the gc-bot at parse time.
// Public + quota'd; one click, no file handling for the user.
func (s *Server) handleDemoAnalyzeMatch(w http.ResponseWriter, r *http.Request) {
	if s.queue == nil {
		writeError(w, http.StatusServiceUnavailable, "demo parsing is not available right now")
		return
	}
	if s.leetify == nil {
		writeError(w, http.StatusServiceUnavailable, "match lookup is not available right now")
		return
	}
	if ok, status, msg := s.demoQuotaOK(r); !ok {
		writeError(w, status, msg)
		return
	}
	var req struct {
		GameID string `json:"gameId"`
		// The GC fallback (legacy Leetify accounts) matches the clicked row
		// against the player's recent Game Coordinator matches:
		SteamID    string `json:"steamId"`    // profile the match was listed on
		FinishedAt string `json:"finishedAt"` // RFC3339 (legacy records are day-rounded)
		Score      []int  `json:"score"`      // [team, enemy] as the row shows it
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	gameID := strings.TrimSpace(req.GameID)
	legacy := false
	switch {
	case leetifyUUIDRe.MatchString(gameID):
		// Resolvable via Leetify — continue below.
	case leetifyLegacyIDRe.MatchString(gameID):
		// Legacy-endpoint account: Leetify exposes no demo reference for these.
		// Fall back to the Game Coordinator: our Steam bot can list the player's
		// recent official matches (with replay URLs) directly.
		legacy = true
	default:
		writeError(w, http.StatusBadRequest, "invalid match id")
		return
	}

	// Charge quota UP FRONT: create the job row before any external lookup, so
	// requests that error out (unknown match, expired demo, no scope) still count
	// against the per-IP/global daily caps. Otherwise error paths are free and an
	// attacker can drive unbounded Leetify/FACEIT calls with random ids.
	id := randID()
	if err := s.db.CreateDemoJob(r.Context(), id, clientIP(r), "match.dem", 0); err != nil {
		s.serverError(w, "record demo job", err)
		return
	}
	fail := func(status int, msg string) {
		_ = s.db.SetDemoStatus(r.Context(), id, "failed", msg)
		writeError(w, status, msg)
	}

	if legacy {
		s.analyzeViaGC(w, r, id, fail, req.SteamID, req.FinishedAt, req.Score)
		return
	}

	gd, err := s.leetify.GetGameDetails(r.Context(), gameID)
	if err != nil {
		if errors.Is(err, leetify.ErrNotFound) {
			fail(http.StatusNotFound, "match not found")
			return
		}
		_ = s.db.SetDemoStatus(r.Context(), id, "failed", "match lookup failed")
		s.serverError(w, "match lookup", err)
		return
	}

	var (
		demoURL   string
		shareCode string
		source    string
	)
	switch {
	case gd.FaceitMatchID != "":
		signed, ferr := s.resolveFaceitDemo(r.Context(), gd.FaceitMatchID)
		switch {
		case ferr == nil:
			demoURL = signed
			source = "faceit"
		case errors.Is(ferr, faceit.ErrNoDemo), errors.Is(ferr, faceit.ErrNotFound):
			fail(http.StatusBadRequest, "that FACEIT match has no demo available (it may be too old)")
			return
		case errors.Is(ferr, faceit.ErrNoDownloadScope), errors.Is(ferr, faceit.ErrNoAPIKey):
			fail(http.StatusServiceUnavailable, "FACEIT demo analysis isn't enabled yet — coming soon")
			return
		default:
			_ = s.db.SetDemoStatus(r.Context(), id, "failed", "resolve faceit demo failed")
			s.serverError(w, "resolve faceit demo", ferr)
			return
		}
	case gd.SteamShareCode != "":
		if s.cfg.GCBotURL == "" {
			fail(http.StatusServiceUnavailable, "Premier/MM demo analysis isn't enabled yet — coming soon")
			return
		}
		if t, terr := time.Parse(time.RFC3339, gd.FinishedAt); terr == nil && time.Since(t) > valveReplayMaxAge {
			fail(http.StatusGone, "this match's replay has expired on Valve's servers (they keep replays ~30 days)")
			return
		}
		shareCode = gd.SteamShareCode
		source = "sharecode"
	default:
		fail(http.StatusBadRequest, "no demo reference is available for that match")
		return
	}

	job, err := s.queue.Enqueue(r.Context(), queue.Job{
		ID:        id,
		Type:      queue.JobParseReplay,
		Source:    source,
		DemoURL:   demoURL,
		ShareCode: shareCode,
	})
	if err != nil {
		_ = s.db.SetDemoStatus(r.Context(), id, "failed", "could not enqueue")
		s.serverError(w, "enqueue", err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"id": job.ID, "status": "queued"})
}

// analyzeViaGC resolves a match for a legacy-Leetify account straight from the
// Game Coordinator: the Steam bot lists the player's recent official matches
// (with replay URLs) and we pick the one matching the clicked row's score and
// (day-rounded) finish time. Steam only exposes a player's ~8 most recent
// matches, and only while their "Game details" privacy is Public.
func (s *Server) analyzeViaGC(
	w http.ResponseWriter,
	r *http.Request,
	id string,
	fail func(status int, msg string),
	steamID, finishedAt string,
	score []int,
) {
	if s.cfg.GCBotURL == "" {
		fail(http.StatusUnprocessableEntity,
			"Leetify only has a limited record for this account, so its demos can't be analyzed automatically.")
		return
	}
	sid, ok := steam.ParseSteamID64(strings.TrimSpace(steamID))
	if !ok {
		fail(http.StatusBadRequest, "invalid profile id")
		return
	}

	bot := gcbot.New(s.cfg.GCBotURL)
	matches, err := bot.Recent(r.Context(), strconv.FormatUint(sid, 10))
	if err != nil {
		if errors.Is(err, gcbot.ErrUnavailable) {
			fail(http.StatusServiceUnavailable, "the demo bot isn't connected right now — try again shortly")
			return
		}
		if errors.Is(err, gcbot.ErrNoReply) {
			// The GC silently ignores recent-match requests for accounts whose
			// "Game details" privacy isn't Public — no reply is the usual signal
			// (rarely it's a Game Coordinator hiccup, hence "usually").
			fail(http.StatusUnprocessableEntity,
				"Steam didn't return this player's match list — usually their Steam privacy setting \"Game details\" isn't Public (Edit Profile → Privacy Settings). Once it's Public this button works; until then, upload the .dem file instead.")
			return
		}
		_ = s.db.SetDemoStatus(r.Context(), id, "failed", "gc recent lookup failed")
		s.serverError(w, "gc recent games", err)
		return
	}

	var ft time.Time
	if t, terr := time.Parse(time.RFC3339, finishedAt); terr == nil {
		ft = t
	}
	// Legacy finish times are day-rounded to midnight UTC, so on a score
	// collision "closest to ft" would systematically prefer the previous
	// evening's game over the actual afternoon one. Rank candidates instead:
	// matches INSIDE the row's UTC day beat matches merely near it, and within
	// the same class the most recent wins (the user clicked a recent row).
	var best *gcbot.RecentMatch
	bestInDay := false
	var bestTime int64 = -1
	for i := range matches {
		m := &matches[i]
		if len(score) == 2 && len(m.Scores) == 2 {
			a, b := score[0], score[1]
			if !((m.Scores[0] == a && m.Scores[1] == b) || (m.Scores[0] == b && m.Scores[1] == a)) {
				continue
			}
		}
		inDay := false
		if !ft.IsZero() && m.Time > 0 {
			mt := time.Unix(m.Time, 0)
			diff := mt.Sub(ft)
			if diff < 0 {
				diff = -diff
			}
			// allow the full day plus timezone slack either way
			if diff > 40*time.Hour {
				continue
			}
			inDay = !mt.Before(ft) && mt.Before(ft.Add(24*time.Hour))
		}
		better := best == nil ||
			(inDay && !bestInDay) ||
			(inDay == bestInDay && m.Time > bestTime)
		if better {
			best, bestInDay, bestTime = m, inDay, m.Time
		}
	}

	if best == nil {
		fail(http.StatusUnprocessableEntity,
			"Steam couldn't match this game — the Game Coordinator only lists a player's ~8 most recent matches, and their Steam \"Game details\" privacy must be Public. You can still analyze it by uploading the .dem.")
		return
	}
	if best.Time > 0 && time.Since(time.Unix(best.Time, 0)) > valveReplayMaxAge {
		fail(http.StatusGone, "this match's replay has expired on Valve's servers (they keep replays ~30 days)")
		return
	}
	if best.DemoURL == "" {
		fail(http.StatusUnprocessableEntity, "Steam has no downloadable replay for this match.")
		return
	}

	job, err := s.queue.Enqueue(r.Context(), queue.Job{
		ID:      id,
		Type:    queue.JobParseReplay,
		Source:  "valve",
		DemoURL: best.DemoURL,
	})
	if err != nil {
		_ = s.db.SetDemoStatus(r.Context(), id, "failed", "could not enqueue")
		s.serverError(w, "enqueue", err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"id": job.ID, "status": "queued"})
}

// demoObjectKey is the deterministic object-storage key for a demo id. Deriving
// it from the id (instead of trusting a client-supplied key) means a presigned
// upload and its parse request can't be pointed at someone else's object.
func demoObjectKey(id string) string { return "uploads/" + id + ".dem" }

// handleDemoPresign issues a direct-to-object-storage upload URL for a .dem. The
// browser PUTs the file straight to the bucket — bypassing our servers and the
// proxy body-size limit — then calls handleDemoParse. When object storage isn't
// configured it tells the client to use the multipart fallback instead.
func (s *Server) handleDemoPresign(w http.ResponseWriter, r *http.Request) {
	if s.blob == nil {
		writeJSON(w, http.StatusOK, map[string]any{"mode": "direct", "maxBytes": int64(demoMaxUploadBytes)})
		return
	}
	if s.queue == nil {
		writeError(w, http.StatusServiceUnavailable, "demo parsing is not available right now")
		return
	}

	// Read-only quota check for fast feedback before the user uploads. The
	// authoritative gate (and the row that counts toward quota) is in
	// handleDemoParse — presign itself creates nothing, so an abandoned presign
	// never consumes quota or leaves an orphan row.
	if ok, status, msg := s.demoQuotaOK(r); !ok {
		writeError(w, status, msg)
		return
	}

	var req struct {
		Filename    string `json:"filename"`
		ContentType string `json:"contentType"`
		Size        int64  `json:"size"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if !strings.HasSuffix(strings.ToLower(req.Filename), ".dem") {
		writeError(w, http.StatusBadRequest, "file must be a .dem")
		return
	}
	if req.Size <= 0 {
		writeError(w, http.StatusBadRequest, "missing file size")
		return
	}
	if req.Size > s.cfg.DemoMaxBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "demo exceeds the size limit")
		return
	}

	id := randID()
	contentType := req.ContentType
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	url, err := s.blob.SignPutURL(r.Context(), demoObjectKey(id), contentType, s.cfg.DemoURLTTL)
	if err != nil {
		s.serverError(w, "sign upload url", err)
		return
	}

	// No DB row yet: it's created (and quota charged) only when the browser has
	// uploaded and calls /parse, so abandoned presigns cost nothing.
	writeJSON(w, http.StatusOK, map[string]any{
		"mode":        "gcs",
		"id":          id,
		"url":         url,
		"contentType": contentType,
	})
}

// handleDemoParse enqueues a parse job for a demo already uploaded to object
// storage via a presigned URL. The object key is derived from the id, so a
// client can't point parsing at an arbitrary object. Inserting the row with
// ON CONFLICT DO NOTHING makes this idempotent: a repeated /parse for the same
// id (double-click, retry, redelivery) neither re-enqueues work nor clobbers a
// finished result, and the row is what counts toward quota.
func (s *Server) handleDemoParse(w http.ResponseWriter, r *http.Request) {
	if s.blob == nil || s.queue == nil {
		writeError(w, http.StatusServiceUnavailable, "demo parsing is not available right now")
		return
	}
	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&req); err != nil || req.ID == "" {
		writeError(w, http.StatusBadRequest, "missing demo id")
		return
	}
	// Reject ids that aren't ours so a client can't enqueue arbitrary work.
	if _, err := hex.DecodeString(req.ID); err != nil || len(req.ID) != 24 {
		writeError(w, http.StatusBadRequest, "invalid demo id")
		return
	}

	if ok, status, msg := s.demoQuotaOK(r); !ok {
		writeError(w, status, msg)
		return
	}

	created, err := s.db.CreateDemoJobIfAbsent(r.Context(), req.ID, clientIP(r))
	if err != nil {
		s.serverError(w, "record demo job", err)
		return
	}
	if !created {
		// Already submitted — idempotent: report current status, don't re-enqueue.
		writeJSON(w, http.StatusAccepted, map[string]string{"id": req.ID, "status": "queued"})
		return
	}

	job, err := s.queue.Enqueue(r.Context(), queue.Job{
		ID:        req.ID,
		Type:      queue.JobParseReplay,
		Source:    "gcs",
		ObjectKey: demoObjectKey(req.ID),
	})
	if err != nil {
		_ = s.db.SetDemoStatus(r.Context(), req.ID, "failed", "could not enqueue")
		s.serverError(w, "enqueue", err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"id": job.ID, "status": "queued"})
}

// handleDemoJob returns a demo parse job's pollable status.
func (s *Server) handleDemoJob(w http.ResponseWriter, r *http.Request) {
	st, err := s.db.GetDemoJob(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, "demo not found")
		return
	}
	if err != nil {
		s.serverError(w, "demo job", err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// handleDemoData streams the gzipped normalized replay JSON for a finished demo.
func (s *Server) handleDemoData(w http.ResponseWriter, r *http.Request) {
	data, _, err := s.db.GetDemoData(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, "demo result not ready")
		return
	}
	if err != nil {
		s.serverError(w, "demo data", err)
		return
	}
	// Private per-browser content keyed only by an unguessable id — must not be
	// stored by Cloudflare or any shared cache.
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Encoding", "gzip")
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
