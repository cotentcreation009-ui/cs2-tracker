// Package liquipedia resolves pro-player photos from the Liquipedia
// Counter-Strike wiki via its public MediaWiki API.
//
// Terms compliance (https://liquipedia.net/api-terms-of-use):
//   - identifying User-Agent with contact info (generic UAs get blocked)
//   - max 1 request per 2 seconds (enforced with a client-side limiter)
//   - results are cached hard by the caller (Redis, 14 days) so a player is
//     resolved at most once per fortnight site-wide
//   - content is CC BY-SA 3.0 — the frontend shows a Liquipedia attribution
package liquipedia

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// ErrRateLimited is returned while the client is backing off after a 429
// (Liquipedia rate-limits datacenter IP ranges — GCE traffic can be refused
// outright). Callers should treat it as a soft miss.
var ErrRateLimited = errors.New("liquipedia: backing off after 429")

const (
	apiURL    = "https://liquipedia.net/counterstrike/api.php"
	userAgent = "StatRun/1.0 (https://csrun.win; cotentcreation009@gmail.com)"
	// maxPhotoBytes caps a fetched thumbnail; 256px event photos are ~10-30KB.
	maxPhotoBytes = 1 << 20
)

// Photo is a resolved player photo: raw thumbnail bytes + mime type.
// Serialized to the cache as-is (Data marshals to base64).
type Photo struct {
	Mime string `json:"mime"`
	Data []byte `json:"data"`
}

type Client struct {
	http *http.Client
	lim  *rate.Limiter
	log  *slog.Logger

	mu         sync.Mutex
	pauseUntil time.Time // set after a 429; calls fail fast until then
}

func NewClient(log *slog.Logger) *Client {
	if log == nil {
		log = slog.Default()
	}
	return &Client{
		http: &http.Client{Timeout: 15 * time.Second},
		// slightly slower than the mandated 1 req / 2s
		lim: rate.NewLimiter(rate.Every(2100*time.Millisecond), 1),
		log: log,
	}
}

// mwPages is the fragment of a MediaWiki query response we care about.
type mwPages struct {
	Query struct {
		Pages map[string]struct {
			Title     string `json:"title"`
			ImageInfo []struct {
				ThumbURL string `json:"thumburl"`
				URL      string `json:"url"`
				Mime     string `json:"mime"`
			} `json:"imageinfo"`
		} `json:"pages"`
	} `json:"query"`
}

var yearRe = regexp.MustCompile(`20\d\d`)

// PlayerPhoto resolves a player's most recent event photo by nickname.
// Returns nil (no error) when the player has no page or no photo — the
// caller negative-caches that. One MediaWiki call + one image download,
// both behind the rate limiter.
func (c *Client) PlayerPhoto(ctx context.Context, nick string) (*Photo, error) {
	nick = strings.TrimSpace(nick)
	if nick == "" || len(nick) > 48 {
		return nil, nil
	}

	// One query: the player's page → every file used on it, with thumb URLs.
	q := url.Values{
		"action":     {"query"},
		"format":     {"json"},
		"redirects":  {"1"},
		"titles":     {nick},
		"generator":  {"images"},
		"gimlimit":   {"50"},
		"prop":       {"imageinfo"},
		"iiprop":     {"url|mime"},
		"iiurlwidth": {"256"},
	}
	body, err := c.get(ctx, apiURL+"?"+q.Encode())
	if err != nil {
		return nil, err
	}
	var resp mwPages
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("liquipedia: decode: %w", err)
	}

	// Player photos follow "File:<Nick> at <Event>.jpg" (or "@"). Requiring
	// the nickname prefix keeps disambiguation pages and team/event icons out;
	// among matches, the newest year (then name) wins — that's the infobox shot.
	photoRe := regexp.MustCompile(`(?i)^File:` + regexp.QuoteMeta(nick) + `\s*(?:at|@)\s+.+\.(?:jpe?g|png)$`)
	bestKey := ""
	bestURL := ""
	for _, p := range resp.Query.Pages {
		if !photoRe.MatchString(p.Title) || len(p.ImageInfo) == 0 {
			continue
		}
		ii := p.ImageInfo[0]
		u := ii.ThumbURL
		if u == "" {
			u = ii.URL
		}
		if u == "" {
			continue
		}
		year := "0"
		if ys := yearRe.FindAllString(p.Title, -1); len(ys) > 0 {
			year = ys[len(ys)-1]
		}
		key := year + "|" + p.Title
		if key > bestKey {
			bestKey, bestURL = key, u
		}
	}
	if bestURL == "" {
		return nil, nil
	}

	img, mime, err := c.getImage(ctx, bestURL)
	if err != nil {
		return nil, err
	}
	return &Photo{Mime: mime, Data: img}, nil
}

// checkPause fails fast while backing off; note429 starts a backoff window.
func (c *Client) checkPause() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if time.Now().Before(c.pauseUntil) {
		return ErrRateLimited
	}
	return nil
}

func (c *Client) note429() {
	c.mu.Lock()
	c.pauseUntil = time.Now().Add(15 * time.Minute)
	c.mu.Unlock()
	c.log.Warn("liquipedia rate-limited this IP; pausing lookups", "until", c.pauseUntil)
}

func (c *Client) get(ctx context.Context, u string) ([]byte, error) {
	if err := c.checkPause(); err != nil {
		return nil, err
	}
	if err := c.lim.Wait(ctx); err != nil {
		return nil, err
	}
	// re-check after the limiter wait: a 429 on an earlier queued call must
	// fail the rest of the queue fast, not after another limiter slot each
	if err := c.checkPause(); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	// Go's transport negotiates gzip and decompresses transparently (a terms
	// requirement) as long as Accept-Encoding isn't set manually.
	req.Header.Set("User-Agent", userAgent)
	res, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusTooManyRequests {
		c.note429()
		return nil, ErrRateLimited
	}
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("liquipedia: status %d", res.StatusCode)
	}
	return io.ReadAll(io.LimitReader(res.Body, maxPhotoBytes))
}

func (c *Client) getImage(ctx context.Context, u string) ([]byte, string, error) {
	if err := c.checkPause(); err != nil {
		return nil, "", err
	}
	if err := c.lim.Wait(ctx); err != nil {
		return nil, "", err
	}
	if err := c.checkPause(); err != nil {
		return nil, "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", userAgent)
	res, err := c.http.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusTooManyRequests {
		c.note429()
		return nil, "", ErrRateLimited
	}
	if res.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("liquipedia: image status %d", res.StatusCode)
	}
	mime := res.Header.Get("Content-Type")
	if !strings.HasPrefix(mime, "image/") {
		return nil, "", fmt.Errorf("liquipedia: unexpected content-type %q", mime)
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, maxPhotoBytes))
	if err != nil {
		return nil, "", err
	}
	return b, mime, nil
}
