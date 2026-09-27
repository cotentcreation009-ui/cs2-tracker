package api

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/cs2tracker/server/internal/db"
)

// The crowd cache for pro-player photos.
//
// The backend cannot ask Liquipedia for a player's photo: they rate-limit
// datacenter IPs, and from the VM every attempt hangs for seconds and then
// 429s (internal/liquipedia is kept for the day that changes). So photos
// resolve in each visitor's browser, at Liquipedia's one-request-per-two-
// seconds pace — on a cold browser the hundred roster rows of the pro board
// take most of a minute to fill, and a visitor who leaves early never sees
// the bottom half.
//
// This closes the loop. A browser that resolved a photo reports the
// (nick, URL) pair here; the spotlight response carries every pair we know
// (knownPhotos, prospotlight.go), so the next visitor's page paints those
// photos immediately and asks Liquipedia only about players nobody has seen
// yet. After a handful of visits the whole board is instant for everyone.
//
// Trust. The report is unauthenticated, so what it can say is narrow: a URL
// is accepted only on Liquipedia's own host, under its images path, naming an
// image file, with nothing else attached — the worst a bad actor can do is
// point one nick at a different Liquipedia photo until the next honest
// visitor's report replaces it. Reports are capped per IP and per request.

const (
	proPhotoMaxPerReport = 60
	proPhotoMaxBody      = 32 << 10
	proPhotoReportsPerIP = 40 // per hour
	proPhotoMaxURL       = 400
	proPhotoMaxNick      = 40
	proPhotoHost         = "liquipedia.net"
	proPhotoPathPrefix   = "/commons/images/"
)

type proPhotoReport struct {
	Nick string `json:"nick"`
	URL  string `json:"url"`
}

// validProPhotoURL is the whole of the trust boundary: https, Liquipedia's
// host and images path, an image extension, and no query, fragment or
// credentials that could turn the link into something else.
func validProPhotoURL(raw string) bool {
	if raw == "" || len(raw) > proPhotoMaxURL {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	if u.Scheme != "https" || u.Host != proPhotoHost || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return false
	}
	if !strings.HasPrefix(u.Path, proPhotoPathPrefix) || strings.Contains(u.Path, "..") {
		return false
	}
	lower := strings.ToLower(u.Path)
	return strings.HasSuffix(lower, ".jpg") || strings.HasSuffix(lower, ".jpeg") || strings.HasSuffix(lower, ".png")
}

// validProPhotoNick admits the nicks the rails show (Valve's roster strings)
// and refuses anything that could not be one: empty, overlong, or carrying a
// control character or a MediaWiki title separator.
func validProPhotoNick(nick string) bool {
	n := strings.TrimSpace(nick)
	if n == "" || len(n) > proPhotoMaxNick {
		return false
	}
	for _, r := range n {
		if r < 0x20 || r == 0x7f || r == '|' || r == '#' || r == '<' || r == '>' {
			return false
		}
	}
	return true
}

// crude per-IP limiter, same shape as the AI one: a report is cheap, but an
// unbounded stream of them is a write per request on the database.
var (
	proPhotoMu   sync.Mutex
	proPhotoHits = map[string][]int64{}
)

func proPhotoAllow(ip string, now time.Time) bool {
	cutoff := now.Add(-time.Hour).Unix()
	proPhotoMu.Lock()
	defer proPhotoMu.Unlock()
	var hits []int64
	for _, t := range proPhotoHits[ip] {
		if t > cutoff {
			hits = append(hits, t)
		}
	}
	if len(hits) >= proPhotoReportsPerIP {
		proPhotoHits[ip] = hits
		return false
	}
	proPhotoHits[ip] = append(hits, now.Unix())
	return true
}

// handleProPhotoReport takes {"photos":[{"nick","url"},…]} from a browser
// that resolved them and stores the acceptable ones. Answers how many it
// took, so the client can tell a rejected batch from a stored one.
func (s *Server) handleProPhotoReport(w http.ResponseWriter, r *http.Request) {
	if !proPhotoAllow(clientIP(r), time.Now()) {
		writeError(w, http.StatusTooManyRequests, "too many photo reports from this address")
		return
	}
	var body struct {
		Photos []proPhotoReport `json:"photos"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, proPhotoMaxBody)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "body must be JSON {photos:[{nick,url}]}")
		return
	}
	if len(body.Photos) == 0 || len(body.Photos) > proPhotoMaxPerReport {
		writeError(w, http.StatusBadRequest, "1 to 60 photos per report")
		return
	}
	accepted := make([]db.ProPhoto, 0, len(body.Photos))
	for _, p := range body.Photos {
		if !validProPhotoNick(p.Nick) || !validProPhotoURL(p.URL) {
			continue
		}
		accepted = append(accepted, db.ProPhoto{Nick: strings.TrimSpace(p.Nick), URL: p.URL})
	}
	if len(accepted) == 0 {
		writeError(w, http.StatusBadRequest, "no acceptable photos in the report")
		return
	}
	if err := s.db.UpsertProPhotos(r.Context(), accepted); err != nil {
		s.log.Warn("pro photos: store failed", "err", err, "n", len(accepted))
		writeError(w, http.StatusInternalServerError, "could not store the photos")
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"accepted": len(accepted)})
}

// knownPhotos is the crowd cache for every nick on the spotlight rails, keyed
// by lower-cased nick. Empty (never an error) when the store has none or is
// unreachable — a missing photo is a placeholder, not a broken page.
func (s *Server) knownPhotos(r *http.Request, out spotlightResp) map[string]string {
	if s.db == nil {
		return nil
	}
	seen := map[string]bool{}
	nicks := make([]string, 0, 128)
	add := func(n string) {
		k := strings.ToLower(strings.TrimSpace(n))
		if k != "" && !seen[k] {
			seen[k] = true
			nicks = append(nicks, k)
		}
	}
	for _, p := range out.Players {
		add(p.Nick)
	}
	for _, t := range out.Teams {
		for _, n := range t.Roster {
			add(n)
		}
	}
	if len(nicks) == 0 {
		return nil
	}
	photos, err := s.db.ProPhotos(r.Context(), nicks)
	if err != nil {
		s.log.Warn("spotlight: photo cache unavailable", "err", err)
		return nil
	}
	return photos
}
