package parser

import "testing"

func mkMatch() *ReplayMatch {
	m := &ReplayMatch{}
	m.Players = []ReplayPlayer{
		{SteamID: 1, Name: "a", RankOld: 19278, RankNew: 19175, RankChange: -103},
		{SteamID: 2, Name: "b"},
	}
	m.RoundData = []ReplayRound{
		{
			Stats: []ReplayPlayerStat{
				{I: 0, Dmg: 100, Shots: 40, Hits: 10, HsHits: 4, AimN: 2, RctMs: 500, Preaim: 6},
				{I: 1, Dmg: 50, Shots: 20, Hits: 3},
			},
			// First kill of the round is the opening duel.
			Kills: []ReplayKill{
				{Killer: 0, Victim: 1, Headshot: true, Wallbang: true},
				{Killer: 0, Victim: 1},
			},
		},
		{
			Stats: []ReplayPlayerStat{
				{I: 0, Dmg: 20, Shots: 10, Hits: 2, AimN: 1, RctMs: 800, Preaim: 12},
			},
			Kills: []ReplayKill{{Killer: 1, Victim: 0, Assister: 1}}, // assister index+1 = player 0
		},
	}
	return m
}

func TestSummariseCountsTheRightThings(t *testing.T) {
	s := SummarisePlayers(mkMatch())
	if len(s) != 2 {
		t.Fatalf("players = %d", len(s))
	}
	a, b := s[0], s[1]

	if a.Kills != 2 || a.Deaths != 1 {
		t.Errorf("a K/D = %d/%d, want 2/1", a.Kills, a.Deaths)
	}
	// Only the round's FIRST kill is an opening duel — the second is not.
	if a.OpeningKills != 1 || b.OpeningDeaths != 1 {
		t.Errorf("opening: a killed %d, b died %d; want 1 and 1", a.OpeningKills, b.OpeningDeaths)
	}
	if a.OpeningDeaths != 1 {
		t.Errorf("a opening deaths = %d, want 1 (round two's only kill)", a.OpeningDeaths)
	}
	if a.Shots != 50 || a.Hits != 12 {
		t.Errorf("a shots/hits = %d/%d, want 50/12", a.Shots, a.Hits)
	}
	if a.Wallbangs != 1 {
		t.Errorf("a wallbangs = %d, want 1", a.Wallbangs)
	}
	// Assister is stored as index+1 so zero can mean "none".
	if a.Assists != 1 {
		t.Errorf("a assists = %d, want 1", a.Assists)
	}
	// Rank rides along from the demo's own message.
	if a.RankNew != 19175 || a.RankChange != -103 {
		t.Errorf("a rank = %d (%+d)", a.RankNew, a.RankChange)
	}
}

func TestSummariseWeightsDuelTellsBySampleCount(t *testing.T) {
	// Two measured duels at 500ms and one at 800ms averages to 600, not 650:
	// a round with more measured duels must count for more.
	s := SummarisePlayers(mkMatch())
	if got := s[0].ReactionMs; got < 599 || got > 601 {
		t.Errorf("reaction = %v, want ~600 (sample-weighted)", got)
	}
	if got := s[0].Preaim; got < 7.9 || got > 8.1 {
		t.Errorf("preaim = %v, want ~8 (sample-weighted)", got)
	}
}

func TestAimRatingMeasuresAimNotResults(t *testing.T) {
	// A player who lands more bullets, more headshots and holds a tighter
	// crosshair must rate above one who does not — regardless of kill count,
	// which is exactly the confusion this rating exists to avoid.
	sharp := PlayerSummary{Shots: 100, Hits: 28, Kills: 10, HSKills: 5, Preaim: 3.5,
		OpeningKills: 3, OpeningDeaths: 2}
	blunt := PlayerSummary{Shots: 100, Hits: 10, Kills: 30, HSKills: 6, Preaim: 11,
		OpeningKills: 3, OpeningDeaths: 2}
	if AimRating(sharp) <= AimRating(blunt) {
		t.Errorf("sharp %.1f did not beat blunt %.1f", AimRating(sharp), AimRating(blunt))
	}
}

func TestAimRatingStaysInBandAndAbsentIsZero(t *testing.T) {
	// Absurd inputs must not escape 0..100 — a rating that can print 340 is
	// not a rating.
	wild := PlayerSummary{Shots: 10, Hits: 10, Kills: 10, HSKills: 10, Preaim: 0.1,
		OpeningKills: 10}
	if r := AimRating(wild); r > 100 || r < 0 {
		t.Errorf("rating = %v, out of band", r)
	}
	// A player who never fired is unmeasured, not bad.
	if r := AimRating(PlayerSummary{}); r != 0 {
		t.Errorf("unmeasured player rated %v, want 0", r)
	}
}
