// Package grid is a client + poller for the GRID esports Open-Access API, used to
// power the "pro matches" live board (upcoming + live CS2 series with per-map,
// per-round detail). It talks to two GraphQL endpoints — Central Data (schedule)
// and Series State (live state) — over an "x-api-key" header, and normalizes the
// responses into the MatchState contract the frontend consumes.
//
// The whole feature is gated: with no API key (and mock mode off) the Store
// reports disabled and the poller never starts, so nothing breaks pre-setup.
// Every normalize step tolerates null teams/logos/segments and never panics.
package grid

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	// ErrThrottled means GRID returned a rate-limit signal (HTTP 429 or a GraphQL
	// error with errorType UNAVAILABLE / errorDetail TOO_MANY_REQUESTS). Callers
	// back off rather than hammering.
	ErrThrottled = errors.New("grid: rate limited")
	// ErrNotFound means the requested entity (series / title) does not exist.
	ErrNotFound = errors.New("grid: not found")
)

const defaultBaseURL = "https://api-op.grid.gg"

// --- The served contract (camelCase JSON tags EXACTLY as the API contract) ---

// MatchState is one series as the frontend consumes it. Upcoming series carry
// teams + tournament + start + format only (no maps/scores).
type MatchState struct {
	SeriesID          string `json:"seriesId"`
	Status            string `json:"status"` // "upcoming" | "live" | "finished"
	StartScheduled    string `json:"startScheduled"`
	FormatName        string `json:"formatName"`
	FormatShort       string `json:"formatShort"`
	BestOf            int    `json:"bestOf"`
	TournamentID      string `json:"tournamentId"`
	TournamentName    string `json:"tournamentName"`
	TournamentLogoUrl string `json:"tournamentLogoUrl"`
	Teams             []Team `json:"teams"`

	SeriesScore  map[string]int `json:"seriesScore,omitempty"` // gridId -> maps won; omit when upcoming
	SeriesWinner string         `json:"seriesWinner,omitempty"` // omit until finished
	Maps         []MapState     `json:"maps,omitempty"`
	CurrentMap   int            `json:"currentMap,omitempty"` // sequence of the live map

	Valid         bool   `json:"valid"`
	LiveUpdatedAt string `json:"liveUpdatedAt,omitempty"`
	FetchedAt     string `json:"fetchedAt,omitempty"`
	StreamUrl     string `json:"streamUrl,omitempty"`
}

// Team is a competitor's static identity (from Central Data). GridID is the GRID
// canonical team id — the same id used as the key in seriesScore/scoreByTeam.
type Team struct {
	GridID         string `json:"gridId"`
	Name           string `json:"name"`
	ShortName      string `json:"shortName"`
	LogoUrl        string `json:"logoUrl"`
	ColorPrimary   string `json:"colorPrimary"`
	ColorSecondary string `json:"colorSecondary"`
}

// MapState is one game (map) within a series.
type MapState struct {
	Sequence     int               `json:"sequence"`
	MapName      string            `json:"mapName"`
	Started      bool              `json:"started"`
	Finished     bool              `json:"finished"`
	ScoreByTeam  map[string]int    `json:"scoreByTeam,omitempty"`  // gridId -> rounds on this map
	SideByTeam   map[string]string `json:"sideByTeam,omitempty"`   // gridId -> "CT" | "T"
	CurrentRound int               `json:"currentRound,omitempty"`
	ClockSeconds int               `json:"clockSeconds,omitempty"`
	Rounds       []Round           `json:"rounds,omitempty"`
	WinnerTeam   string            `json:"winnerTeam"`
}

// Round is one round of a map.
type Round struct {
	Number     int    `json:"number"`
	WinnerTeam string `json:"winnerTeam"`
	WinnerSide string `json:"winnerSide"` // "CT" | "T"
	Finished   bool   `json:"finished"`
}

// --- GraphQL wire types (private) -------------------------------------------

type gqlError struct {
	Message     string `json:"message"`
	ErrorType   string `json:"errorType"`
	ErrorDetail string `json:"errorDetail"`
	Extensions  struct {
		ErrorType   string `json:"errorType"`
		ErrorDetail string `json:"errorDetail"`
	} `json:"extensions"`
}

