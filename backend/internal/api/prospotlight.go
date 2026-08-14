package api

import (
	"context"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/cs2tracker/server/internal/cache"
	"github.com/cs2tracker/server/internal/faceit"
	"github.com/cs2tracker/server/internal/grid"
	"github.com/cs2tracker/server/internal/valve"
)

// The pro-matches spotlight: the teams and players worth looking at right now,
// plus FACEIT's own leaderboard.
//
// A word on what these lists ARE, because the honest answer shapes the whole
// endpoint. We cannot reproduce HLTV's world ranking: HLTV publishes no API and
// blocks server-side reads, so any "top 20 teams" we rendered would be a number
// we made up. What we do have is real:
//
//   - every esports series GRID tracks, which tells us who is actually playing
//     and how much of the current calendar each team occupies;
//   - those teams' rosters, from GRID;
//   - FACEIT's published leaderboard, which IS a genuine ranking.
//
// The teams rail was originally "who is on the board", ordered by how much of
// the tracked calendar each team occupied. That produced a wall of qualifier
// sides — the calendar is mostly tier-3 — which is exactly the wrong answer to
// "show me the top teams". It now uses Counter-Strike's OFFICIAL Regional
// Standings, published by Valve and used to decide Major invitations, so the
// list is a real ranking with a real source.
//
// Those standings ship each team's roster too, which is where the players rail
// now comes from: the players of the twenty best teams in the world, and no
// GRID roster calls at all.

const (
	// A rail is a glance, not a directory.
	spotlightTeams   = 20
	spotlightPlayers = 24
	spotlightFaceit  = 20

	// Valve regenerates the standings about monthly; six hours is already far
	// more often than the data can change.
	spotlightStandingsTTL = 6 * time.Hour
	// The leaderboard shifts continuously but nobody needs it to the minute.
	spotlightFaceitTTL = 30 * time.Minute
	// How long a team-name -> GRID id pairing is remembered. Long, because it
	// only grows useful with time: every poll of the board teaches us a few
	// more, and a top-20 side we have never tracked cannot be linked until we
	// have seen it play once.
	teamIndexTTL = 30 * 24 * time.Hour
	// How long before we ask GRID about an org name again. Long enough that a
	// name it does not know costs one request a day, short enough that a side
	// GRID adds later is picked up without a redeploy.
	teamLookupTTL = 24 * time.Hour
)

type spotlightTeam struct {
	// Standing and Points come straight from Valve's table.
	Standing int    `json:"standing"`
	Points   int    `json:"points"`
	Name     string `json:"name"`
	// GridID is set only when we have actually seen this org play in a tracked
	// series, because our team page is keyed by GRID's id. Absent means the
	// card still renders — it just cannot link anywhere truthful yet.
	GridID  string   `json:"gridId,omitempty"`
	LogoURL string   `json:"logoUrl,omitempty"`
	Color   string   `json:"color,omitempty"`
	Roster  []string `json:"roster,omitempty"`
	Live    bool     `json:"live,omitempty"` // playing in a tracked series right now
	AsOf    string   `json:"asOf,omitempty"`
}

type spotlightPlayer struct {
	Nick     string `json:"nick"`
	TeamName string `json:"teamName,omitempty"`
	TeamRank int    `json:"teamRank,omitempty"`
	GridID   string `json:"teamGridId,omitempty"`
	Color    string `json:"color,omitempty"`
	Live     bool   `json:"live,omitempty"`
}

type spotlightResp struct {
	Enabled bool                  `json:"enabled"`
	Teams   []spotlightTeam       `json:"teams"`
	Players []spotlightPlayer     `json:"players"`
	Faceit  []faceit.RankedPlayer `json:"faceit"`
	// Named so the UI can say which leaderboard it is showing rather than
	// implying a world ranking.
	FaceitRegion string `json:"faceitRegion,omitempty"`
	UpdatedAt    string `json:"updatedAt"`
}

