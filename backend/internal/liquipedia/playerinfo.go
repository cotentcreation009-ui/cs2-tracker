package liquipedia

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

// PlayerInfo is the useful slice of a Liquipedia player infobox. All fields
// are best-effort — wiki markup varies — and CC BY-SA 3.0 (the frontend
// already shows Liquipedia attribution wherever this renders).
type PlayerInfo struct {
	Found       bool   `json:"found"`
	Name        string `json:"name,omitempty"`        // real name
	Country     string `json:"country,omitempty"`     // as written ("Ukraine")
	CountryCode string `json:"countryCode,omitempty"` // ISO-3166 alpha-2 when known
	Role        string `json:"role,omitempty"`        // "AWPer", "In-game leader", …
	BirthDate   string `json:"birthDate,omitempty"`   // "2006-01-25" when parseable
	Team        string `json:"team,omitempty"`        // current team per the wiki
}

// maxWikitextBytes caps a fetched page revision (player pages are ~10-60KB).
const maxWikitextBytes = 1 << 20

type mwRevisions struct {
	Query struct {
		Pages []struct {
			Title     string `json:"title"`
			Missing   bool   `json:"missing"`
			Revisions []struct {
				Slots struct {
					Main struct {
						Content string `json:"content"`
					} `json:"main"`
				} `json:"slots"`
			} `json:"revisions"`
		} `json:"pages"`
	} `json:"query"`
}

// PlayerInfo fetches a player page's wikitext (one API call, behind the same
// limiter/backoff as photos) and parses the "Infobox player" template.
// Returns Found=false (no error) when the page or infobox doesn't exist —
// the caller negative-caches that.
func (c *Client) PlayerInfo(ctx context.Context, nick string) (*PlayerInfo, error) {
	nick = strings.TrimSpace(nick)
	if nick == "" || len(nick) > 48 {
		return &PlayerInfo{}, nil
	}
	q := url.Values{
		"action":        {"query"},
		"format":        {"json"},
		"formatversion": {"2"},
		"redirects":     {"1"},
		"titles":        {nick},
		"prop":          {"revisions"},
		"rvprop":        {"content"},
		"rvslots":       {"main"},
	}
	body, err := c.get(ctx, apiURL+"?"+q.Encode())
	if err != nil {
		return nil, err
	}
	var resp mwRevisions
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("liquipedia: decode revisions: %w", err)
	}
	if len(resp.Query.Pages) == 0 || resp.Query.Pages[0].Missing || len(resp.Query.Pages[0].Revisions) == 0 {
		return &PlayerInfo{}, nil
	}
	return parsePlayerInfobox(resp.Query.Pages[0].Revisions[0].Slots.Main.Content), nil
}

// parsePlayerInfobox pulls the fields we surface out of an "Infobox player"
// template. Tolerant by construction: works line-by-line on |key=value pairs,
// strips wiki markup, and returns whatever subset it finds.
func parsePlayerInfobox(wikitext string) *PlayerInfo {
	idx := infoboxStart.FindStringIndex(wikitext)
	if idx == nil {
		return &PlayerInfo{}
	}
	// The infobox runs until the next top-level template/section; grabbing a
	// generous window and reading only |key= lines keeps this robust.
	window := wikitext[idx[0]:]
	if len(window) > 8_000 {
		window = window[:8_000]
	}

	fields := map[string]string{}
	for _, line := range strings.Split(window, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "|") {
			continue
		}
		eq := strings.Index(line, "=")
		if eq < 0 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(line[1:eq]))
		val := strings.TrimSpace(line[eq+1:])
		if key != "" && val != "" && fields[key] == "" {
			fields[key] = val
		}
	}

	info := &PlayerInfo{Found: true}
	// romanized_name first: |name= holds the native script (Cyrillic etc.) on
	// many pages, and the Latin form is what the UI wants next to a nickname
	info.Name = cleanWiki(firstOf(fields, "romanized_name", "name"))
	info.Country = cleanWiki(firstOf(fields, "country", "nationality"))
	info.CountryCode = countryCode(info.Country)
	info.Role = prettyRole(cleanWiki(firstOf(fields, "role", "roles")))
	info.Team = cleanWiki(fields["team"])
	if m := birthRe.FindStringSubmatch(firstOf(fields, "birth_date", "birthdate", "birth")); m != nil {
		info.BirthDate = fmt.Sprintf("%s-%02s-%02s", m[1], m[2], m[3])
	}
	return info
}