// Central Data: allSeries.
type centralResp struct {
	Data struct {
		AllSeries struct {
			TotalCount int `json:"totalCount"`
			PageInfo   struct {
				HasNextPage bool   `json:"hasNextPage"`
				EndCursor   string `json:"endCursor"`
			} `json:"pageInfo"`
			Edges []struct {
				Node centralNode `json:"node"`
			} `json:"edges"`
		} `json:"allSeries"`
	} `json:"data"`
	Errors []gqlError `json:"errors"`
}

type centralNode struct {
	ID                 string `json:"id"`
	Type               string `json:"type"`
	StartTimeScheduled string `json:"startTimeScheduled"`
	Format             *struct {
		ID            string `json:"id"`
		Name          string `json:"name"`
		NameShortened string `json:"nameShortened"`
	} `json:"format"`
	Tournament *struct {
		ID            string `json:"id"`
		Name          string `json:"name"`
		NameShortened string `json:"nameShortened"`
		LogoUrl       string `json:"logoUrl"`
	} `json:"tournament"`
	Teams []struct {
		BaseInfo *struct {
			ID             string `json:"id"`
			Name           string `json:"name"`
			NameShortened  string `json:"nameShortened"`
			LogoUrl        string `json:"logoUrl"`
			ColorPrimary   string `json:"colorPrimary"`
			ColorSecondary string `json:"colorSecondary"`
		} `json:"baseInfo"`
		ScoreAdvantage int `json:"scoreAdvantage"`
	} `json:"teams"`
}

// Series State: seriesState.
type seriesStateResp struct {
	Data struct {
		SeriesState *seriesStateNode `json:"seriesState"`
	} `json:"data"`
	Errors []gqlError `json:"errors"`
}

type seriesStateNode struct {
	ID        string   `json:"id"`
	Valid     bool     `json:"valid"`
	UpdatedAt string   `json:"updatedAt"`
	Started   bool     `json:"started"`
	Finished  bool     `json:"finished"`
	Teams     []ssTeam `json:"teams"`
	Games     []ssGame `json:"games"`
}

type ssTeam struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Score int    `json:"score"` // MAPS won
	Won   bool   `json:"won"`
}

type ssGame struct {
	SequenceNumber int `json:"sequenceNumber"`
	Map            *struct {
		Name string `json:"name"`
	} `json:"map"`
	Started  bool `json:"started"`
	Finished bool `json:"finished"`
	Clock    *struct {
		CurrentSeconds int `json:"currentSeconds"`
	} `json:"clock"`
	Teams    []ssGameTeam `json:"teams"`
	Segments []ssSegment  `json:"segments"`
}

type ssGameTeam struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Side   string `json:"side"`
	Score  int    `json:"score"` // ROUNDS on this map
	Won    bool   `json:"won"`
	Kills  int    `json:"kills"`
	Deaths int    `json:"deaths"`
}

type ssSegment struct {
	Type           string `json:"type"`
	SequenceNumber int    `json:"sequenceNumber"`
	Started        bool   `json:"started"`
	Finished       bool   `json:"finished"`
	Teams          []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Side string `json:"side"`
		Won  bool   `json:"won"`
	} `json:"teams"`
}

// Titles (for CS2 titleId resolution).
type titlesResp struct {
	Data struct {
		Titles []struct {
			ID            string `json:"id"`
			Name          string `json:"name"`
			NameShortened string `json:"nameShortened"`
		} `json:"titles"`
	} `json:"data"`
	Errors []gqlError `json:"errors"`
}

// --- Client -----------------------------------------------------------------

// Client talks to the two GRID GraphQL endpoints.
type Client struct {
	http       *http.Client
	centralURL string
	seriesURL  string
	apiKey     string
	log        *slog.Logger

	mu      sync.RWMutex
	titleID string // resolved CS2 titleId; defaults to "28"
}