// handleProSpotlight serves all three rails in one request — they render
// together, and three polls for one strip of cards would be three times the
// cache pressure for no benefit.
func (s *Server) handleProSpotlight(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	out := spotlightResp{
		Teams:     []spotlightTeam{},
		Players:   []spotlightPlayer{},
		Faceit:    []faceit.RankedPlayer{},
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	}

	// The region switcher refetches only the leaderboard. Doing the GRID work
	// again for a rail that did not change would spend roster lookups from a
	// shared 20/min budget on nothing.
	onlyFaceit := r.URL.Query().Get("only") == "faceit"

	out.Enabled = true

	var wg sync.WaitGroup

	// ---- the official ranking, plus its rosters ---------------------------
	if !onlyFaceit && s.valve != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			// The whole table is cached, not just the rail's slice: the team
			// page reads the same entry to show a side's VRS standing, and
			// plenty of tracked teams sit below twentieth.
			all, err := cachedTTL(s, ctx, cache.ProStandingsKey(), spotlightStandingsTTL,
				func() ([]valve.Team, error) { return s.valve.Standings(ctx) })
			if err != nil {
				// An unreachable ranking is an absent rail, never a wrong one.
				s.log.Warn("spotlight: valve standings unavailable", "err", err)
				return
			}
			if len(all) > spotlightTeams {
				all = all[:spotlightTeams]
			}
			out.Teams, out.Players = s.decorate(ctx, all)
		}()
	}

	// ---- FACEIT's own leaderboard ----------------------------------------
	if s.faceit != nil && s.faceit.HasKey() {
		region := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("region")))
		if region == "" {
			region = "EU"
		}
		out.FaceitRegion = region
		wg.Add(1)
		go func() {
			defer wg.Done()
			rows, err := cachedTTL(s, ctx, cache.ProFaceitRankingKey(region), spotlightFaceitTTL,
				func() ([]faceit.RankedPlayer, error) {
					return s.faceit.Rankings(ctx, region, spotlightFaceit)
				})
			if err != nil {
				// A leaderboard we could not read is an absent rail, never a
				// broken page — the other two still have something to say.
				s.log.Warn("spotlight: faceit rankings unavailable", "region", region, "err", err)
				return
			}
			out.Faceit = rows
		}()
	}

	wg.Wait()
	if out.Faceit == nil {
		out.Faceit = []faceit.RankedPlayer{}
	}
	setEdgeCache(w, 60*time.Second)
	writeJSON(w, http.StatusOK, out)
}

// decorate turns Valve's ranking into the two rails.
//
// The only thing we add is a GRID id where we have one: our team page is keyed
// by GRID's identifier, so a card can only link somewhere real for an org we
// have actually seen play. Everything else on the card is Valve's.
func (s *Server) decorate(ctx context.Context, ranked []valve.Team) ([]spotlightTeam, []spotlightPlayer) {
	index, live := s.teamIndex(ctx)

	teams := make([]spotlightTeam, 0, len(ranked))
	var unresolved []string
	for _, t := range ranked {
		known, isLive := lookupTeam(index, live, t.Name)
		if known.id == "" {
			unresolved = append(unresolved, t.Name)
		}
		teams = append(teams, spotlightTeam{
			Standing: t.Standing,
			Points:   t.Points,
			Name:     t.Name,
			GridID:   known.id,
			LogoURL:  known.logo,
			Color:    known.color,
			Roster:   t.Roster,
			Live:     isLive,
			AsOf:     t.AsOf,
		})
	}
	// Ask GRID about the ones the board has never shown us — in the background,
	// because that is a throttled call per name and this runs on the request
	// path. decorate runs on every request, so the ids land on the next one.
	s.resolveTeamIDsAsync(unresolved)

	// Interleave by team so the players rail reads as a cross-section of the
	// top of the scene rather than five players from the number-one side.
	players := make([]spotlightPlayer, 0, spotlightPlayers)
	for depth := 0; depth < 5 && len(players) < spotlightPlayers; depth++ {
		for _, t := range teams {
			if depth >= len(t.Roster) || len(players) >= spotlightPlayers {
				continue
			}
			nick := strings.TrimSpace(t.Roster[depth])
			if nick == "" {
				continue
			}
			players = append(players, spotlightPlayer{
				Nick:     nick,
				TeamName: t.Name,
				TeamRank: t.Standing,
				GridID:   t.GridID,
				Color:    t.Color,
				Live:     t.Live,
			})
		}
	}
	return teams, players
}

