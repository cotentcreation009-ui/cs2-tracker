package parser

import (
	"testing"

	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/events"
)

// The demo's rank message is the ONLY source of Premier rating anywhere in the
// pipeline — Leetify's match reports omit rank and Valve publishes it nowhere —
// so these guarantees carry the whole feature.
func TestRankUpdateLandsOnThePlayer(t *testing.T) {
	rc := &replayCollector{idx: map[uint64]int{}}
	// Someone the match already knows about.
	rc.idx[76561197995150836] = 0
	rc.players = []ReplayPlayer{{SteamID: 76561197995150836, Name: "known"}}

	rc.onRankUpdate(events.RankUpdate{
		SteamID32: 34885108, // low 32 bits of the id above
		RankOld:   19278,
		RankNew:   19175,
		// Valve sends the delta as a float; it is a whole rating step.
		RankChange: -103,
	})
	got := rc.players[0]
	if got.RankOld != 19278 || got.RankNew != 19175 || got.RankChange != -103 {
		t.Errorf("rank = %d -> %d (%+d), want 19278 -> 19175 (-103)",
			got.RankOld, got.RankNew, got.RankChange)
	}
}

func TestRankUpdateIndexesAnUnseenPlayer(t *testing.T) {
	// The event arrives at match end, when a player may have disconnected
	// without ever firing a shot. Their rank must not be dropped on the floor.
	rc := &replayCollector{idx: map[uint64]int{}}
	rc.onRankUpdate(events.RankUpdate{SteamID32: 34885108, RankNew: 25670})
	if len(rc.players) != 1 || rc.players[0].RankNew != 25670 {
		t.Fatalf("players = %+v, want the unseen player indexed with their rank", rc.players)
	}
	if rc.players[0].SteamID != 76561197995150836 {
		t.Errorf("steamID = %d, want the 64-bit form", rc.players[0].SteamID)
	}
}

func TestRankUpdateIgnoresAnEmptyID(t *testing.T) {
	// A zero id would index a phantom player; an absent rank must stay absent
	// so the UI can render a dash rather than a rating of zero.
	rc := &replayCollector{idx: map[uint64]int{}}
	rc.onRankUpdate(events.RankUpdate{SteamID32: 0, RankNew: 1234})
	if len(rc.players) != 0 {
		t.Errorf("a zero id created %d players", len(rc.players))
	}
}