// NewClient builds a Client. An empty baseURL falls back to the Open-Access host.
func NewClient(baseURL, apiKey string, httpClient *http.Client, log *slog.Logger) *Client {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" {
		base = defaultBaseURL
	}
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 15 * time.Second}
	}
	if log == nil {
		log = slog.Default()
	}
	return &Client{
		http:       httpClient,
		centralURL: base + "/central-data/graphql",
		seriesURL:  base + "/live-data-feed/series-state/graphql",
		apiKey:     strings.TrimSpace(apiKey),
		log:        log,
		titleID:    "28",
	}
}

// SetTitleID overrides the CS2 titleId used in the schedule filter.
func (c *Client) SetTitleID(id string) {
	if strings.TrimSpace(id) == "" {
		return
	}
	c.mu.Lock()
	c.titleID = id
	c.mu.Unlock()
}

func (c *Client) getTitleID() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.titleID
}

const titlesQuery = `query { titles { id name nameShortened } }`

const seriesStateQuery = `query SeriesState($id: ID!) {
  seriesState(id: $id) {
    id valid updatedAt format started finished
    teams { id name score won }
    games { sequenceNumber map { name } started finished clock { currentSeconds }
      teams { id name side score won kills deaths }
      segments { type sequenceNumber started finished teams { id name side won } } }
  }
}`

// centralQuery injects the titleId as a string literal — it is our own trusted
// value ("28" or a numeric id resolved from GRID), never user input. Enums
// (types/orderBy/orderDirection) are passed UNQUOTED as the schema requires.
func centralQuery(titleID string) string {
	return fmt.Sprintf(`query UpcomingAndLiveCS2($after: Cursor, $gte: String!, $lte: String!) {
  allSeries(first: 50, after: $after,
    filter: { titleId: %q, types: [ESPORTS], startTimeScheduled: { gte: $gte, lte: $lte } },
    orderBy: StartTimeScheduled, orderDirection: ASC) {
    totalCount pageInfo { hasNextPage endCursor }
    edges { node {
      id type startTimeScheduled
      format { id name nameShortened }
      tournament { id name nameShortened logoUrl }
      teams { baseInfo { id name nameShortened logoUrl colorPrimary colorSecondary } scoreAdvantage }
    } }
  }
}`, titleID)
}

// ResolveTitleID looks up the CS2 titleId via the titles query. Callers fall back
// to "28" on error.
func (c *Client) ResolveTitleID(ctx context.Context) (string, error) {
	body, err := c.postGraphQL(ctx, c.centralURL, titlesQuery, nil)
	if err != nil {
		return "", err
	}
	var resp titlesResp
	if err := decodeGQL(body, &resp); err != nil {
		return "", err
	}
	// GRID returns "Counter Strike 2" (no hyphen) with nameShortened "cs2";
	// match leniently on either so a punctuation change can't drop us to the
	// hardcoded fallback.
	for _, t := range resp.Data.Titles {
		name := strings.ToLower(strings.TrimSpace(t.Name))
		short := strings.ToLower(strings.TrimSpace(t.NameShortened))
		if short == "cs2" || (strings.Contains(name, "counter") && strings.Contains(name, "strike") && strings.Contains(name, "2") && !strings.Contains(name, "2v2")) {
			return t.ID, nil
		}
	}
	return "", ErrNotFound
}

// FetchAllSeries returns every CS2 esports series scheduled within [gte, lte]
// (RFC3339 strings), paginating via the cursor. On a mid-pagination failure it
// returns whatever pages already succeeded rather than nothing.
func (c *Client) FetchAllSeries(ctx context.Context, gte, lte string) ([]centralNode, error) {
	query := centralQuery(c.getTitleID())
	var nodes []centralNode
	after := ""
	for page := 0; page < 20; page++ { // hard page cap as a safety net
		vars := map[string]any{"gte": gte, "lte": lte}
		if after != "" {
			vars["after"] = after
		}
		body, err := c.postGraphQL(ctx, c.centralURL, query, vars)
		if err != nil {
			if len(nodes) > 0 {
				return nodes, nil
			}
			return nil, err
		}
		var resp centralResp
		if err := decodeGQL(body, &resp); err != nil {
			if len(nodes) > 0 {
				return nodes, nil
			}
			return nil, err
		}
		for _, e := range resp.Data.AllSeries.Edges {
			nodes = append(nodes, e.Node)
		}
		pi := resp.Data.AllSeries.PageInfo
		if !pi.HasNextPage || pi.EndCursor == "" {
			break
		}
		after = pi.EndCursor
	}
	return nodes, nil
}

