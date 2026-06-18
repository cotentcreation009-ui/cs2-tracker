// Package parser turns a CS2 GOTV .dem file into structured per-match,
// per-round and per-player statistics using demoinfocs-golang. The design is
// "parse once, store results": a demo is read a single time, every metric we
// care about is computed in that pass, and the raw demo can then be discarded.
//
// The subtle round-level logic (KAST, trades, clutches, opening duels) lives in
// RoundTracker so it can be unit-tested without a demo; this file is the glue
// that feeds demoinfocs events into the tracker and accumulates match totals.
package parser

import (
	"fmt"
	"io"
	"os"
	"time"

	"github.com/cs2tracker/server/internal/models"
	"github.com/cs2tracker/server/internal/stats"
	dem "github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs"
	"github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/common"
	"github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/events"
)

// tradeWindow is how long after a death a kill still counts as a trade.
const tradeWindow = 5 * time.Second

// ParseFile parses a demo from a path on disk.
func ParseFile(path string) (result *models.ParsedMatch, err error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("parser: open demo: %w", err)
	}
	defer f.Close()
	return Parse(f)
}

// Parse parses a demo from any reader (file, HTTP body, decompressed stream).
func Parse(r io.Reader) (result *models.ParsedMatch, err error) {
	// Demos can be malformed; a panic in the decoder should become an error so a
	// worker can fail one job cleanly rather than crashing the process.
	defer func() {
		if rec := recover(); rec != nil {
			err = fmt.Errorf("parser: recovered from panic: %v", rec)
		}
	}()

	p := dem.NewParser(r)
	defer p.Close()

	c := &collector{
		p:        p,
		players:  map[uint64]*models.MatchPlayer{},
		rosterOf: map[uint64]int{},
	}

	p.RegisterEventHandler(c.onMatchStart)
	p.RegisterEventHandler(c.onRoundStart)
	p.RegisterEventHandler(c.onKill)
	p.RegisterEventHandler(c.onPlayerHurt)
	p.RegisterEventHandler(c.onPlayerFlashed)
	p.RegisterEventHandler(c.onMVP)
	p.RegisterEventHandler(c.onRoundEnd)

	if err = p.ParseToEnd(); err != nil {
		return nil, fmt.Errorf("parser: parse demo: %w", err)
	}

	return c.finish(), nil
}

type collector struct {
	p dem.Parser

	matchStarted bool
	rt           *RoundTracker
	roundNum     int // completed rounds so far

	players  map[uint64]*models.MatchPlayer
	rosterOf map[uint64]int // steamID -> starting team (roster identity)

	teamAScore int // roster that started on T
	teamBScore int // roster that started on CT

	rounds []models.Round
	kills  []models.Kill
}

func (c *collector) player(id uint64) *models.MatchPlayer {
	mp, ok := c.players[id]
	if !ok {
		mp = &models.MatchPlayer{SteamID64: id}
		c.players[id] = mp
	}
	return mp
}

// onMatchStart resets all accumulated state. Valve demos fire MatchStart once
// the live game begins, which conveniently discards warmup and knife-round
// activity — exactly what we want excluded from stats.
func (c *collector) onMatchStart(events.MatchStart) {
	c.matchStarted = true
	c.rt = nil
	c.roundNum = 0
	c.players = map[uint64]*models.MatchPlayer{}
	c.rosterOf = map[uint64]int{}
	c.teamAScore = 0
	c.teamBScore = 0
	c.rounds = nil
	c.kills = nil
}

func (c *collector) onRoundStart(events.RoundStart) {
	if !c.matchStarted || c.p.GameState().IsWarmupPeriod() {
		return
	}
	c.rt = NewRoundTracker(tradeWindow)
	for _, pl := range c.p.GameState().Participants().Playing() {
		if pl == nil || pl.SteamID64 == 0 {
			continue
		}
		team := int(pl.Team)
		if team != teamT && team != teamCT {
			continue
		}
		c.rt.AddPlayer(pl.SteamID64, team)
		mp := c.player(pl.SteamID64)
		if pl.Name != "" {
			mp.PersonaName = pl.Name
		}
		if _, ok := c.rosterOf[pl.SteamID64]; !ok {
			c.rosterOf[pl.SteamID64] = team
			mp.StartSide = sideOf(team)
		}
	}
}

