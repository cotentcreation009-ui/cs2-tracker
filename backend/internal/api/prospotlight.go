package api

import (
	"context"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/cs2tracker/server/internal/cache"
	"github.com/cs2tracker/server/internal/faceit"
	"github.com/cs2tracker/server/internal/grid"
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
// So the first two rails are "who is on the board", ordered by tracked presence
// and imminence, and the frontend labels them as exactly that. The FACEIT rail
// is the only one that claims to be a ranking, because it is one.

const (
	// A rail is a glance, not a directory.
	spotlightTeams   = 12
	spotlightPlayers = 24
	spotlightFaceit  = 20

	// Rosters move on transfer days, not hourly, and each one costs a GRID
	// Central call against a 20/min cap shared with the live board.
	spotlightRosterTTL = 12 * time.Hour
	// The leaderboard shifts continuously but nobody needs it to the minute.
	spotlightFaceitTTL = 30 * time.Minute
	// How many teams we are willing to spend roster lookups on per refresh.
	spotlightRosterTeams = 8
)

type spotlightTeam struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	LogoURL    string `json:"logoUrl,omitempty"`
	Color      string `json:"color,omitempty"`
	Matches    int    `json:"matches"`              // tracked series featuring them
	Live       bool   `json:"live,omitempty"`       // in a series right now
	NextAt     string `json:"nextAt,omitempty"`     // RFC3339 of their next scheduled series
	Tournament string `json:"tournament,omitempty"` // the event that next match belongs to
}

type spotlightPlayer struct {
	ID       string `json:"id"`
	Nick     string `json:"nick"`
	TeamID   string `json:"teamId,omitempty"`
	TeamName string `json:"teamName,omitempty"`
	TeamLogo string `json:"teamLogo,omitempty"`
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

	gridUp := !onlyFaceit && s.proMatches != nil && s.proMatches.Store().Enabled()
	out.Enabled = gridUp || onlyFaceit || (s.faceit != nil && s.faceit.HasKey())

	var wg sync.WaitGroup

	// ---- teams + players, from the board we already poll ------------------
	if gridUp {
		board, _ := s.proMatches.Store().Board()
		board = append(board, s.proMatches.Store().Finished()...)
		out.Teams = teamsFromBoard(board)

		wg.Add(1)
		go func() {
			defer wg.Done()
			out.Players = s.playersForTeams(ctx, out.Teams)
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

// teamsFromBoard ranks the teams we are actually tracking: how many series each
// appears in first, then whoever plays soonest. That is a statement about our
// coverage and the calendar, which is true, rather than about who is best,
// which we have no source for.
func teamsFromBoard(board []grid.MatchState) []spotlightTeam {
	type acc struct {
		t         spotlightTeam
		nextAt    time.Time
		hasNextAt bool
	}
	seen := map[string]*acc{}
	for _, m := range board {
		start, _ := time.Parse(time.RFC3339, m.StartScheduled)
		for _, tm := range m.Teams {
			id := strings.TrimSpace(tm.GridID)
			if id == "" || strings.TrimSpace(tm.Name) == "" {
				continue
			}
			a := seen[id]
			if a == nil {
				a = &acc{t: spotlightTeam{
					ID:      id,
					Name:    tm.Name,
					LogoURL: tm.LogoUrl,
					Color:   tm.ColorPrimary,
				}}
				seen[id] = a
			}
			a.t.Matches++
			if m.Status == "live" {
				a.t.Live = true
			}
			// "Next" means the soonest match still ahead of us.
			if m.Status == "upcoming" && !start.IsZero() && (!a.hasNextAt || start.Before(a.nextAt)) {
				a.nextAt = start
				a.hasNextAt = true
				a.t.NextAt = start.UTC().Format(time.RFC3339)
				a.t.Tournament = m.TournamentName
			}
		}
	}

	list := make([]spotlightTeam, 0, len(seen))
	for _, a := range seen {
		list = append(list, a.t)
	}
	sort.SliceStable(list, func(i, j int) bool {
		if list[i].Live != list[j].Live {
			return list[i].Live // whoever is playing right now leads the rail
		}
		if list[i].Matches != list[j].Matches {
			return list[i].Matches > list[j].Matches
		}
		if list[i].NextAt != list[j].NextAt {
			// an empty NextAt sorts last, which is what we want
			if list[i].NextAt == "" {
				return false
			}
			if list[j].NextAt == "" {
				return true
			}
			return list[i].NextAt < list[j].NextAt
		}
		return list[i].Name < list[j].Name
	})
	if len(list) > spotlightTeams {
		list = list[:spotlightTeams]
	}
	return list
}

// playersForTeams pulls rosters for the teams at the head of the rail. Bounded
// on purpose: every roster is a GRID Central call sharing a 20/min budget with
// the live board, so we spend a handful, cache them hard, and let the rail be
// shorter rather than starve the thing people actually came for.
func (s *Server) playersForTeams(ctx context.Context, teams []spotlightTeam) []spotlightPlayer {
	if s.proMatches == nil || len(teams) == 0 {
		return []spotlightPlayer{}
	}
	cl := s.proMatches.Client()
	if cl == nil {
		return []spotlightPlayer{}
	}
	if len(teams) > spotlightRosterTeams {
		teams = teams[:spotlightRosterTeams]
	}

	rosters := make([][]grid.RosterPlayer, len(teams))
	var wg sync.WaitGroup
	for i, t := range teams {
		wg.Add(1)
		go func(i int, t spotlightTeam) {
			defer wg.Done()
			rows, err := cachedTTL(s, ctx, cache.ProTeamRosterKey(t.ID), spotlightRosterTTL,
				func() ([]grid.RosterPlayer, error) { return cl.TeamRoster(ctx, t.ID) })
			if err != nil {
				return // a roster we cannot read simply contributes nobody
			}
			rosters[i] = rows
		}(i, t)
	}
	wg.Wait()

	out := make([]spotlightPlayer, 0, spotlightPlayers)
	// Interleave by team so the rail reads as a cross-section of the scene
	// rather than five players from one org followed by five from the next.
	for depth := 0; depth < 5 && len(out) < spotlightPlayers; depth++ {
		for i, rows := range rosters {
			if depth >= len(rows) || len(out) >= spotlightPlayers {
				continue
			}
			p := rows[depth]
			if strings.TrimSpace(p.Nick) == "" {
				continue
			}
			out = append(out, spotlightPlayer{
				ID:       p.ID,
				Nick:     p.Nick,
				TeamID:   teams[i].ID,
				TeamName: teams[i].Name,
				TeamLogo: teams[i].LogoURL,
				Color:    teams[i].Color,
				Live:     teams[i].Live,
			})
		}
	}
	return out
}
