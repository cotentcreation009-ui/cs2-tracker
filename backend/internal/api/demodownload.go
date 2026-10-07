package api

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/cs2tracker/server/internal/cache"
	"github.com/cs2tracker/server/internal/faceit"
	"github.com/cs2tracker/server/internal/gcbot"
	"github.com/go-chi/chi/v5"
)

// demoDownload is the answer to "where can this game's demo be downloaded?".
// Either a direct link to the host that keeps the file (Valve's replay servers
// or FACEIT's signed storage) or the plain reason there is none. The browser
// does not fetch a Valve link itself — Valve serves plain http, which an https
// page cannot start a download from — so the sibling /demo/file route
// (demodownloadfile.go) streams those bytes through this server instead.
type demoDownload struct {
	Available bool   `json:"available"`
	URL       string `json:"url,omitempty"`
	Source    string `json:"source,omitempty"`   // "valve" | "faceit"
	Filename  string `json:"filename,omitempty"` // .dem.bz2 from Valve, .dem.zst/.gz from FACEIT
	// ExpiresAt is when Valve stops hosting the replay (about a month after
	// the game). Absent for FACEIT, whose signed links are short-lived and are
	// simply asked for again.
	ExpiresAt string `json:"expires_at,omitempty"`
	// Reason is a sentence a player can read; Code is the same thing for code.
	Reason string `json:"reason,omitempty"`
	Code   string `json:"code,omitempty"`
	// RoomURL is the FACEIT match room, where a signed-in player can fetch the
	// demo themselves when we cannot hand out a link.
	RoomURL string `json:"room_url,omitempty"`
}

// How long each kind of answer is remembered. A Valve replay URL is stable for
// the replay's life, so it is kept for hours; a FACEIT link is signed and
// short-lived, so only long enough to absorb a double click. Refusals that
// cannot change (expired, nothing recorded) are kept long, ones that will
// clear on their own (Leetify paused, bot offline) for seconds.
const (
	demoDLValveTTL     = 6 * time.Hour
	demoDLFaceitTTL    = 2 * time.Minute
	demoDLGoneTTL      = 24 * time.Hour
	demoDLMissTTL      = 30 * time.Minute
	demoDLSetupTTL     = 10 * time.Minute
	demoDLResolveLimit = 25 * time.Second
)

// The route asks the gc-bot (one Steam session) or FACEIT on a cache miss, so
// it gets its own small per-IP bucket on top of whatever the group applies:
// one lookup every five seconds sustained, six in a burst.
const (
	demoDLRatePerSec = 0.2
	demoDLRateBurst  = 6
)

func demoUnavailable(code, reason string) demoDownload {
	return demoDownload{Code: code, Reason: reason}
}

// handleLeetifyGameDemo resolves where one listed game's demo can be
// downloaded, the same way one-click analysis finds it, without starting a
// job or charging the analysis quota. Read-only.
//
//	GET /api/players/{steamid}/leetify-game/{gameId}/demo
//
// A resolved game answers 200 either way — {available:true, url, source,
// filename} or {available:false, reason, code} — because "Valve dropped this
// replay" is an answer, not a failure. Legacy-format game ids (accounts
// Leetify only half-tracks) are matched against the player's Game Coordinator
// match list, which needs the row's finishedAt and score as query parameters.
func (s *Server) handleLeetifyGameDemo(w http.ResponseWriter, r *http.Request) {
	sid, gameID, legacy, ok := demoDownloadParams(w, r)
	if !ok {
		return
	}
	// The link is per-game state that changes (and, for FACEIT, expires), so
	// nothing downstream may keep it; our own cache is the only one.
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, s.resolveDemoDownload(r, sid, gameID, legacy))
}

// demoDownloadParams reads the route's two identifiers, answering 400 itself
// when either is malformed. legacy says the game id is in Leetify's old
// format, which only the Game Coordinator's match list can resolve.
func demoDownloadParams(w http.ResponseWriter, r *http.Request) (sid uint64, gameID string, legacy, ok bool) {
	sid, ok = steamIDParam(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid SteamID64")
		return 0, "", false, false
	}
	gameID = chi.URLParam(r, "gameId")
	switch {
	case leetifyUUIDRe.MatchString(gameID):
	case leetifyLegacyIDRe.MatchString(gameID):
		legacy = true
	default:
		writeError(w, http.StatusBadRequest, "invalid game id")
		return 0, "", false, false
	}
	return sid, gameID, legacy, true
}