func (c *collector) onKill(e events.Kill) {
	if c.rt == nil || c.p.GameState().IsWarmupPeriod() {
		return
	}
	if e.Victim == nil {
		return
	}
	victimID := e.Victim.SteamID64
	victimTeam := int(e.Victim.Team)

	killerID, killerTeam := uint64(0), 0
	if e.Killer != nil {
		killerID = e.Killer.SteamID64
		killerTeam = int(e.Killer.Team)
	}
	assisterID := uint64(0)
	assisterEnemy := false
	if e.Assister != nil {
		assisterID = e.Assister.SteamID64
		assisterEnemy = e.Assister.Team != e.Victim.Team
	}

	// A "real" kill credits the killer only when it is an enemy frag (not a
	// suicide or team kill).
	enemyKill := killerID != 0 && killerID != victimID && killerTeam != victimTeam

	if victimID != 0 {
		c.player(victimID).Deaths++
	}
	if enemyKill {
		k := c.player(killerID)
		k.Kills++
		if e.IsHeadshot {
			k.HeadshotKills++
		}
	}
	if assisterID != 0 && assisterEnemy && assisterID != killerID {
		c.player(assisterID).Assists++
	}

	// Feed the round tracker. Only credit the killer/assister to KAST when they
	// are legitimate enemy contributions.
	trackKiller := uint64(0)
	if enemyKill {
		trackKiller = killerID
	}
	trackAssister := uint64(0)
	if assisterEnemy {
		trackAssister = assisterID
	}
	opening, trade := c.rt.RecordKill(c.p.CurrentTime(), trackKiller, victimID, trackAssister, killerTeam, victimTeam)

	if opening && enemyKill {
		c.player(killerID).OpeningKills++
		if victimID != 0 {
			c.player(victimID).OpeningDeaths++
		}
	}

	weapon := ""
	if e.Weapon != nil {
		weapon = e.Weapon.String()
	}
	c.kills = append(c.kills, models.Kill{
		Round:       c.roundNum + 1,
		TimeSeconds: c.p.CurrentTime().Seconds(),
		KillerID:    killerID,
		VictimID:    victimID,
		AssisterID:  assisterID,
		Weapon:      weapon,
		Headshot:    e.IsHeadshot,
		Opening:     opening,
		Trade:       trade,
	})
}

func (c *collector) onPlayerHurt(e events.PlayerHurt) {
	if c.rt == nil || c.p.GameState().IsWarmupPeriod() {
		return
	}
	if e.Player == nil || e.Attacker == nil {
		return
	}
	if e.Attacker.Team == e.Player.Team {
		return // ignore team damage
	}
	aid := e.Attacker.SteamID64
	if aid == 0 {
		return
	}
	ap := c.player(aid)
	ap.Damage += e.HealthDamage
	if e.Weapon != nil && e.Weapon.Class() == common.EqClassGrenade {
		ap.UtilityDamage += e.HealthDamage
	}
}

func (c *collector) onPlayerFlashed(e events.PlayerFlashed) {
	if c.rt == nil || c.p.GameState().IsWarmupPeriod() {
		return
	}
	if e.Attacker == nil || e.Player == nil {
		return
	}
	if e.Attacker.Team == e.Player.Team || e.Attacker.SteamID64 == 0 {
		return
	}
	if e.FlashDuration() <= 0 {
		return
	}
	c.player(e.Attacker.SteamID64).EnemiesFlashed++
}

func (c *collector) onMVP(e events.RoundMVPAnnouncement) {
	if !c.matchStarted || c.p.GameState().IsWarmupPeriod() {
		return
	}
	if e.Player == nil || e.Player.SteamID64 == 0 {
		return
	}
	c.player(e.Player.SteamID64).MVPs++
}

