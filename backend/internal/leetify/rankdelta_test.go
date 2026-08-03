package leetify

import "testing"

func ip(v int) *int { return &v }

// Deltas compare each game to the player's PREVIOUS game in the same queue:
// Premier rating points for rank_type 11, FACEIT elo for faceit games. Comp,
// hidden ratings, and the first listed game of a queue get nil.
func TestComputeRankDeltas(t *testing.T) {
	ms := []RecentMatch{ // most recent first
		{RankType: 11, Rank: 18240},       // +140 vs 18100
		{DataSource: "faceit", Elo: 2141}, // +41 vs 2100
		{RankType: 11, Rank: 18100},       // -50 vs 18150
		{DataSource: "faceit", Elo: 2100}, // first faceit
		{RankType: 11, Rank: 18150},       // first premier
		{RankType: 12, Rank: 15},          // comp — no delta ever
		{RankType: 11, Rank: 0},           // hidden premier rating
	}
	computeRankDeltas(ms)
	want := []*int{ip(140), ip(41), ip(-50), nil, nil, nil, nil}
	for i, w := range want {
		got := ms[i].RankDelta
		switch {
		case w == nil && got != nil:
			t.Errorf("ms[%d].RankDelta = %d, want nil", i, *got)
		case w != nil && got == nil:
			t.Errorf("ms[%d].RankDelta = nil, want %d", i, *w)
		case w != nil && got != nil && *w != *got:
			t.Errorf("ms[%d].RankDelta = %d, want %d", i, *got, *w)
		}
	}
}