// resolveDemoDownload is the cached, coalesced resolution behind both the
// link route and the file route (demodownloadfile.go): one answer per game
// per profile, remembered for as long as that kind of answer stays true.
func (s *Server) resolveDemoDownload(r *http.Request, sid uint64, gameID string, legacy bool) demoDownload {
	ctx, cancel := context.WithTimeout(r.Context(), demoDLResolveLimit)
	defer cancel()
	key := cache.LeetifyGameDemoKey(gameID, sid)
	kv := s.kv()

	var v demoDownload
	if kv != nil {
		if hit, _ := kv.GetJSON(ctx, key, &v); hit {
			return v
		}
	}
	res, _, _ := s.sf.Do(key, func() (any, error) {
		var (
			out demoDownload
			ttl time.Duration
		)
		if legacy {
			out, ttl = s.demoDownloadViaGC(ctx, sid, r.URL.Query().Get("finishedAt"), parseScoreParam(r.URL.Query().Get("score")))
		} else {
			out, ttl = s.demoDownloadForGame(ctx, sid, gameID)
		}
		if kv != nil && ttl > 0 {
			_ = kv.SetJSONTTL(ctx, key, out, ttl)
		}
		return out, nil
	})
	return res.(demoDownload)
}

// demoDownloadForGame resolves a v3 (UUID) Leetify game. It returns the answer
// and how long that answer may be remembered.
func (s *Server) demoDownloadForGame(ctx context.Context, sid uint64, gameID string) (demoDownload, time.Duration) {
	if s.leetify == nil {
		return demoUnavailable("leetify_unavailable", "Match lookup isn't available right now, so this demo can't be located."), unavailableCacheTTL
	}
	ref, err := s.lookupDemoRef(ctx, gameID, sid)
	switch {
	case err == nil:
	case errors.Is(err, errDemoLeetifyPaused):
		return demoUnavailable("leetify_unavailable", "Leetify isn't answering right now, so this match's demo can't be looked up — try again in a few minutes."), unavailableCacheTTL
	case errors.Is(err, errDemoMatchNotFound):
		return demoUnavailable("unknown_game", "Leetify has no record of this match, so there is no demo to find."), demoDLMissTTL
	case errors.Is(err, errDemoNoReference):
		return demoUnavailable("no_demo", "No demo was recorded for this game — it is listed without a Valve share code or a FACEIT match id."), demoDLMissTTL
	default:
		s.log.Warn("demo download: match lookup failed", "game", gameID, "err", err)
		return demoUnavailable("leetify_unavailable", "Leetify isn't answering right now, so this match's demo can't be looked up — try again in a few minutes."), unavailableCacheTTL
	}
	if ref.ShareCode != "" {
		return s.demoDownloadValve(ctx, ref.ShareCode, ref.Finished)
	}
	return s.demoDownloadFaceit(ctx, ref.FaceitMatchID)
}

const (
	reasonValveExpired = "Valve no longer hosts this demo (older than about a month)."
	reasonBotOffline   = "Our Steam bot isn't connected right now, so Valve can't be asked for this demo — try again shortly."
)

// demoDownloadValve turns a share code into Valve's replay URL through the
// gc-bot — the same call the worker makes when it analyses the game.
func (s *Server) demoDownloadValve(ctx context.Context, shareCode string, finished time.Time) (demoDownload, time.Duration) {
	if valveReplayExpired(finished) {
		return demoUnavailable("valve_expired", reasonValveExpired), demoDLGoneTTL
	}
	if s.cfg.GCBotURL == "" {
		return demoUnavailable("valve_unconfigured", "Premier and matchmaking demo downloads aren't enabled on this site yet."), demoDLSetupTTL
	}
	raw, err := gcbot.New(s.cfg.GCBotURL).Resolve(ctx, shareCode)
	switch {
	case err == nil:
	case errors.Is(err, gcbot.ErrNotFound):
		return demoUnavailable("valve_no_replay", "Valve has no replay for this match — it has expired or was never recorded."), demoDLMissTTL
	case errors.Is(err, gcbot.ErrUnavailable):
		return demoUnavailable("bot_unavailable", reasonBotOffline), unavailableCacheTTL
	default:
		s.log.Warn("demo download: gc-bot resolve failed", "err", err)
		return demoUnavailable("bot_unavailable", reasonBotOffline), unavailableCacheTTL
	}
	return valveDownload(raw, finished)
}

// valveDownload shapes a Valve replay URL into the answer, refusing anything
// that is not a plain web link (the URL comes from the Game Coordinator and
// ends up in a browser's address bar).
func valveDownload(raw string, finished time.Time) (demoDownload, time.Duration) {
	name, ok := demoLinkName(raw)
	if !ok {
		return demoUnavailable("valve_no_replay", "Valve has no downloadable replay for this match."), demoDLMissTTL
	}
	out := demoDownload{Available: true, URL: raw, Source: "valve", Filename: name}
	ttl := demoDLValveTTL
	if !finished.IsZero() && finished.Year() > 1971 {
		gone := finished.Add(valveReplayMaxAge)
		out.ExpiresAt = gone.UTC().Format(time.RFC3339)
		// never remember the link past the day Valve drops the file
		if left := time.Until(gone); left < ttl {
			ttl = left
		}
	}
	return out, ttl
}