type knownTeam struct {
	id    string
	logo  string
	color string
}

// lookupTeam finds an org under any spelling the two sources might use, exact
// first. See valve.NameKeys — the word "Team" alone accounted for half of the
// top twenty having no id.
func lookupTeam(index map[string]knownTeam, live map[string]bool, name string) (knownTeam, bool) {
	var found knownTeam
	isLive := false
	for _, k := range valve.NameKeys(name) {
		if live[k] {
			isLive = true
		}
		if found.id == "" {
			if v, ok := index[k]; ok {
				found = v
			}
		}
	}
	return found, isLive
}

// resolveTeamIDsAsync fills in ids for ranked teams the board has never seen.
//
// Detached from the request on purpose: each name is one throttled Central
// call, so resolving ten of them takes about half a minute — fine in the
// background, unacceptable in a handler. Each name is asked at most once a day
// whether or not GRID knew it, so a name GRID has never heard of costs one
// request a day rather than one per page view.
func (s *Server) resolveTeamIDsAsync(names []string) {
	if len(names) == 0 || s.cache == nil || s.proMatches == nil || s.log == nil {
		return
	}
	go func() {
		// chi's Recoverer only covers handler goroutines. This one is detached,
		// so without a recover here a nil map or a surprise from GRID would
		// take the whole backend down instead of losing one team's link.
		defer func() {
			if rec := recover(); rec != nil {
				s.log.Error("spotlight: team id resolver panicked", "err", rec)
			}
		}()
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		_, _, _ = s.sf.Do("spotlight:resolve-team-ids", func() (any, error) {
			s.resolveTeamIDs(ctx, names)
			return nil, nil
		})
	}()
}

func (s *Server) resolveTeamIDs(ctx context.Context, names []string) {
	cl := s.proMatches.Client()
	if cl == nil {
		return
	}
	index, _ := s.teamIndex(ctx)
	changed := false
	for _, name := range names {
		keys := valve.NameKeys(name)
		if len(keys) == 0 {
			continue
		}
		marker := cache.ProTeamLookupKey(keys[0])
		var asked bool
		if hit, _ := s.cache.GetJSON(ctx, marker, &asked); hit {
			continue
		}
		// Marked BEFORE the call, not after: a lookup that fails or finds
		// nothing must not be retried on the very next page view.
		_ = s.cache.SetJSONTTL(ctx, marker, true, teamLookupTTL)

		rows, err := cl.TeamsByName(ctx, name)
		if err != nil {
			s.log.Warn("spotlight: grid team lookup failed", "team", name, "err", err)
			continue
		}
		best, ok := pickTeam(name, rows)
		if !ok {
			s.log.Info("spotlight: no confident GRID match", "team", name, "candidates", len(rows))
			continue
		}
		for _, k := range keys {
			if cur, exists := index[k]; !exists || cur.id == "" {
				index[k] = knownTeam{id: best.GridID, logo: cur.logo, color: cur.color}
				changed = true
			}
		}
		s.log.Info("spotlight: resolved GRID team id",
			"team", name, "matched", best.Name, "id", best.GridID)
	}
	if changed {
		s.storeTeamIndex(ctx, index)
	}
}

// GRID's name filter is a SUBSTRING match, so "Spirit" also returns "Spirit
// Academy" and "Falcons" returns every Falcons-ish org in the game. Only an
// exact match under either spelling, or a name ours is a clean prefix of, is
// trusted: sending someone to the wrong team's page is worse than leaving a
// card unclickable.
var notTheMainSide = regexp.MustCompile(`(?i)(academy|junior|youngster|youth|prodig|talent|nxt|fe|female|women)`)

