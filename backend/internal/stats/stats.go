// Package stats turns raw counting stats (kills, deaths, damage, KAST rounds,
// multi-kill buckets) into the derived metrics shown in the UI. Everything here
// is a pure function of its inputs so it can be unit-tested without a demo or a
// database, and so the API and worker compute identical numbers.
package stats

import "github.com/cs2tracker/server/internal/models"

// HLTV Rating 1.0 reference averages. These are the long-standing community
// constants used to normalise a player's output against an "average" pro.
const (
	avgKPR = 0.679 // average kills per round
	avgSPR = 0.317 // average rounds survived per round
	avgRMK = 1.277 // average "rounds with multi-kills" score per round
)

// safeDiv divides, returning 0 when the denominator is 0 so empty profiles
// render as zeros rather than NaN/Inf.
func safeDiv(a, b float64) float64 {
	if b == 0 {
		return 0
	}
	return a / b
}

// Rating1 computes the HLTV Rating 1.0 from the underlying counts. k1..k5 are
// the number of rounds in which the player got exactly that many kills.
func Rating1(kills, deaths, rounds, k1, k2, k3, k4, k5 int) float64 {
	if rounds <= 0 {
		return 0
	}
	r := float64(rounds)
	kpr := float64(kills) / r
	spr := float64(rounds-deaths) / r
	rmk := float64(1*k1+4*k2+9*k3+16*k4+25*k5) / r

	killRating := kpr / avgKPR
	survRating := spr / avgSPR
	rmkRating := rmk / avgRMK

	return (killRating + 0.7*survRating + rmkRating) / 2.7
}

// round2 rounds to 2 decimal places for stable storage/serialisation.
func round2(v float64) float64 {
	return float64(int64(v*100+sign(v)*0.5)) / 100
}

func sign(v float64) float64 {
	if v < 0 {
		return -1
	}
	return 1
}

// FillMatchPlayerDerived computes and stores the derived metrics on a
// MatchPlayer that already has its raw counts populated.
func FillMatchPlayerDerived(mp *models.MatchPlayer) {
	rounds := mp.RoundsPlayed
	mp.ADR = round2(safeDiv(float64(mp.Damage), float64(rounds)))
	mp.KASTPct = round2(100 * safeDiv(float64(mp.KASTRounds), float64(rounds)))
	mp.HSPct = round2(100 * safeDiv(float64(mp.HeadshotKills), float64(mp.Kills)))
	mp.KD = round2(safeDiv(float64(mp.Kills), float64(mp.Deaths)))
	mp.KPR = round2(safeDiv(float64(mp.Kills), float64(rounds)))
	mp.DPR = round2(safeDiv(float64(mp.Deaths), float64(rounds)))
	mp.Rating = round2(Rating1(mp.Kills, mp.Deaths, rounds, mp.K1, mp.K2, mp.K3, mp.K4, mp.K5))
}

// FillCareerDerived computes the rolling-career derived metrics from the
// aggregate counts.
func FillCareerDerived(c *models.PlayerCareer) {
	c.KD = round2(safeDiv(float64(c.Kills), float64(c.Deaths)))
	c.ADR = round2(safeDiv(float64(c.Damage), float64(c.RoundsPlayed)))
	c.KASTPct = round2(100 * safeDiv(float64(c.KASTRounds), float64(c.RoundsPlayed)))
	c.HSPct = round2(100 * safeDiv(float64(c.HeadshotKills), float64(c.Kills)))
	c.WinRate = round2(100 * safeDiv(float64(c.Wins), float64(c.Matches)))
	c.Rating = round2(Rating1(
		int(c.Kills), int(c.Deaths), c.RoundsPlayed,
		int(c.K1), int(c.K2), int(c.K3), int(c.K4), int(c.K5),
	))
}
