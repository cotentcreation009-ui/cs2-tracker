// Replay extraction: a positional pass over a demo that captures the data
// needed for 2D radar replay, heatmaps, zones and routes — downsampled player
// positions + view angles, and kill / grenade / bomb events with map
// coordinates. Kept separate from the aggregate stats collector.
//
// Memory discipline (this runs client-side in WASM): rounds are STREAMED via an
// emit callback as each one finishes, so the parser never holds the whole match
// in memory at once. Raw game-space coordinates are emitted; the frontend
// applies per-map radar calibration.
//
// Build-tag free so it compiles natively (CLI/tests) and to WASM.
package parser

import (
	"fmt"
	"io"
	"math"
	"sort"

	"github.com/golang/geo/r3"
	dem "github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/common"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/events"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/msg"
)

// captureHz is how many position snapshots/second we keep. 1 Hz matches the
// proven reference build: the frontend interpolates between samples, so a
// top-down radar stays smooth while data + memory stay ~6x smaller than 6 Hz.
const captureHz = 1

// --- compact output model (short JSON keys keep payloads small) -------------

// ReplayMeta is everything about a match except the per-round timelines. It's
// known once the parse completes (the roster is discovered as players appear).
type ReplayMeta struct {
	Map      string         `json:"map"`
	TickRate float64        `json:"tickRate"`
	FrameHz  int            `json:"frameHz"`
	Players  []ReplayPlayer `json:"players"`
	Rounds   int            `json:"rounds"`
}

// ReplayMatch is the full model (meta + every round). Used by the native CLI;
// the WASM path streams rounds instead of building this.
type ReplayMatch struct {
	ReplayMeta
	RoundData []ReplayRound `json:"roundData"`
}

type ReplayPlayer struct {
	SteamID uint64 `json:"steamId,string"`
	Name    string `json:"name"`
	Team    string `json:"team"` // starting side: "CT" | "T"
}

type ReplayRound struct {
	Number int           `json:"n"`
	Winner string        `json:"winner"`
	Reason string        `json:"reason"`
	CT     []int         `json:"ct"` // player indices on CT this round
	T      []int         `json:"t"`  // player indices on T this round
	Frames []ReplayFrame      `json:"frames"`
	Kills  []ReplayKill       `json:"kills"`
	Nades  []ReplayNade       `json:"nades"`
	Bomb   []ReplayBomb       `json:"bomb"`
	Stats  []ReplayPlayerStat `json:"stats"` // per-player aggregates for this round
}

// ReplayPlayerStat carries the per-player, per-round aggregates that need event
// data beyond positions/kills: economy (buy), damage (ADR/util) and flashes.
// Aggregated (not raw events) to keep the stored JSON compact.
type ReplayPlayerStat struct {
	I        int     `json:"i"`                  // player index
	Equip    int     `json:"equip,omitempty"`    // equipment value at freeze-time end
	Buy      string  `json:"buy,omitempty"`      // pistol | eco | force | full
	Dmg      int     `json:"dmg,omitempty"`      // health damage dealt to enemies
	UtilDmg  int     `json:"utilDmg,omitempty"`  // of Dmg, from grenades/molotov
	Flashed  int     `json:"flashed,omitempty"`  // enemies flashed
	FlashDur float64 `json:"flashDur,omitempty"` // total enemy blind seconds dealt
}

// ReplayFrame is one downsampled snapshot. T is seconds since round start.
type ReplayFrame struct {
	T   float64     `json:"t"`
	Pos []ReplayPos `json:"p"`
}

// ReplayPos is one player at one frame. I indexes into ReplayMeta.Players.
type ReplayPos struct {
	I   int   `json:"i"`
	X   int32 `json:"x"`
	Y   int32 `json:"y"`
	Yaw int16 `json:"d"`           // look direction, degrees
	Hp  int   `json:"h"`           // health
	B   bool  `json:"b,omitempty"` // carrying the bomb
}

