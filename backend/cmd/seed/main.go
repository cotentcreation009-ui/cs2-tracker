// Command seed inserts a couple of synthetic matches so the frontend has
// realistic data to render before a real Steam key or demo is available. It goes
// through the exact same write path as the worker (InsertParsedMatch), so career
// aggregation and the derived-stat math are exercised too.
//
//	go run ./cmd/seed        # uses DATABASE_URL
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/cs2tracker/server/internal/config"
	"github.com/cs2tracker/server/internal/db"
	"github.com/cs2tracker/server/internal/models"
	"github.com/cs2tracker/server/internal/stats"
)

// heroID is the player the seeded matches are centred on.
const heroID uint64 = 76561198000000001

func main() {
	cfg, err := config.Load()
	if err != nil {
		fail(err)
	}
	ctx := context.Background()
	database, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		fail(err)
	}
	defer database.Close()
	if err := database.Migrate(ctx); err != nil {
		fail(err)
	}

	// Give the hero a recognisable identity even without the Steam API.
	if err := database.UpsertPlayer(ctx, models.Player{
		SteamID64:   heroID,
		PersonaName: "s1mple_fan",
		AvatarURL:   "https://avatars.cloudflare.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg",
		ProfileURL:  "https://steamcommunity.com/profiles/76561198000000001/",
		CountryCode: "UA",
	}); err != nil {
		fail(err)
	}

	matches := []*models.ParsedMatch{
		buildMatch("de_mirage", time.Now().Add(-26*time.Hour), 16, 12, true),
		buildMatch("de_inferno", time.Now().Add(-3*time.Hour), 13, 16, false),
		buildMatch("de_nuke", time.Now().Add(-50*time.Minute), 16, 9, true),
	}
	for _, m := range matches {
		id, err := database.InsertParsedMatch(ctx, m)
		if err != nil {
			fail(err)
		}
		fmt.Printf("seeded %s -> match id %d\n", m.Match.Map, id)
	}

	fmt.Printf("\nDone. View the hero profile at:\n  GET /api/players/%d\n  http://localhost:3000/profiles/%d\n", heroID, heroID)
}

// lineSpec is a compact description of one scoreboard row.
type lineSpec struct {
	id             uint64
	name           string
	k, d, a, hs    int
	dmg, kast      int
	ok, od, cw     int
	k1, k2, k3, k4 int
}

// buildMatch fabricates a 10-player match. Roster A starts on T (ids x1-x5),
// roster B starts on CT (ids x6-x10). heroWonA decides the winner via the score.
func buildMatch(mapName string, playedAt time.Time, scoreA, scoreB int, heroWonA bool) *models.ParsedMatch {
	rounds := scoreA + scoreB

	// Roster A (T start) — the hero leads this team.
	rosterA := []lineSpec{
		{heroID, "s1mple_fan", 27, 16, 5, 14, 2480, rounds * 78 / 100, 7, 3, 3, 8, 6, 2, 0},
		{heroID + 1, "b1t_btw", 21, 18, 7, 9, 2010, rounds * 72 / 100, 4, 4, 2, 10, 4, 1, 0},
		{heroID + 2, "electronic", 19, 19, 9, 8, 1880, rounds * 70 / 100, 3, 5, 1, 11, 3, 1, 0},
		{heroID + 3, "Perfecto", 14, 17, 11, 5, 1520, rounds * 74 / 100, 2, 3, 2, 9, 2, 0, 0},
		{heroID + 4, "Boombl4", 13, 20, 8, 6, 1410, rounds * 65 / 100, 3, 6, 0, 8, 2, 1, 0},
	}
	// Roster B (CT start).
	rosterB := []lineSpec{
		{heroID + 5, "ZywOo", 26, 18, 6, 11, 2390, rounds * 76 / 100, 6, 4, 2, 9, 5, 2, 0},
		{heroID + 6, "apEX", 15, 19, 12, 4, 1620, rounds * 71 / 100, 4, 5, 1, 9, 3, 0, 0},
		{heroID + 7, "Spinx", 20, 17, 7, 9, 1950, rounds * 73 / 100, 3, 3, 1, 10, 4, 1, 0},
		{heroID + 8, "flameZ", 18, 20, 5, 7, 1770, rounds * 68 / 100, 5, 4, 1, 11, 3, 0, 0},
		{heroID + 9, "mezii", 12, 21, 9, 4, 1330, rounds * 64 / 100, 2, 6, 0, 8, 2, 0, 0},
	}

	aWon := scoreA > scoreB
	var players []models.MatchPlayer
	for _, ls := range rosterA {
		players = append(players, makeLine(ls, models.SideT, aWon, rounds))
	}
	for _, ls := range rosterB {
		players = append(players, makeLine(ls, models.SideCT, !aWon, rounds))
	}

	roundsList := make([]models.Round, rounds)
	for i := 0; i < rounds; i++ {
		side := models.SideT
		if i%2 == 0 {
			side = models.SideCT
		}
		roundsList[i] = models.Round{Number: i + 1, WinnerSide: side, EndReason: "ct_elimination"}
	}

	return &models.ParsedMatch{
		Match: models.Match{
			Map:         mapName,
			DemoSource:  "seed",
			GameMode:    "competitive",
			PlayedAt:    playedAt,
			DurationS:   rounds * 95,
			RoundsTotal: rounds,
			TeamAScore:  scoreA,
			TeamBScore:  scoreB,
			TickRate:    64,
		},
		Players: players,
		Rounds:  roundsList,
	}
}

func makeLine(ls lineSpec, side models.Side, won bool, rounds int) models.MatchPlayer {
	mp := models.MatchPlayer{
		SteamID64:      ls.id,
		PersonaName:    ls.name,
		StartSide:      side,
		RoundsPlayed:   rounds,
		Kills:          ls.k,
		Deaths:         ls.d,
		Assists:        ls.a,
		HeadshotKills:  ls.hs,
		Damage:         ls.dmg,
		UtilityDamage:  ls.dmg / 12,
		EnemiesFlashed: ls.a + 3,
		KASTRounds:     ls.kast,
		OpeningKills:   ls.ok,
		OpeningDeaths:  ls.od,
		ClutchesWon:    ls.cw,
		K1:             ls.k1,
		K2:             ls.k2,
		K3:             ls.k3,
		K4:             ls.k4,
		MVPs:           ls.cw + ls.k3,
		Won:            won,
	}
	stats.FillMatchPlayerDerived(&mp)
	return mp
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "seed error:", err)
	os.Exit(1)
}