func (c *collector) onRoundEnd(e events.RoundEnd) {
	if !c.matchStarted || c.rt == nil {
		return
	}
	if c.p.GameState().IsWarmupPeriod() {
		c.rt = nil
		return
	}
	winner := int(e.Winner)

	survivors := map[uint64]bool{}
	for _, pl := range c.p.GameState().Participants().Playing() {
		if pl != nil && pl.SteamID64 != 0 && pl.IsAlive() {
			survivors[pl.SteamID64] = true
		}
	}

	out := c.rt.Finalize(winner, survivors)
	for _, id := range out.Participants {
		mp := c.player(id)
		mp.RoundsPlayed++
		if out.KAST[id] {
			mp.KASTRounds++
		}
		switch n := out.KillsByPlayer[id]; {
		case n == 1:
			mp.K1++
		case n == 2:
			mp.K2++
		case n == 3:
			mp.K3++
		case n == 4:
			mp.K4++
		case n >= 5:
			mp.K5++
		}
	}
	if out.Clutcher != 0 {
		cp := c.player(out.Clutcher)
		if out.ClutchWon {
			cp.ClutchesWon++
		} else {
			cp.ClutchesLost++
		}
	}

	c.rounds = append(c.rounds, models.Round{
		Number:     c.roundNum + 1,
		WinnerSide: sideOf(winner),
		EndReason:  reasonString(e.Reason),
	})
	c.addRoundWinToRoster(winner)
	c.roundNum++
	c.rt = nil
}

// addRoundWinToRoster credits the round to the roster (not the side) that won,
// so the scoreline stays correct across the halftime side swap.
func (c *collector) addRoundWinToRoster(winner int) {
	if winner != teamT && winner != teamCT {
		return // draw / unknown
	}
	counts := map[int]int{}
	for _, pl := range c.p.GameState().Participants().Playing() {
		if pl == nil || pl.SteamID64 == 0 || int(pl.Team) != winner {
			continue
		}
		if r, ok := c.rosterOf[pl.SteamID64]; ok {
			counts[r]++
		}
	}
	roster, best := 0, -1
	for r, n := range counts {
		if n > best {
			best, roster = n, r
		}
	}
	switch roster {
	case teamT:
		c.teamAScore++
	case teamCT:
		c.teamBScore++
	}
}

func (c *collector) finish() *models.ParsedMatch {
	mapName := c.p.Header().MapName
	if mapName == "" {
		mapName = "unknown"
	}

	match := models.Match{
		Map:         mapName,
		DemoSource:  "local",
		DurationS:   int(c.p.CurrentTime().Seconds()),
		RoundsTotal: c.roundNum,
		TeamAScore:  c.teamAScore,
		TeamBScore:  c.teamBScore,
		TickRate:    c.p.TickRate(),
	}

	players := make([]models.MatchPlayer, 0, len(c.players))
	for id, mp := range c.players {
		roster := c.rosterOf[id]
		mp.Won = (roster == teamT && c.teamAScore > c.teamBScore) ||
			(roster == teamCT && c.teamBScore > c.teamAScore)
		if mp.StartSide == "" {
			mp.StartSide = sideOf(roster)
		}
		stats.FillMatchPlayerDerived(mp)
		players = append(players, *mp)
	}

	return &models.ParsedMatch{
		Match:   match,
		Players: players,
		Rounds:  c.rounds,
		Kills:   c.kills,
	}
}

func sideOf(team int) models.Side {
	switch team {
	case teamT:
		return models.SideT
	case teamCT:
		return models.SideCT
	default:
		return models.SideUnknown
	}
}

func reasonString(r events.RoundEndReason) string {
	switch r {
	case events.RoundEndReasonTargetBombed:
		return "bomb_detonated"
	case events.RoundEndReasonBombDefused:
		return "bomb_defused"
	case events.RoundEndReasonCTWin:
		return "ct_elimination"
	case events.RoundEndReasonTerroristsWin:
		return "t_elimination"
	case events.RoundEndReasonTargetSaved:
		return "time_expired"
	case events.RoundEndReasonHostagesRescued:
		return "hostages_rescued"
	case events.RoundEndReasonHostagesNotRescued:
		return "hostages_not_rescued"
	case events.RoundEndReasonDraw:
		return "draw"
	default:
		return "other"
	}
}
