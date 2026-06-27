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
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/cs2tracker/server/internal/models"
	"github.com/cs2tracker/server/internal/stats"
	dem "github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/common"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/events"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/msg"
)

// HashFile returns the hex-encoded SHA-256 of a file. The worker stamps this on
// a match so re-ingesting the identical demo is deduplicated (parse-once).
func HashFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

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
	p.RegisterEventHandler(c.onFreezeEnd)
	p.RegisterEventHandler(c.onKill)
	p.RegisterEventHandler(c.onPlayerHurt)
	p.RegisterEventHandler(c.onPlayerFlashed)
	p.RegisterEventHandler(c.onMVP)
	p.RegisterEventHandler(c.onRoundEnd)

	// v5 dropped Parser.Header(); the map name arrives in the server-info message.
	p.RegisterNetMessageHandler(func(m *msg.CSVCMsg_ServerInfo) {
		if n := m.GetMapName(); n != "" {
			c.serverMapName = n
		}
	})

	if err = p.ParseToEnd(); err != nil {
		return nil, fmt.Errorf("parser: parse demo: %w", err)
	}

	return c.finish(), nil
}

type collector struct {
	p dem.Parser

	serverMapName string
	matchStarted  bool
	rt           *RoundTracker
	roundNum     int // completed rounds so far

	players  map[uint64]*models.MatchPlayer
	rosterOf map[uint64]int // steamID -> starting team (roster identity)

	teamAScore int // roster that started on T
	teamBScore int // roster that started on CT

	// Per-round economy, captured at freeze-time end.
	curCTEquip   int
	curTEquip    int
	curPistol    bool
	prevCTRoster int // roster on CT last round, for half-swap pistol detection

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
	c.prevCTRoster = 0
	c.rounds = nil
	c.kills = nil
}

func (c *collector) onRoundStart(events.RoundStart) {
	if !c.matchStarted || c.p.GameState().IsWarmupPeriod() {
		return
	}
	c.curCTEquip, c.curTEquip, c.curPistol = 0, 0, false
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

// onFreezeEnd captures each team's equipment value the instant buy time ends —
// i.e. what they bought this round — and detects pistol rounds (round 1, or the
// first round after the halftime side swap).
func (c *collector) onFreezeEnd(events.RoundFreezetimeEnd) {
	if !c.matchStarted || c.rt == nil || c.p.GameState().IsWarmupPeriod() {
		return
	}
	gs := c.p.GameState()
	c.curCTEquip = gs.TeamCounterTerrorists().CurrentEquipmentValue()
	c.curTEquip = gs.TeamTerrorists().CurrentEquipmentValue()

	ctRoster := c.majorityRoster(teamCT)
	c.curPistol = c.roundNum == 0 || (c.prevCTRoster != 0 && ctRoster != c.prevCTRoster)
	if ctRoster != 0 {
		c.prevCTRoster = ctRoster
	}
}

// majorityRoster returns the roster identity (starting team) that most of the
// players currently on the given side belong to.
func (c *collector) majorityRoster(side int) int {
	counts := map[int]int{}
	for _, pl := range c.p.GameState().Participants().Playing() {
		if pl == nil || pl.SteamID64 == 0 || int(pl.Team) != side {
			continue
		}
		if r, ok := c.rosterOf[pl.SteamID64]; ok {
			counts[r]++
		}
	}
	best, roster := -1, 0
	for r, n := range counts {
		if n > best {
			best, roster = n, r
		}
	}
	return roster
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
	ap := c.player(e.Attacker.SteamID64)
	ap.EnemiesFlashed++
	ap.FlashDuration += e.FlashDuration().Seconds()
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
		size := out.ClutchOpponents
		if size < 1 {
			size = 1
		} else if size > 5 {
			size = 5
		}
		if cp.Clutch.WonBySize == nil {
			cp.Clutch.WonBySize = make([]int, 6)
			cp.Clutch.LostBySize = make([]int, 6)
		}
		if out.ClutchWon {
			cp.ClutchesWon++
			cp.Clutch.WonBySize[size]++
		} else {
			cp.ClutchesLost++
			cp.Clutch.LostBySize[size]++
		}
	}

	c.rounds = append(c.rounds, models.Round{
		Number:       c.roundNum + 1,
		WinnerSide:   sideOf(winner),
		EndReason:    reasonString(e.Reason),
		CTBuy:        stats.ClassifyBuy(c.curCTEquip, c.curPistol),
		TBuy:         stats.ClassifyBuy(c.curTEquip, c.curPistol),
		CTEquipValue: c.curCTEquip,
		TEquipValue:  c.curTEquip,
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
	switch c.majorityRoster(winner) {
	case teamT:
		c.teamAScore++
	case teamCT:
		c.teamBScore++
	}
}

func (c *collector) finish() *models.ParsedMatch {
	// v5 dropped Parser.Header(); prefer the server-info map name, then convars.
	mapName := c.serverMapName
	if mapName == "" {
		mapName = c.p.GameState().Rules().ConVars()["mp_mapname"]
	}
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
