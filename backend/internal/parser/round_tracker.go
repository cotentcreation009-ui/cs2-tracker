package parser

import "time"

// Team side constants matching demoinfocs' common.Team numeric values.
const (
	teamT  = 2
	teamCT = 3
)

func otherTeam(t int) int {
	if t == teamT {
		return teamCT
	}
	return teamT
}

// deathRecord is one death in a round, used for trade-kill detection.
type deathRecord struct {
	at     time.Duration
	killer uint64
	victim uint64
	team   int // victim's team
}

// RoundTracker accumulates the events of a single round and derives the
// per-player outcomes that feed advanced stats: KAST eligibility, trade kills,
// opening duels, clutches, and the per-round kill counts used for multi-kill
// rating buckets.
//
// It deliberately has no dependency on the demo-parsing library — it works on
// plain SteamID64s and numeric team ids — so the subtle KAST/trade/clutch logic
// can be unit-tested directly with synthetic events.
type RoundTracker struct {
	tradeWindow time.Duration

	teamOf    map[uint64]int  // participant -> team
	alive     map[int]int     // team -> alive count
	aliveSet  map[uint64]bool // participant -> currently alive
	gotKill   map[uint64]bool
	gotAssist map[uint64]bool
	traded    map[uint64]bool
	killsBy   map[uint64]int
	deaths    []deathRecord

	firstKillDone bool
	clutcher      uint64 // first player left 1-vs-X on their team this round
	clutchOpp     int    // enemies alive at the moment the clutch began
}

// NewRoundTracker creates a tracker. tradeWindow is how long after a teammate's
// death a kill still counts as a trade (Leetify/HLTV use ~5s).
func NewRoundTracker(tradeWindow time.Duration) *RoundTracker {
	return &RoundTracker{
		tradeWindow: tradeWindow,
		teamOf:      map[uint64]int{},
		alive:       map[int]int{},
		aliveSet:    map[uint64]bool{},
		gotKill:     map[uint64]bool{},
		gotAssist:   map[uint64]bool{},
		traded:      map[uint64]bool{},
		killsBy:     map[uint64]int{},
	}
}

// AddPlayer registers a participant for the round with their starting team.
// Calling it twice for the same id is a no-op for the alive count.
func (rt *RoundTracker) AddPlayer(id uint64, team int) {
	if id == 0 {
		return
	}
	if _, ok := rt.teamOf[id]; ok {
		rt.teamOf[id] = team
		return
	}
	rt.teamOf[id] = team
	rt.aliveSet[id] = true
	rt.alive[team]++
}

// RecordKill registers a kill and returns whether it was the round's opening
// kill and whether it traded a recently-killed teammate. Bot kills (id 0) are
// tolerated: pass 0 for killer/assister when there is no human credit.
func (rt *RoundTracker) RecordKill(at time.Duration, killer, victim, assister uint64, killerTeam, victimTeam int) (opening, trade bool) {
	opening = !rt.firstKillDone
	rt.firstKillDone = true

	if killer != 0 {
		rt.gotKill[killer] = true
		rt.killsBy[killer]++
	}
	if assister != 0 && assister != killer {
		rt.gotAssist[assister] = true
	}

	// Trade detection: did the just-killed victim recently kill a member of the
	// killer's team? If so, that teammate's death is "traded".
	for _, d := range rt.deaths {
		if d.killer == victim && d.team == killerTeam && at-d.at <= rt.tradeWindow {
			rt.traded[d.victim] = true
			trade = true
		}
	}

	// Update alive bookkeeping for clutch detection.
	if rt.aliveSet[victim] {
		rt.aliveSet[victim] = false
		if rt.alive[victimTeam] > 0 {
			rt.alive[victimTeam]--
		}
	}
	if rt.clutcher == 0 && rt.alive[victimTeam] == 1 {
		if survivor := rt.loneSurvivor(victimTeam); survivor != 0 {
			rt.clutcher = survivor
			rt.clutchOpp = rt.alive[otherTeam(victimTeam)]
		}
	}

	rt.deaths = append(rt.deaths, deathRecord{at: at, killer: killer, victim: victim, team: victimTeam})
	return opening, trade
}

func (rt *RoundTracker) loneSurvivor(team int) uint64 {
	var found uint64
	for id, t := range rt.teamOf {
		if t == team && rt.aliveSet[id] {
			if found != 0 {
				return 0 // more than one alive; not a 1vX yet
			}
			found = id
		}
	}
	return found
}

// RoundOutcome is the per-round result the tracker produces for the parser to
// fold into match totals.
type RoundOutcome struct {
	KAST            map[uint64]bool // participant -> earned KAST this round
	KillsByPlayer   map[uint64]int  // participant -> kills this round
	Participants    []uint64        // everyone who played the round
	Clutcher        uint64          // 0 if nobody was left in a 1vX
	ClutchOpponents int             // enemies alive when the clutch began
	ClutchWon       bool            // clutcher's team won the round
}

// Finalize computes the round outcome given the winning team and the set of
// participants still alive at round end (the authoritative survivor set comes
// from the demo, not from the tracker's own alive bookkeeping).
func (rt *RoundTracker) Finalize(winnerTeam int, survivors map[uint64]bool) RoundOutcome {
	out := RoundOutcome{
		KAST:            make(map[uint64]bool, len(rt.teamOf)),
		KillsByPlayer:   rt.killsBy,
		Participants:    make([]uint64, 0, len(rt.teamOf)),
		Clutcher:        rt.clutcher,
		ClutchOpponents: rt.clutchOpp,
		ClutchWon:       rt.clutcher != 0 && rt.teamOf[rt.clutcher] == winnerTeam,
	}
	for id := range rt.teamOf {
		out.Participants = append(out.Participants, id)
		out.KAST[id] = rt.gotKill[id] || rt.gotAssist[id] || rt.traded[id] || survivors[id]
	}
	return out
}