type ReplayKill struct {
	T        float64 `json:"t"`
	Killer   int     `json:"k"` // player index, -1 if none
	Victim   int     `json:"v"`
	Kx       int32   `json:"kx"`
	Ky       int32   `json:"ky"`
	Vx       int32   `json:"vx"`
	Vy       int32   `json:"vy"`
	Weapon   string  `json:"w"`
	Headshot bool    `json:"hs,omitempty"`
}

type ReplayNade struct {
	T    float64 `json:"t"`
	Kind string  `json:"k"` // smoke | molotov | flash | he | decoy
	X    int32   `json:"x"`
	Y    int32   `json:"y"`
	Dur  float64 `json:"dur"`
	By   int     `json:"by"` // thrower player index, -1 if unknown
}

type ReplayBomb struct {
	T    float64 `json:"t"`
	Kind string  `json:"k"` // plant_start | plant | defuse_start | defuse | explode
	X    int32   `json:"x"`
	Y    int32   `json:"y"`
}

// --- entry points -----------------------------------------------------------

// ParseReplayStream parses a demo and invokes emit once per completed round,
// then returns the match meta. The caller is expected to consume/forward each
// round and let it be garbage-collected — the parser keeps only the current
// round in memory.
func ParseReplayStream(r io.Reader, emit func(ReplayRound)) (meta *ReplayMeta, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			err = fmt.Errorf("parser: replay recovered from panic: %v", rec)
		}
	}()

	p := dem.NewParser(r)
	defer p.Close()

	rc := &replayCollector{p: p, idx: map[uint64]int{}, emit: emit}

	p.RegisterEventHandler(rc.onMatchStart)
	p.RegisterEventHandler(rc.onRoundStart)
	p.RegisterEventHandler(rc.onRoundEnd)
	p.RegisterEventHandler(rc.onFrameDone)
	p.RegisterEventHandler(rc.onKill)
	p.RegisterEventHandler(rc.onBombPlantBegin)
	p.RegisterEventHandler(rc.onBombPlanted)
	p.RegisterEventHandler(rc.onBombDefuseStart)
	p.RegisterEventHandler(rc.onBombDefused)
	p.RegisterEventHandler(rc.onBombExplode)
	p.RegisterEventHandler(rc.onSmoke)
	p.RegisterEventHandler(rc.onInferno)
	p.RegisterEventHandler(rc.onFlash)
	p.RegisterEventHandler(rc.onHE)
	p.RegisterEventHandler(rc.onFreezeEnd)
	p.RegisterEventHandler(rc.onPlayerHurt)
	p.RegisterEventHandler(rc.onPlayerFlashed)

	// v5 dropped Parser.Header(); the map name arrives in the server-info net
	// message early in the stream, so capture it there.
	p.RegisterNetMessageHandler(func(m *msg.CSVCMsg_ServerInfo) {
		if n := m.GetMapName(); n != "" {
			rc.serverMapName = n
		}
	})

	// demoinfocs can abort mid-demo on CS2 protocol drift (e.g. "unable to find
	// existing entity N" — the demo is from a newer build than the parser fully
	// supports). Rounds completed before that point were emitted with a
	// consistent entity state, so salvage them as a partial result instead of
	// failing the whole demo. Only hard-fail when nothing usable came out.
	if err = p.ParseToEnd(); err != nil && rc.roundCount == 0 {
		return nil, fmt.Errorf("parser: replay parse: %w", err)
	}

	mapName := rc.serverMapName
	if mapName == "" {
		mapName = mapNameOf(p)
	}

	return &ReplayMeta{
		Map:      mapName,
		TickRate: p.TickRate(),
		FrameHz:  captureHz,
		Players:  rc.players,
		Rounds:   rc.roundCount,
	}, nil
}

