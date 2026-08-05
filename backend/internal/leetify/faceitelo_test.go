package leetify

import (
	"testing"
	"time"
)

// FACEIT's own per-match elo overwrites the chained values: rows match on
// map + closest finish time within 30 minutes; unmatched rows keep whatever
// they had.
func TestApplyFaceitElo(t *testing.T) {
	at := time.Date(2026, 7, 23, 7, 57, 58, 0, time.UTC)
	p := &Profile{RecentMatches: []RecentMatch{
		{DataSource: "faceit", MapName: "de_overpass", FinishedAt: at.Format(time.RFC3339)},
		{DataSource: "faceit", MapName: "de_mirage", FinishedAt: at.Add(-48 * time.Hour).Format(time.RFC3339)},
		{DataSource: "matchmaking", MapName: "de_overpass", FinishedAt: at.Format(time.RFC3339), RankType: 11, Rank: 20000},
	}}
	p.ApplyFaceitElo([]FaceitEloGame{
		{Date: at.Add(3 * time.Minute), Map: "de_overpass", Elo: 2034, Delta: -27, HasDelta: true},
		// same map, but 5 hours off — must NOT match the overpass row
		{Date: at.Add(5 * time.Hour), Map: "de_overpass", Elo: 2100, Delta: 40, HasDelta: true},
	})

	m := p.RecentMatches[0]
	if m.Elo != 2034 || m.RankDelta == nil || *m.RankDelta != -27 || m.RankBefore != 2061 {
		t.Fatalf("overpass row not enriched: %+v", m)
	}
	if p.RecentMatches[1].Elo != 0 || p.RecentMatches[1].RankDelta != nil {
		t.Errorf("unmatched faceit row was modified: %+v", p.RecentMatches[1])
	}
	if p.RecentMatches[2].Rank != 20000 || p.RecentMatches[2].Elo != 0 {
		t.Errorf("premier row was modified: %+v", p.RecentMatches[2])
	}
}