func pickTeam(want string, rows []grid.NamedTeam) (grid.NamedTeam, bool) {
	wantKeys := valve.NameKeys(want)
	var prefix grid.NamedTeam
	for _, r := range rows {
		if r.GridID == "" || notTheMainSide.MatchString(r.Name) {
			continue
		}
		for _, rk := range valve.NameKeys(r.Name) {
			for _, wk := range wantKeys {
				if rk == wk {
					return r, true
				}
			}
		}
		// "Falcons" vs "Falcons Esports": allowed, but keep looking for an
		// exact hit, and prefer the shortest such name. The test is on WHOLE
		// WORDS — comparing squashed keys would match "FaZe" to "Fazendinha".
		if strings.HasPrefix(spacedName(r.Name), spacedName(want)+" ") &&
			(prefix.GridID == "" || len(r.Name) < len(prefix.Name)) {
			prefix = r
		}
	}
	return prefix, prefix.GridID != ""
}

// spacedName lowercases and drops punctuation but KEEPS word boundaries, so a
// prefix test can insist on a whole word rather than a run of letters.
func spacedName(s string) string {
	var b strings.Builder
	pendingGap := false
	for _, r := range strings.ToLower(strings.TrimSpace(s)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			if pendingGap && b.Len() > 0 {
				b.WriteRune(' ')
			}
			pendingGap = false
			b.WriteRune(r)
		default:
			pendingGap = true
		}
	}
	return b.String()
}

// teamIndex maps a normalized org name to what GRID knows about it, learned
// from every series we have polled and remembered for a month. A top-20 side
// we have never tracked simply has no entry yet; the next time they appear on
// the board they gain one, and the card becomes clickable from then on.
func (s *Server) teamIndex(ctx context.Context) (map[string]knownTeam, map[string]bool) {
	index := map[string]knownTeam{}
	live := map[string]bool{}
	if s.cache != nil {
		var stored map[string]knownTeamJSON
		if hit, _ := s.cache.GetJSON(ctx, cache.ProTeamIndexKey(), &stored); hit {
			for k, v := range stored {
				index[k] = knownTeam{id: v.ID, logo: v.Logo, color: v.Color}
			}
		}
	}
	if s.proMatches == nil || !s.proMatches.Store().Enabled() {
		return index, live
	}

	board, _ := s.proMatches.Store().Board()
	board = append(board, s.proMatches.Store().Finished()...)
	changed := false
	for _, m := range board {
		for _, tm := range m.Teams {
			id := strings.TrimSpace(tm.GridID)
			if id == "" {
				continue
			}
			// Every spelling GRID hands us, so Valve's shorter one still finds
			// it: the full name, its "Team"-less form, and the short name.
			keys := valve.NameKeys(tm.Name)
			if sn := valve.NormalizeName(tm.ShortName); len(sn) >= 2 {
				keys = append(keys, sn)
			}
			for _, key := range keys {
				if m.Status == "live" {
					live[key] = true
				}
				cur, ok := index[key]
				if !ok || cur.id != id || (cur.logo == "" && tm.LogoUrl != "") {
					index[key] = knownTeam{id: id, logo: tm.LogoUrl, color: tm.ColorPrimary}
					changed = true
				}
			}
		}
	}
	if changed {
		s.storeTeamIndex(ctx, index)
	}
	return index, live
}

func (s *Server) storeTeamIndex(ctx context.Context, index map[string]knownTeam) {
	if s.cache == nil {
		return
	}
	out := make(map[string]knownTeamJSON, len(index))
	for k, v := range index {
		out[k] = knownTeamJSON{ID: v.id, Logo: v.logo, Color: v.color}
	}
	_ = s.cache.SetJSONTTL(ctx, cache.ProTeamIndexKey(), out, teamIndexTTL)
}

// knownTeamJSON is the stored shape (unexported fields do not marshal).
type knownTeamJSON struct {
	ID    string `json:"id"`
	Logo  string `json:"logo,omitempty"`
	Color string `json:"color,omitempty"`
}