// ParseReplay is the non-streaming convenience wrapper (CLI/tests). It collects
// every round into memory, so prefer ParseReplayStream for large demos / WASM.
func ParseReplay(r io.Reader) (*ReplayMatch, error) {
	var rounds []ReplayRound
	meta, err := ParseReplayStream(r, func(rd ReplayRound) { rounds = append(rounds, rd) })
	if err != nil {
		return nil, err
	}
	return &ReplayMatch{ReplayMeta: *meta, RoundData: rounds}, nil
}

// --- collector --------------------------------------------------------------

type replayCollector struct {
	p    dem.Parser
	emit func(ReplayRound)

	started       bool
	serverMapName string
	players       []ReplayPlayer
	idx           map[uint64]int
	roundCount    int

	cur      *ReplayRound
	stat     map[int]*ReplayPlayerStat // per-round per-player aggregates
	roundT0  float64
	capEvery float64
	lastCap  float64
}

// stats returns the per-round accumulator for a player index, creating it lazily.
func (rc *replayCollector) stats(i int) *ReplayPlayerStat {
	if i < 0 {
		return nil
	}
	if rc.stat == nil {
		rc.stat = map[int]*ReplayPlayerStat{}
	}
	s := rc.stat[i]
	if s == nil {
		s = &ReplayPlayerStat{I: i}
		rc.stat[i] = s
	}
	return s
}

func mapNameOf(p dem.Parser) string {
	// v5 dropped Parser.Header(); the map name comes from the game rules convars.
	if m := p.GameState().Rules().ConVars()["mp_mapname"]; m != "" {
		return m
	}
	return "unknown"
}

func (rc *replayCollector) playerIndex(pl *common.Player) int {
	if pl == nil || pl.SteamID64 == 0 {
		return -1
	}
	if i, ok := rc.idx[pl.SteamID64]; ok {
		if pl.Name != "" {
			rc.players[i].Name = pl.Name
		}
		return i
	}
	i := len(rc.players)
	rc.idx[pl.SteamID64] = i
	rc.players = append(rc.players, ReplayPlayer{
		SteamID: pl.SteamID64,
		Name:    pl.Name,
		Team:    teamStr(pl.Team),
	})
	return i
}

func teamStr(t common.Team) string {
	switch t {
	case common.TeamCounterTerrorists:
		return "CT"
	case common.TeamTerrorists:
		return "T"
	default:
		return ""
	}
}

func (rc *replayCollector) rt() float64 { return rc.p.CurrentTime().Seconds() - rc.roundT0 }

func (rc *replayCollector) onMatchStart(events.MatchStart) {
	rc.started = true
	rc.players = nil
	rc.idx = map[uint64]int{}
	rc.roundCount = 0
	rc.cur = nil
}

func (rc *replayCollector) onRoundStart(events.RoundStart) {
	if !rc.started || rc.p.GameState().IsWarmupPeriod() {
		return
	}
	rc.roundT0 = rc.p.CurrentTime().Seconds()
	tr := rc.p.TickRate()
	rc.capEvery = 1
	if tr > 0 {
		rc.capEvery = math.Max(1, math.Round(tr/float64(captureHz)))
	}
	rc.lastCap = -1e9
	// Initialise slices so empty categories marshal as [] (not null) — the §5
	// contract is arrays, and null would break array consumers on the frontend.
	rc.cur = &ReplayRound{
		Number: rc.roundCount + 1,
		CT:     []int{},
		T:      []int{},
		Frames: []ReplayFrame{},
		Kills:  []ReplayKill{},
		Nades:  []ReplayNade{},
		Bomb:   []ReplayBomb{},
		Stats:  []ReplayPlayerStat{},
	}
	rc.stat = map[int]*ReplayPlayerStat{}
	for _, pl := range rc.p.GameState().Participants().Playing() {
		i := rc.playerIndex(pl)
		if i < 0 {
			continue
		}
		switch pl.Team {
		case common.TeamCounterTerrorists:
			rc.cur.CT = append(rc.cur.CT, i)
		case common.TeamTerrorists:
			rc.cur.T = append(rc.cur.T, i)
		}
	}
}

