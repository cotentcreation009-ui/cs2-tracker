package parser

import (
	"testing"
	"time"
)

const tw = 5 * time.Second

// addStdTeams registers a standard 5v5 (T ids 1-5, CT ids 11-15).
func addStdTeams(rt *RoundTracker) {
	for _, id := range []uint64{1, 2, 3, 4, 5} {
		rt.AddPlayer(id, teamT)
	}
	for _, id := range []uint64{11, 12, 13, 14, 15} {
		rt.AddPlayer(id, teamCT)
	}
}

func TestOpeningAndTrade(t *testing.T) {
	rt := NewRoundTracker(tw)
	addStdTeams(rt)

	// CT player 11 opens by killing T player 1.
	opening, trade := rt.RecordKill(1*time.Second, 11, 1, 0, teamCT, teamT)
	if !opening {
		t.Error("first kill should be opening")
	}
	if trade {
		t.Error("first kill cannot be a trade")
	}

	// T player 2 trades back, killing 11 within the window.
	opening, trade = rt.RecordKill(3*time.Second, 2, 11, 0, teamT, teamCT)
	if opening {
		t.Error("second kill is not opening")
	}
	if !trade {
		t.Error("killing the killer within the window should be a trade")
	}

	out := rt.Finalize(teamT, map[uint64]bool{2: true, 3: true, 4: true, 5: true})
	if !out.KAST[1] {
		t.Error("player 1 was traded and should have KAST")
	}
	if !out.KAST[11] {
		t.Error("player 11 got a kill and should have KAST")
	}
	if !out.KAST[2] {
		t.Error("player 2 got a kill and should have KAST")
	}
}

func TestTradeOutsideWindowNotCounted(t *testing.T) {
	rt := NewRoundTracker(tw)
	addStdTeams(rt)
	rt.RecordKill(1*time.Second, 11, 1, 0, teamCT, teamT)
	// Avenge 6 seconds later — outside the 5s window.
	_, trade := rt.RecordKill(7*time.Second, 2, 11, 0, teamT, teamCT)
	if trade {
		t.Error("kill outside trade window should not be a trade")
	}
	out := rt.Finalize(teamT, map[uint64]bool{2: true})
	if out.KAST[1] {
		t.Error("player 1 should not have KAST (not traded, no kill/assist, died)")
	}
}

func TestAssistAndSurviveKAST(t *testing.T) {
	rt := NewRoundTracker(tw)
	addStdTeams(rt)
	// 11 kills 1 with an assist from 12.
	rt.RecordKill(2*time.Second, 11, 1, 12, teamCT, teamT)
	out := rt.Finalize(teamCT, map[uint64]bool{11: true, 12: true, 13: true, 14: true, 15: true, 2: true, 3: true, 4: true})
	if !out.KAST[12] {
		t.Error("assister should have KAST")
	}
	if !out.KAST[2] {
		t.Error("survivor should have KAST")
	}
	if out.KAST[1] {
		t.Error("player 1 died with no contribution; no KAST")
	}
}

func TestClutchWon(t *testing.T) {
	rt := NewRoundTracker(tw)
	addStdTeams(rt)
	// CT kills four T players; player 5 is left in a 1v5.
	rt.RecordKill(1*time.Second, 11, 1, 0, teamCT, teamT)
	rt.RecordKill(2*time.Second, 12, 2, 0, teamCT, teamT)
	rt.RecordKill(3*time.Second, 13, 3, 0, teamCT, teamT)
	rt.RecordKill(4*time.Second, 14, 4, 0, teamCT, teamT)

	// Player 5 cleans up the round (3 kills shown for bucket check).
	rt.RecordKill(6*time.Second, 5, 11, 0, teamT, teamCT)
	rt.RecordKill(7*time.Second, 5, 12, 0, teamT, teamCT)
	rt.RecordKill(8*time.Second, 5, 13, 0, teamT, teamCT)

	out := rt.Finalize(teamT, map[uint64]bool{5: true})
	if out.Clutcher != 5 {
		t.Errorf("clutcher = %d, want 5", out.Clutcher)
	}
	if out.ClutchOpponents != 5 {
		t.Errorf("clutch opponents = %d, want 5", out.ClutchOpponents)
	}
	if !out.ClutchWon {
		t.Error("clutch should be won (T won, player 5 was clutcher)")
	}
	if out.KillsByPlayer[5] != 3 {
		t.Errorf("player 5 kills = %d, want 3", out.KillsByPlayer[5])
	}
}

// TestClutch1v2Lost covers a non-5 clutch size that loses — the data that
// populates ClutchMatrix.LostBySize[2]. Guards the opponent-count bookkeeping
// for sizes other than the all-or-nothing 1v5 case.
func TestClutch1v2Lost(t *testing.T) {
	rt := NewRoundTracker(tw)
	addStdTeams(rt)
	// T trims CT down to two alive (11, 12).
	rt.RecordKill(1*time.Second, 1, 13, 0, teamT, teamCT)
	rt.RecordKill(2*time.Second, 2, 14, 0, teamT, teamCT)
	rt.RecordKill(3*time.Second, 3, 15, 0, teamT, teamCT)
	// CT wipes T down to a lone survivor (player 5) — a 1v2 begins.
	rt.RecordKill(4*time.Second, 11, 1, 0, teamCT, teamT)
	rt.RecordKill(5*time.Second, 11, 2, 0, teamCT, teamT)
	rt.RecordKill(6*time.Second, 12, 3, 0, teamCT, teamT)
	rt.RecordKill(7*time.Second, 12, 4, 0, teamCT, teamT)
	// Player 5 falls; CT takes the round.
	rt.RecordKill(8*time.Second, 11, 5, 0, teamCT, teamT)

	out := rt.Finalize(teamCT, map[uint64]bool{11: true, 12: true})
	if out.Clutcher != 5 {
		t.Errorf("clutcher = %d, want 5", out.Clutcher)
	}
	if out.ClutchOpponents != 2 {
		t.Errorf("clutch opponents = %d, want 2", out.ClutchOpponents)
	}
	if out.ClutchWon {
		t.Error("clutch should be lost (CT won the round)")
	}
}

func TestNoClutchWhenTwoAlive(t *testing.T) {
	rt := NewRoundTracker(tw)
	addStdTeams(rt)
	rt.RecordKill(1*time.Second, 11, 1, 0, teamCT, teamT)
	rt.RecordKill(2*time.Second, 12, 2, 0, teamCT, teamT)
	rt.RecordKill(3*time.Second, 13, 3, 0, teamCT, teamT)
	out := rt.Finalize(teamCT, map[uint64]bool{4: true, 5: true, 11: true, 12: true, 13: true, 14: true, 15: true})
	if out.Clutcher != 0 {
		t.Errorf("no clutch expected, got clutcher %d", out.Clutcher)
	}
}