// FetchSeriesState fetches the live state of one series.
func (c *Client) FetchSeriesState(ctx context.Context, id string) (*seriesStateNode, error) {
	body, err := c.postGraphQL(ctx, c.seriesURL, seriesStateQuery, map[string]any{"id": id})
	if err != nil {
		return nil, err
	}
	var resp seriesStateResp
	if err := decodeGQL(body, &resp); err != nil {
		return nil, err
	}
	if resp.Data.SeriesState == nil {
		return nil, ErrNotFound
	}
	return resp.Data.SeriesState, nil
}

// postGraphQL POSTs a GraphQL body with the x-api-key header, retrying transient
// failures (network / 429 / 5xx) with a short context-aware backoff.
func (c *Client) postGraphQL(ctx context.Context, endpoint, query string, vars map[string]any) ([]byte, error) {
	payload, err := json.Marshal(map[string]any{"query": query, "variables": vars})
	if err != nil {
		return nil, err
	}
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			if err := sleepCtx(ctx, time.Duration(attempt)*300*time.Millisecond); err != nil {
				return nil, err
			}
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json")
		req.Header.Set("x-api-key", c.apiKey)

		resp, err := c.http.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		resp.Body.Close()
		switch {
		case resp.StatusCode == http.StatusOK:
			return body, nil
		case resp.StatusCode == http.StatusTooManyRequests:
			lastErr = ErrThrottled
		case resp.StatusCode >= 500:
			lastErr = fmt.Errorf("grid: upstream status %d", resp.StatusCode)
		default:
			return nil, fmt.Errorf("grid: status %d: %s", resp.StatusCode, snippet(body))
		}
	}
	return nil, lastErr
}

// decodeGQL unmarshals a GraphQL body into out, first inspecting the errors array
// so a throttle signal surfaces as ErrThrottled. Non-throttle GraphQL errors are
// tolerated (partial data is used when present).
func decodeGQL(body []byte, out any) error {
	var env struct {
		Errors []gqlError `json:"errors"`
	}
	_ = json.Unmarshal(body, &env)
	if isThrottle(env.Errors) {
		return ErrThrottled
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("grid: decode: %w", err)
	}
	return nil
}