func (rc *replayCollector) onRoundEnd(e events.RoundEnd) {
	if rc.cur == nil {
		return
	}
	rc.cur.Winner = teamStr(e.Winner)
	rc.cur.Reason = reasonString(e.Reason)
	// Flush per-player aggregates (sorted by index for stable output).
	if len(rc.stat) > 0 {
		idxs := make([]int, 0, len(rc.stat))
		for i := range rc.stat {
			idxs = append(idxs, i)
		}
		sort.Ints(idxs)
		for _, i := range idxs {
			rc.cur.Stats = append(rc.cur.Stats, *rc.stat[i])
		}
	}
	rc.roundCount++
	if rc.emit != nil {
		rc.emit(*rc.cur)
	}
	rc.cur = nil // release the round's frames immediately
	rc.stat = nil
}

func (rc *replayCollector) onFrameDone(events.FrameDone) {
	if rc.cur == nil || rc.p.GameState().IsWarmupPeriod() {
		return
	}
	tick := float64(rc.p.GameState().IngameTick())
	if tick-rc.lastCap < rc.capEvery {
		return
	}
	rc.lastCap = tick

	gs := rc.p.GameState()
	var carrier uint64
	if b := gs.Bomb(); b != nil && b.Carrier != nil {
		carrier = b.Carrier.SteamID64
	}

	frame := ReplayFrame{T: round2(rc.rt())}
	for _, pl := range gs.Participants().Playing() {
		if pl == nil || pl.SteamID64 == 0 || !pl.IsAlive() {
			continue
		}
		i := rc.playerIndex(pl)
		if i < 0 {
			continue
		}
		pos := pl.Position()
		frame.Pos = append(frame.Pos, ReplayPos{
			I:   i,
			X:   int32(math.Round(pos.X)),
			Y:   int32(math.Round(pos.Y)),
			Yaw: int16(math.Round(float64(pl.ViewDirectionX()))),
			Hp:  pl.Health(),
			B:   pl.SteamID64 == carrier,
		})
	}
	if len(frame.Pos) > 0 {
		rc.cur.Frames = append(rc.cur.Frames, frame)
	}
}

func (rc *replayCollector) onKill(e events.Kill) {
	if rc.cur == nil || e.Victim == nil {
		return
	}
	weapon := ""
	if e.Weapon != nil {
		weapon = e.Weapon.String()
	}
	k := ReplayKill{
		T:        round2(rc.rt()),
		Killer:   rc.playerIndex(e.Killer),
		Victim:   rc.playerIndex(e.Victim),
		Weapon:   weapon,
		Headshot: e.IsHeadshot,
	}
	vp := e.Victim.Position()
	k.Vx, k.Vy = i32(vp.X), i32(vp.Y)
	if e.Killer != nil {
		kp := e.Killer.Position()
		k.Kx, k.Ky = i32(kp.X), i32(kp.Y)
	}
	rc.cur.Kills = append(rc.cur.Kills, k)
}

func (rc *replayCollector) bombXY() (int32, int32) {
	if b := rc.p.GameState().Bomb(); b != nil {
		p := b.Position()
		return i32(p.X), i32(p.Y)
	}
	return 0, 0
}

func (rc *replayCollector) addBomb(kind string, x, y int32) {
	if rc.cur == nil {
		return
	}
	rc.cur.Bomb = append(rc.cur.Bomb, ReplayBomb{T: round2(rc.rt()), Kind: kind, X: x, Y: y})
}