// demoDownloadFaceit asks FACEIT's Download API for a signed link. That API
// needs its own scope, which FACEIT grants separately; without it the honest
// answer is "not enabled", plus the match room where the player can fetch the
// demo with their own FACEIT account.
func (s *Server) demoDownloadFaceit(ctx context.Context, matchID string) (demoDownload, time.Duration) {
	room := "https://www.faceit.com/en/cs2/room/" + url.PathEscape(matchID)
	fail := func(code, reason string, ttl time.Duration) (demoDownload, time.Duration) {
		out := demoUnavailable(code, reason)
		out.RoomURL = room
		return out, ttl
	}
	signed, err := s.resolveFaceitDemo(ctx, matchID)
	switch {
	case err == nil:
	case errors.Is(err, faceit.ErrNoDemo), errors.Is(err, faceit.ErrNotFound):
		return fail("faceit_no_demo", "FACEIT has no demo for this match (it may be too old).", demoDLMissTTL)
	case errors.Is(err, faceit.ErrNoDownloadScope), errors.Is(err, faceit.ErrNoAPIKey):
		s.log.Error("faceit downloads token missing/unscoped — set FACEIT_DOWNLOAD_API_KEY to the Downloads-scoped access token from the FACEIT developer portal")
		return fail("faceit_scope", "FACEIT demo downloads aren't enabled on this site yet — FACEIT has to grant us its Download API access first.", demoDLSetupTTL)
	default:
		s.log.Warn("demo download: faceit resolve failed", "match", matchID, "err", err)
		return fail("faceit_unavailable", "FACEIT isn't answering right now, so this demo can't be linked — try again in a few minutes.", unavailableCacheTTL)
	}
	name, ok := demoLinkName(signed)
	if !ok {
		return fail("faceit_no_demo", "FACEIT has no downloadable demo for this match.", demoDLMissTTL)
	}
	return demoDownload{Available: true, URL: signed, Source: "faceit", Filename: name, RoomURL: room}, demoDLFaceitTTL
}

// demoDownloadViaGC resolves a legacy-Leetify row straight from the Game
// Coordinator, as analysis does for those accounts: the bot lists the player's
// recent official matches (replay URLs included) and the row's score and
// finish time pick one.
func (s *Server) demoDownloadViaGC(ctx context.Context, sid uint64, finishedAt string, score []int) (demoDownload, time.Duration) {
	if s.cfg.GCBotURL == "" {
		return demoUnavailable("no_demo", "Leetify only has a limited record for this account, so this game's demo can't be located."), demoDLSetupTTL
	}
	matches, err := gcbot.New(s.cfg.GCBotURL).Recent(ctx, strconv.FormatUint(sid, 10))
	switch {
	case err == nil:
	case errors.Is(err, gcbot.ErrNoReply):
		return demoUnavailable("steam_private", "Steam didn't return this player's match list — usually their Steam privacy setting \"Game details\" isn't Public."), demoDLSetupTTL
	case errors.Is(err, gcbot.ErrUnavailable):
		return demoUnavailable("bot_unavailable", reasonBotOffline), unavailableCacheTTL
	default:
		s.log.Warn("demo download: gc-bot recent failed", "err", err)
		return demoUnavailable("bot_unavailable", reasonBotOffline), unavailableCacheTTL
	}
	best := pickGCMatch(matches, finishedAt, score)
	if best == nil {
		return demoUnavailable("no_demo", "Steam only lists a player's ~8 most recent matches, and this game isn't among them."), demoDLSetupTTL
	}
	var finished time.Time
	if best.Time > 0 {
		finished = time.Unix(best.Time, 0)
	}
	if valveReplayExpired(finished) {
		return demoUnavailable("valve_expired", reasonValveExpired), demoDLGoneTTL
	}
	return valveDownload(best.DemoURL, finished)
}

// demoLinkName validates a demo link (http or https, with a host) and returns
// the file name its path ends in.
func demoLinkName(raw string) (string, bool) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", false
	}
	name := path.Base(u.Path)
	if name == "" || name == "." || name == "/" {
		name = "match.dem"
	}
	return name, true
}

// parseScoreParam reads "13-7" into [13, 7]; anything else is no score.
func parseScoreParam(s string) []int {
	a, b, ok := strings.Cut(strings.TrimSpace(s), "-")
	if !ok {
		return nil
	}
	x, err1 := strconv.Atoi(a)
	y, err2 := strconv.Atoi(b)
	if err1 != nil || err2 != nil || x < 0 || y < 0 {
		return nil
	}
	return []int{x, y}
}