var (
	infoboxStart = regexp.MustCompile(`(?i)\{\{Infobox\s+player`)
	// {{birth date and age|1997|10|2}} or plain 1997-10-02
	birthRe  = regexp.MustCompile(`(\d{4})[|-](\d{1,2})[|-](\d{1,2})`)
	linkRe   = regexp.MustCompile(`\[\[(?:[^|\]]*\|)?([^\]]+)\]\]`)
	tmplRe   = regexp.MustCompile(`\{\{[^{}]*\}\}`)
	refRe    = regexp.MustCompile(`<ref[^>]*>.*?</ref>|<ref[^/>]*/>|<[^>]+>`)
	commentRe = regexp.MustCompile(`<!--.*?-->`)
)

// cleanWiki reduces a wikitext value to plain text: [[X|Y]] → Y, templates
// and refs dropped, leftover markup trimmed.
func cleanWiki(s string) string {
	s = commentRe.ReplaceAllString(s, "")
	s = refRe.ReplaceAllString(s, "")
	s = linkRe.ReplaceAllString(s, "$1")
	s = tmplRe.ReplaceAllString(s, "")
	s = strings.NewReplacer("'''", "", "''", "", "{", "", "}", "").Replace(s)
	s = strings.TrimSpace(strings.Trim(s, "|"))
	if len(s) > 80 {
		s = s[:80]
	}
	return s
}

func firstOf(m map[string]string, keys ...string) string {
	for _, k := range keys {
		if v := m[k]; v != "" {
			return v
		}
	}
	return ""
}

// prettyRole folds Liquipedia role spellings onto display labels.
func prettyRole(r string) string {
	switch strings.ToLower(strings.TrimSpace(r)) {
	case "":
		return ""
	case "awp", "awper", "sniper":
		return "AWPer"
	case "igl", "in-game leader", "in game leader", "captain":
		return "IGL"
	case "rifler":
		return "Rifler"
	case "coach", "head coach":
		return "Coach"
	case "entry fragger", "entry":
		return "Entry"
	case "support":
		return "Support"
	case "lurker":
		return "Lurker"
	default:
		r = strings.TrimSpace(r)
		if len(r) > 24 {
			r = r[:24]
		}
		return r
	}
}

// countryCode maps the country names Liquipedia uses for CS regions to ISO
// alpha-2 (for flag rendering). Unknown names return "" — the UI just shows
// the name without a flag.
func countryCode(country string) string {
	c, ok := countryISO[strings.ToLower(strings.TrimSpace(country))]
	if !ok {
		return ""
	}
	return c
}

var countryISO = map[string]string{
	"argentina": "AR", "australia": "AU", "austria": "AT", "belarus": "BY",
	"belgium": "BE", "bosnia and herzegovina": "BA", "brazil": "BR",
	"bulgaria": "BG", "canada": "CA", "chile": "CL", "china": "CN",
	"croatia": "HR", "czech republic": "CZ", "czechia": "CZ", "denmark": "DK",
	"estonia": "EE", "finland": "FI", "france": "FR", "germany": "DE",
	"greece": "GR", "hungary": "HU", "iceland": "IS", "india": "IN",
	"indonesia": "ID", "israel": "IL", "italy": "IT", "japan": "JP",
	"jordan": "JO", "kazakhstan": "KZ", "kosovo": "XK", "latvia": "LV",
	"lithuania": "LT", "malaysia": "MY", "mexico": "MX", "mongolia": "MN",
	"montenegro": "ME", "morocco": "MA", "netherlands": "NL",
	"new zealand": "NZ", "north macedonia": "MK", "norway": "NO",
	"peru": "PE", "poland": "PL", "portugal": "PT", "romania": "RO",
	"russia": "RU", "serbia": "RS", "singapore": "SG", "slovakia": "SK",
	"slovenia": "SI", "south africa": "ZA", "south korea": "KR", "spain": "ES",
	"sweden": "SE", "switzerland": "CH", "taiwan": "TW", "thailand": "TH",
	"turkey": "TR", "ukraine": "UA", "united kingdom": "GB",
	"united states": "US", "uruguay": "UY", "uzbekistan": "UZ", "vietnam": "VN",
}