func (rc *replayCollector) onBombPlantBegin(e events.BombPlantBegin) {
	if e.Player != nil {
		p := e.Player.Position()
		rc.addBomb("plant_start", i32(p.X), i32(p.Y))
	}
}
func (rc *replayCollector) onBombPlanted(events.BombPlanted)  { x, y := rc.bombXY(); rc.addBomb("plant", x, y) }
func (rc *replayCollector) onBombDefuseStart(events.BombDefuseStart) {
	x, y := rc.bombXY()
	rc.addBomb("defuse_start", x, y)
}
func (rc *replayCollector) onBombDefused(events.BombDefused) { x, y := rc.bombXY(); rc.addBomb("defuse", x, y) }
func (rc *replayCollector) onBombExplode(events.BombExplode) { x, y := rc.bombXY(); rc.addBomb("explode", x, y) }

func (rc *replayCollector) addNade(kind string, pos r3.Vector, dur float64, by *common.Player) {
	if rc.cur == nil {
		return
	}
	rc.cur.Nades = append(rc.cur.Nades, ReplayNade{
		T: round2(rc.rt()), Kind: kind, X: i32(pos.X), Y: i32(pos.Y), Dur: dur,
		By: rc.playerIndex(by),
	})
}

func (rc *replayCollector) onSmoke(e events.SmokeStart)         { rc.addNade("smoke", e.Position, 18, e.Thrower) }
func (rc *replayCollector) onInferno(e events.FireGrenadeStart) { rc.addNade("molotov", e.Position, 7, e.Thrower) }
func (rc *replayCollector) onFlash(e events.FlashExplode)       { rc.addNade("flash", e.Position, 0, e.Thrower) }
func (rc *replayCollector) onHE(e events.HeExplode)             { rc.addNade("he", e.Position, 0, e.Thrower) }

// onFreezeEnd snapshots each player's buy (equipment value + a coarse buy type)
// at the moment the round goes live.
func (rc *replayCollector) onFreezeEnd(events.RoundFreezetimeEnd) {
	if rc.cur == nil || rc.p.GameState().IsWarmupPeriod() {
		return
	}
	for _, pl := range rc.p.GameState().Participants().Playing() {
		s := rc.stats(rc.playerIndex(pl))
		if s == nil {
			continue
		}
		equip := pl.EquipmentValueFreezeTimeEnd()
		if equip == 0 {
			equip = pl.EquipmentValueCurrent()
		}
		s.Equip = equip
		s.Buy = buyType(equip, rc.cur.Number)
	}
}

// onPlayerHurt accumulates enemy damage dealt (and the grenade/fire share of it).
func (rc *replayCollector) onPlayerHurt(e events.PlayerHurt) {
	if rc.cur == nil || e.Attacker == nil || e.Player == nil || e.Attacker.Team == e.Player.Team {
		return
	}
	s := rc.stats(rc.playerIndex(e.Attacker))
	if s == nil {
		return
	}
	s.Dmg += e.HealthDamage
	if e.Weapon != nil && e.Weapon.Class() == common.EqClassGrenade {
		s.UtilDmg += e.HealthDamage
	}
}

// onPlayerFlashed credits the flasher with enemies blinded + blind-seconds.
func (rc *replayCollector) onPlayerFlashed(e events.PlayerFlashed) {
	if rc.cur == nil || e.Attacker == nil || e.Player == nil || e.Attacker.Team == e.Player.Team {
		return
	}
	s := rc.stats(rc.playerIndex(e.Attacker))
	if s == nil {
		return
	}
	s.Flashed++
	s.FlashDur += round2(e.FlashDuration().Seconds())
}

// buyType is a coarse economy bucket from equipment value (MR12 pistol rounds).
func buyType(equip, roundNum int) string {
	if roundNum == 1 || roundNum == 13 {
		return "pistol"
	}
	switch {
	case equip < 2000:
		return "eco"
	case equip < 4000:
		return "force"
	default:
		return "full"
	}
}

func i32(v float64) int32     { return int32(math.Round(v)) }
func round2(v float64) float64 { return math.Round(v*100) / 100 }
