package leetify

import "testing"

func ip(v int) *int { return &v }

// Rank on a rated game is the rating AFTER it (verified against live data: the
// newest rated Premier game equals the profile's current rating). So a game's
// movement is (its rank) − (the previous game in that queue), reported only
// when that previous game is ALSO rated — Leetify leaves the rating off some
// games, and spanning them would credit one game with a multi-game swing.
func TestComputeRankDeltas(t *testing.T) {
	ms := []RecentMatch{ // most recent first
		{RankType: 11, Rank: 18240},                 // 0: +140 vs 18100
		{DataSource: "faceit", Rank: 10, Elo: 2141}, // 1: +41 vs 2100
		{RankType: 11, Rank: 18100},                 // 2: -50 vs 18150
		{DataSource: "faceit", Rank: 10, Elo: 2100}, // 3: first rated faceit
		{RankType: 11, Rank: 18150},                 // 4: first rated premier
		{RankType: 12, Rank: 15},                    // 5: competitive — never
		{RankType: 11, Rank: 0},                     // 6: rating not recorded
		{RankType: 11, Rank: 17800},                 // 7: chain broken by [6]
	}
	computeRankDeltas(ms)

	wantDelta := []*int{ip(140), ip(41), ip(-50), nil, nil, nil, nil, nil}
	wantBefore := []int{18100, 2100, 18150, 0, 0, 0, 0, 0}
	for i := range ms {
		got, want := ms[i].RankDelta, wantDelta[i]
		switch {
		case want == nil && got != nil:
			t.Errorf("ms[%d].RankDelta = %d, want nil", i, *got)
		case want != nil && got == nil:
			t.Errorf("ms[%d].RankDelta = nil, want %d", i, *want)
		case want != nil && got != nil && *want != *got:
			t.Errorf("ms[%d].RankDelta = %d, want %d", i, *got, *want)
		}
		if ms[i].RankBefore != wantBefore[i] {
			t.Errorf("ms[%d].RankBefore = %d, want %d", i, ms[i].RankBefore, wantBefore[i])
		}
	}
}

// The game after an unrated one must not report the swing that accumulated
// across it — real case from live data: 26431, (unrated), (unrated), 25511
// would otherwise claim a single -920 game.
func TestComputeRankDeltasDoesNotSpanUnratedGames(t *testing.T) {
	ms := []RecentMatch{
		{RankType: 11, Rank: 25511}, // newest — previous premier game is unrated
		{RankType: 11, Rank: 0},
		{RankType: 11, Rank: 0},
		{RankType: 11, Rank: 26431}, // oldest
	}
	computeRankDeltas(ms)
	if ms[0].RankDelta != nil {
		t.Errorf("delta spanned unrated games: got %d, want nil", *ms[0].RankDelta)
	}
	if ms[0].RankBefore != 0 {
		t.Errorf("RankBefore = %d, want 0", ms[0].RankBefore)
	}
}

// FACEIT movement comes from elo — Rank there is the level (1-10), which
// barely moves and must never be used as the ladder number.
func TestComputeRankDeltasFaceitUsesElo(t *testing.T) {
	ms := []RecentMatch{
		{DataSource: "faceit", Rank: 10, Elo: 2500},
		{DataSource: "faceit", Rank: 10, Elo: 2475},
	}
	computeRankDeltas(ms)
	if ms[0].RankDelta == nil || *ms[0].RankDelta != 25 {
		t.Fatalf("RankDelta = %v, want 25", ms[0].RankDelta)
	}
	if ms[0].RankBefore != 2475 {
		t.Errorf("RankBefore = %d, want 2475", ms[0].RankBefore)
	}
}