func isThrottle(errs []gqlError) bool {
	for _, e := range errs {
		if strings.EqualFold(e.ErrorType, "UNAVAILABLE") || strings.EqualFold(e.Extensions.ErrorType, "UNAVAILABLE") {
			return true
		}
		blob := strings.ToUpper(e.ErrorDetail + " " + e.Extensions.ErrorDetail + " " + e.Message)
		if strings.Contains(blob, "TOO_MANY_REQUESTS") {
			return true
		}
	}
	return false
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

func snippet(b []byte) string {
	const max = 200
	s := strings.TrimSpace(string(b))
	if len(s) > max {
		return s[:max] + "…"
	}
	return s
}

// --- Normalization ----------------------------------------------------------

// normalizeSchedule turns a Central Data node into an upcoming MatchState (static
// identity only — no maps/scores). Tolerates null format/tournament/teams.
func normalizeSchedule(n centralNode) MatchState {
	ms := MatchState{
		SeriesID:       n.ID,
		Status:         "upcoming",
		StartScheduled: n.StartTimeScheduled,
	}
	if n.Format != nil {
		ms.FormatName = n.Format.Name
		ms.FormatShort = n.Format.NameShortened
	}
	ms.BestOf = parseBestOf(ms.FormatShort, ms.FormatName)
	if n.Tournament != nil {
		ms.TournamentID = n.Tournament.ID
		ms.TournamentName = n.Tournament.Name
		ms.TournamentLogoUrl = n.Tournament.LogoUrl
	}
	for _, t := range n.Teams {
		if t.BaseInfo == nil {
			continue
		}
		ms.Teams = append(ms.Teams, Team{
			GridID: t.BaseInfo.ID,
			Name:   t.BaseInfo.Name,
			// GRID's nameShortened is empty/null for most teams (verified live),
			// so fall back to the full name rather than render a blank.
			ShortName:      shortOr(t.BaseInfo.NameShortened, t.BaseInfo.Name),
			LogoUrl:        t.BaseInfo.LogoUrl,
			ColorPrimary:   t.BaseInfo.ColorPrimary,
			ColorSecondary: t.BaseInfo.ColorSecondary,
		})
	}
	return ms
}

// shortOr returns the trimmed short name, or the full name when it is blank.
func shortOr(short, full string) string {
	if s := strings.TrimSpace(short); s != "" {
		return s
	}
	return strings.TrimSpace(full)
}

// isTestSeries flags GRID's placeholder/QA series (e.g. "CS2-1 vs CS2-2" under
// a "GRID-TEST" tournament) so they never reach the public board.
func isTestSeries(ms MatchState) bool {
	if strings.Contains(strings.ToUpper(ms.TournamentName), "GRID-TEST") {
		return true
	}
	for _, t := range ms.Teams {
		n := strings.ToUpper(strings.TrimSpace(t.Name))
		if strings.HasPrefix(n, "CS2-") || n == "CS2-1" || n == "CS2-2" {
			return true
		}
	}
	return false
}

// mergeSchedule refreshes only the static schedule fields on an existing state,
// preserving any live/finished dynamic data already captured by the state loop.
func mergeSchedule(dst *MatchState, sched MatchState) {
	dst.StartScheduled = sched.StartScheduled
	dst.FormatName = sched.FormatName
	dst.FormatShort = sched.FormatShort
	dst.BestOf = sched.BestOf
	dst.TournamentID = sched.TournamentID
	dst.TournamentName = sched.TournamentName
	dst.TournamentLogoUrl = sched.TournamentLogoUrl
	if len(sched.Teams) > 0 {
		dst.Teams = sched.Teams
	}
}

// applySeriesState folds a live Series State response into a MatchState, deriving
// status, series score/winner, and per-map/per-round detail. Never panics on
// null games/teams/segments.
func applySeriesState(ms *MatchState, ss *seriesStateNode, now time.Time) {
	if ss == nil {
		return
	}
	if ss.ID != "" {
		ms.SeriesID = ss.ID
	}
	ms.Valid = ss.Valid
	ms.LiveUpdatedAt = ss.UpdatedAt
	ms.FetchedAt = now.UTC().Format(time.RFC3339)

	switch {
	case ss.Finished:
		ms.Status = "finished"
	case ss.Started && ss.Valid:
		ms.Status = "live"
	default:
		ms.Status = "upcoming"
	}

	// Series score = maps won per team; winner only once finished.
	winner := ""
	if len(ss.Teams) > 0 {
		score := make(map[string]int, len(ss.Teams))
		for _, t := range ss.Teams {
			if t.ID == "" {
				continue
			}
			score[t.ID] = t.Score
			if t.Won {
				winner = t.ID
			}
		}
		if ms.Status == "upcoming" {
			ms.SeriesScore = nil
		} else {
			ms.SeriesScore = score
		}
	}
	if ms.Status == "finished" {
		ms.SeriesWinner = winner
	} else {
		ms.SeriesWinner = ""
	}

	ms.Maps = normalizeMaps(ss.Games)
	ms.CurrentMap = currentMapSeq(ss.Games)
}

func normalizeMaps(games []ssGame) []MapState {
	if len(games) == 0 {
		return nil
	}
	out := make([]MapState, 0, len(games))
	for _, g := range games {
		m := MapState{
			Sequence: g.SequenceNumber,
			Started:  g.Started,
			Finished: g.Finished,
		}
		if g.Map != nil {
			m.MapName = prettyMap(g.Map.Name)
		}
		if g.Clock != nil {
			m.ClockSeconds = g.Clock.CurrentSeconds
		}
		if len(g.Teams) > 0 {
			sb := make(map[string]int, len(g.Teams))
			side := make(map[string]string, len(g.Teams))
			winner := ""
			for _, t := range g.Teams {
				if t.ID == "" {
					continue
				}
				sb[t.ID] = t.Score
				if s := normalizeSide(t.Side); s != "" {
					side[t.ID] = s
				}
				if t.Won {
					winner = t.ID
				}
			}
			if len(sb) > 0 {
				m.ScoreByTeam = sb
			}
			if len(side) > 0 {
				m.SideByTeam = side
			}
			if g.Finished {
				m.WinnerTeam = winner
			}
		}
		rounds, maxSeq := normalizeRounds(g.Segments)
		m.Rounds = rounds
		if maxSeq > 0 {
			m.CurrentRound = maxSeq
		}
		out = append(out, m)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Sequence < out[j].Sequence })
	return out
}

