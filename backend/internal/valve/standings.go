// Package valve reads Counter-Strike's OFFICIAL team ranking — the Valve
// Regional Standings that decide Major invitations — from the public
// repository Valve publishes them in:
//
//	github.com/ValveSoftware/counter-strike_regional_standings
//
// This exists because there is no other honest source. HLTV's ranking has no
// API and blocks server-side reads, and ordering teams by how often they show
// up in the matches we happen to track produces a list of qualifier sides, not
// a list of the best teams in the world. Valve's standings are authoritative,
// public, and free to read, so they are what "top teams" means here.
//
// The standings are regenerated roughly monthly. Nothing about this needs to
// be fresh to the minute; callers should cache it for hours.
package valve

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	contentsAPI = "https://api.github.com/repos/ValveSoftware/counter-strike_regional_standings/contents/live"
	rawBase     = "https://raw.githubusercontent.com/ValveSoftware/counter-strike_regional_standings/main/live"
)

// ErrNoStandings means we reached the repository but found nothing that looks
// like a standings table — a layout change upstream, not a transient failure.
var ErrNoStandings = errors.New("valve: no standings table found")

// Team is one row of the global standings.
type Team struct {
	Standing int      `json:"standing"`
	Points   int      `json:"points"`
	Name     string   `json:"name"`
	Roster   []string `json:"roster,omitempty"`
	// AsOf is the date stamped on the file the row came from, so the UI can
	// say how current the ranking is rather than implying it is live.
	AsOf string `json:"asOf,omitempty"`
}

type Client struct {
	http *http.Client
	log  *slog.Logger
}

func NewClient(log *slog.Logger) *Client {
	if log == nil {
		log = slog.Default()
	}
	return &Client{
		// GitHub is quick and this runs behind a long cache; a short budget
		// keeps a slow raw.githubusercontent from holding a request open.
		http: &http.Client{Timeout: 12 * time.Second},
		log:  log,
	}
}

// TopTeams returns the current global standings, best first, capped at limit.
func (c *Client) TopTeams(ctx context.Context, limit int) ([]Team, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	name, err := c.latestGlobalFile(ctx)
	if err != nil {
		return nil, err
	}
	year := yearFromName(name)
	body, err := c.get(ctx, fmt.Sprintf("%s/%s/%s", rawBase, year, name))
	if err != nil {
		return nil, err
	}
	teams := parseStandings(string(body), asOfFromName(name))
	if len(teams) == 0 {
		return nil, ErrNoStandings
	}
	if len(teams) > limit {
		teams = teams[:limit]
	}
	return teams, nil
}

// latestGlobalFile finds the most recent standings_global_*.md. The repo has
// no "current" alias — every regeneration lands as a new dated file — so the
// newest year directory is listed and the last filename taken. Filenames are
// zero-padded (standings_global_2026_08_03.md), so lexical order IS date order.
func (c *Client) latestGlobalFile(ctx context.Context) (string, error) {
	years, err := c.listNames(ctx, contentsAPI)
	if err != nil {
		return "", err
	}
	var yrs []string
	for _, y := range years {
		if len(y) == 4 && isDigits(y) {
			yrs = append(yrs, y)
		}
	}
	if len(yrs) == 0 {
		return "", ErrNoStandings
	}
	sort.Strings(yrs)

	// Walk back through years: a new year's directory can exist before it has
	// a global file in it, and December's ranking is still the right answer
	// in that window.
	for i := len(yrs) - 1; i >= 0; i-- {
		files, err := c.listNames(ctx, contentsAPI+"/"+yrs[i])
		if err != nil {
			return "", err
		}
		var globals []string
		for _, f := range files {
			if strings.HasPrefix(f, "standings_global_") && strings.HasSuffix(f, ".md") {
				globals = append(globals, f)
			}
		}
		if len(globals) > 0 {
			sort.Strings(globals)
			return globals[len(globals)-1], nil
		}
	}
	return "", ErrNoStandings
}

func (c *Client) listNames(ctx context.Context, url string) ([]string, error) {
	body, err := c.get(ctx, url)
	if err != nil {
		return nil, err
	}
	var entries []struct {
		Name string `json:"name"`
		Type string `json:"type"`
	}
	if err := json.Unmarshal(body, &entries); err != nil {
		// The contents API answers an object (not an array) for errors such as
		// rate limiting; say so rather than reporting a parse failure.
		return nil, fmt.Errorf("valve: unexpected contents payload from %s: %w", url, err)
	}
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		out = append(out, e.Name)
	}
	return out, nil
}

func (c *Client) get(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	// GitHub asks for a UA and rate-limits harder without one.
	req.Header.Set("User-Agent", "csrun-standings/1.0 (+https://csrun.win)")
	req.Header.Set("Accept", "application/vnd.github+json, text/plain;q=0.9, */*;q=0.8")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("valve: request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("valve: unexpected status %d from %s", resp.StatusCode, url)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 4<<20))
}

// A standings row: | 1 | 2011 | Spirit | donk, magixx, ... | [details](...) |
var rowRe = regexp.MustCompile(`^\|\s*(\d+)\s*\|\s*([\d,]+)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|`)

func parseStandings(md, asOf string) []Team {
	var out []Team
	for _, line := range strings.Split(md, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "|") {
			continue
		}
		m := rowRe.FindStringSubmatch(line)
		if m == nil {
			continue // header, separator, or a shape we do not recognise
		}
		standing, err1 := strconv.Atoi(m[1])
		points, err2 := strconv.Atoi(strings.ReplaceAll(m[2], ",", ""))
		name := cleanCell(m[3])
		if err1 != nil || err2 != nil || name == "" {
			continue
		}
		var roster []string
		for _, p := range strings.Split(m[4], ",") {
			if p = cleanCell(p); p != "" {
				roster = append(roster, p)
			}
		}
		out = append(out, Team{
			Standing: standing,
			Points:   points,
			Name:     name,
			Roster:   roster,
			AsOf:     asOf,
		})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Standing < out[j].Standing })
	return out
}

// Cells carry markdown: bold wrappers, escaped pipes, stray <br />.
func cleanCell(s string) string {
	s = strings.ReplaceAll(s, "<br />", " ")
	s = strings.ReplaceAll(s, "\\|", "|")
	s = strings.ReplaceAll(s, "**", "")
	return strings.TrimSpace(s)
}

func yearFromName(name string) string {
	// standings_global_2026_08_03.md
	parts := strings.Split(strings.TrimSuffix(name, ".md"), "_")
	if len(parts) >= 3 && len(parts[2]) == 4 {
		return parts[2]
	}
	return strconv.Itoa(time.Now().UTC().Year())
}

func asOfFromName(name string) string {
	parts := strings.Split(strings.TrimSuffix(name, ".md"), "_")
	if len(parts) >= 5 {
		return parts[2] + "-" + parts[3] + "-" + parts[4]
	}
	return ""
}

func isDigits(s string) bool {
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return s != ""
}

// NormalizeName reduces an org name to something two sources can agree on:
// case, punctuation and the decorative suffixes each provider adds differ
// constantly ("Natus Vincere" vs "natus-vincere", "MOUZ" vs "mousesports").
func NormalizeName(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		}
	}
	return b.String()
}