// normalizeRounds builds Rounds from a game's segments. GRID segment typing for
// CS2 is not fully verified, so we treat blank/"round"-typed segments as rounds
// (and never crash if the shape differs). Returns rounds + the max round number.
func normalizeRounds(segs []ssSegment) ([]Round, int) {
	if len(segs) == 0 {
		return nil, 0
	}
	var rounds []Round
	maxSeq := 0
	for _, sg := range segs {
		if !isRoundSegment(sg.Type) {
			continue
		}
		if sg.SequenceNumber > maxSeq {
			maxSeq = sg.SequenceNumber
		}
		r := Round{Number: sg.SequenceNumber, Finished: sg.Finished}
		for _, t := range sg.Teams {
			if t.Won {
				r.WinnerTeam = t.ID
				r.WinnerSide = normalizeSide(t.Side)
				break
			}
		}
		rounds = append(rounds, r)
	}
	sort.SliceStable(rounds, func(i, j int) bool { return rounds[i].Number < rounds[j].Number })
	return rounds, maxSeq
}

func isRoundSegment(t string) bool {
	t = strings.ToLower(strings.TrimSpace(t))
	return t == "" || strings.Contains(t, "round")
}

// currentMapSeq returns the live game's sequence (started && !finished), else the
// highest started sequence, else 0.
func currentMapSeq(games []ssGame) int {
	cur := 0
	for _, g := range games {
		if g.Started && !g.Finished {
			return g.SequenceNumber
		}
		if g.Started && g.SequenceNumber > cur {
			cur = g.SequenceNumber
		}
	}
	return cur
}

// prettyMap turns GRID's lowercase map ids ("dust2", "de_mirage") into the
// display names players expect ("Dust2", "Mirage").
func prettyMap(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return s
	}
	s = strings.TrimPrefix(strings.ToLower(s), "de_")
	s = strings.TrimPrefix(s, "cs_")
	switch s {
	case "dust2":
		return "Dust2"
	case "cbble":
		return "Cobblestone"
	default:
		return strings.ToUpper(s[:1]) + s[1:]
	}
}

// normalizeSide maps GRID's side names to the "CT"/"T" the contract uses.
func normalizeSide(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "t", "terrorist", "terrorists":
		return "T"
	case "ct", "counter-terrorist", "counter-terrorists", "counterterrorists":
		return "CT"
	default:
		return ""
	}
}

// parseBestOf derives the numeric best-of from the short format ("Bo3"->3),
// falling back to the long name ("Best of 3"->3). Returns 0 when unknown.
func parseBestOf(short, name string) int {
	s := strings.ToLower(strings.TrimSpace(short))
	s = strings.TrimPrefix(s, "bo")
	if n, err := strconv.Atoi(strings.TrimSpace(s)); err == nil && n > 0 {
		return n
	}
	ln := strings.ToLower(name)
	if i := strings.LastIndex(ln, "best of "); i >= 0 {
		fields := strings.Fields(strings.TrimSpace(ln[i+len("best of "):]))
		if len(fields) > 0 {
			if n, err := strconv.Atoi(fields[0]); err == nil && n > 0 {
				return n
			}
		}
	}
	return 0
}

func parseTime(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t
	}
	return time.Time{}
}
