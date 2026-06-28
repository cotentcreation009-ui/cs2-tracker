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
	Number    int     `json:"n"`
	Winner    string  `json:"winner"`
	Reason    string  `json:"reason"`
	FreezeEnd float64 `json:"freezeEnd,omitempty"` // seconds since round start when buy time ends
	CT        []int   `json:"ct"`                  // player indices on CT this round
	T         []int   `json:"t"`                   // player indices on T this round
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
	I        int      `json:"i"`               // player index
	Equip    int      `json:"equip,omitempty"` // equipment value at freeze-time end
	Buy      string   `json:"buy,omitempty"`   // pistol | eco | semi | force | full
	StartMoney int    `json:"startMoney,omitempty"` // cash at round start (before buying)
	Money    int      `json:"money,omitempty"`     // cash left after buying (freeze-time end)
	Bought   []string `json:"bought,omitempty"`    // loadout at round start (weapons/armor/kit)
	PickedUp []string `json:"pickedUp,omitempty"`  // guns grabbed off the ground (a dropped weapon), not bought
	Dmg      int         `json:"dmg,omitempty"`      // health damage dealt to enemies
	DmgTo    map[int]int `json:"dmgTo,omitempty"`    // damage dealt, by victim player index (even if not killed)
	UtilDmg  int         `json:"utilDmg,omitempty"`  // of Dmg, from grenades/molotov
	Flashed  int         `json:"flashed,omitempty"`  // enemies flashed
	FlashDur float64     `json:"flashDur,omitempty"` // total enemy blind seconds dealt
	// Aim tells (per-tick): for kills where the victim became visible to this
	// player shortly before dying. AimN = sample count; sum fields are averaged
	// on the frontend. RctMs = ms from victim-spotted to the kill (lower = faster
	// reaction); Preaim = crosshair offset to the victim at the spot instant in
	// degrees (lower = more precise pre-aim).
	AimN   int     `json:"aimN,omitempty"`
	RctMs  float64 `json:"rctMs,omitempty"`
	Preaim float64 `json:"preaim,omitempty"`
	Snap   int     `json:"snap,omitempty"` // kills that landed fast despite a far crosshair
	// Shooting accuracy (firearms only, pump/auto shotguns excluded — see
	// isFirearm): Shots = bullets fired, Hits = bullets that dealt damage to an
	// enemy, HsHits = of those, headshots. Volume-independent aim-quality tells.
	Shots  int `json:"shots,omitempty"`
	Hits   int `json:"hits,omitempty"`
	HsHits int `json:"hsHits,omitempty"`
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
	Assister int     `json:"a,omitempty"` // assisting player index + 1 (0 = none), enemy of victim only
}

type ReplayNade struct {
	T    float64 `json:"t"`
	Kind string  `json:"k"` // smoke | molotov | flash | he | decoy
	X    int32   `json:"x"`  // landing / detonation X
	Y    int32   `json:"y"`  // landing / detonation Y
	Ox   int32   `json:"ox"` // throw-origin X (where the thrower released it)
	Oy   int32   `json:"oy"` // throw-origin Y
	Dur  float64     `json:"dur"`
	By   int         `json:"by"`            // thrower player index, -1 if unknown
	Dmg  map[int]int `json:"dmg,omitempty"` // damage this grenade dealt, by victim index (HE/molotov)
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
	p.RegisterEventHandler(rc.onProjectileThrow)
	p.RegisterEventHandler(rc.onSmoke)
	p.RegisterEventHandler(rc.onInferno)
	p.RegisterEventHandler(rc.onFlash)
	p.RegisterEventHandler(rc.onHE)
	p.RegisterEventHandler(rc.onDecoy)
	p.RegisterEventHandler(rc.onFreezeEnd)
	p.RegisterEventHandler(rc.onPlayerHurt)
	p.RegisterEventHandler(rc.onPlayerFlashed)
	p.RegisterEventHandler(rc.onWeaponFire)
	p.RegisterEventHandler(rc.onItemDrop)
	p.RegisterEventHandler(rc.onItemPickup)

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

	// aim-tell tracking (per round): victim steamID -> spotter steamID -> state.
	// spotted = current spotted-by state (for rising-edge detection); spotT =
	// time the current spotted episode began; spotAim = spotter's crosshair
	// offset (deg) to the victim at that instant.
	spotted map[uint64]map[uint64]bool
	spotT   map[uint64]map[uint64]float64
	spotAim map[uint64]map[uint64]float64

	// util throw-origin tracking (per round). The detonation events (SmokeStart
	// etc.) fire where the nade LANDS — by then the thrower has moved — so we
	// capture the launch point at GrenadeProjectileThrow and join it back.
	// nadeOrigins is keyed by the projectile entity id (matches GrenadeEntityID
	// on smoke/he/flash/decoy); moloOrigins is a fallback queue for molotovs,
	// whose inferno entity id does NOT match the projectile id.
	nadeOrigins map[int]throwOrigin
	moloOrigins []throwOrigin
	// dedup detonation events by grenade entity id within a short window —
	// demoinfocs dispatches FlashExplode twice (game-event + Source-1 mimic).
	nadeSeen map[int]float64

	// dropped-weapon tracking (per round). droppedW holds weapon unique-ids that
	// are currently on the ground (ItemDrop), so an ItemPickup of one is a genuine
	// ground pickup (a dropped weapon) rather than a fresh buy — a buy spawns a new
	// entity with an id we've never seen. pickedSeen dedupes per player+weapon.
	droppedW   map[string]bool
	pickedSeen map[string]bool
}

type throwOrigin struct {
	x, y int32
	by   int
	kind string
	t    float64
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
	rc.spotted = map[uint64]map[uint64]bool{}
	rc.spotT = map[uint64]map[uint64]float64{}
	rc.spotAim = map[uint64]map[uint64]float64{}
	rc.nadeOrigins = map[int]throwOrigin{} // entity ids are reused — reset each round
	rc.moloOrigins = nil
	rc.nadeSeen = map[int]float64{}
	rc.droppedW = map[string]bool{}
	rc.pickedSeen = map[string]bool{}
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
		if s := rc.stats(i); s != nil {
			s.StartMoney = pl.Money() // cash before the buy phase
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
	rc.nadeOrigins = nil
	rc.moloOrigins = nil
	rc.nadeSeen = nil
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

	// Aim-tell tracking: detect the rising edge of "victim spotted by enemy k",
	// recording the time + k's crosshair offset to the victim at that instant.
	// onKill reads the latest episode to derive reaction + pre-aim.
	now := rc.rt()
	alive := gs.Participants().Playing()
	for _, v := range alive {
		if v == nil || v.SteamID64 == 0 || !v.IsAlive() {
			continue
		}
		for _, k := range alive {
			if k == nil || k.SteamID64 == 0 || k == v || !k.IsAlive() || k.Team == v.Team {
				continue
			}
			seen := v.IsSpottedBy(k)
			was := rc.spotted[v.SteamID64] != nil && rc.spotted[v.SteamID64][k.SteamID64]
			if seen && !was {
				rc.setSpot(v.SteamID64, k.SteamID64, now, aimOffsetDeg(k, v))
			}
			rc.setSpotted(v.SteamID64, k.SteamID64, seen)
		}
	}
}

func (rc *replayCollector) setSpotted(v, k uint64, val bool) {
	if rc.spotted[v] == nil {
		rc.spotted[v] = map[uint64]bool{}
	}
	rc.spotted[v][k] = val
}

func (rc *replayCollector) setSpot(v, k uint64, t, aim float64) {
	if rc.spotT[v] == nil {
		rc.spotT[v] = map[uint64]float64{}
		rc.spotAim[v] = map[uint64]float64{}
	}
	rc.spotT[v][k] = t
	rc.spotAim[v][k] = aim
}

// aimOffsetDeg is the angle (degrees) between k's view direction and the vector
// from k's eyes to v — i.e. how far off the crosshair is from the target.
func aimOffsetDeg(k, v *common.Player) float64 {
	ke := k.Position()
	ve := v.Position()
	dx, dy, dz := ve.X-ke.X, ve.Y-ke.Y, (ve.Z+50)-(ke.Z+64)
	dl := math.Sqrt(dx*dx + dy*dy + dz*dz)
	if dl == 0 {
		return 180
	}
	yaw := float64(k.ViewDirectionX()) * math.Pi / 180
	pitch := float64(k.ViewDirectionY()) * math.Pi / 180
	ax := math.Cos(yaw) * math.Cos(pitch)
	ay := math.Sin(yaw) * math.Cos(pitch)
	az := -math.Sin(pitch)
	dot := (dx*ax + dy*ay + dz*az) / dl
	if dot > 1 {
		dot = 1
	} else if dot < -1 {
		dot = -1
	}
	return math.Acos(dot) * 180 / math.Pi
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
	// real assist (enemy of the victim), stored +1 so 0 = none survives omitempty
	if e.Assister != nil && e.Victim != nil && e.Assister.Team != e.Victim.Team {
		if ai := rc.playerIndex(e.Assister); ai >= 0 {
			k.Assister = ai + 1
		}
	}
	rc.cur.Kills = append(rc.cur.Kills, k)

	// Aim tells for the killer: if the victim had become visible to them, how
	// fast they killed after the victim appeared + how close the crosshair
	// already was when the victim appeared.
	if e.Killer != nil && k.Killer >= 0 && rc.spotT[e.Victim.SteamID64] != nil {
		vID, kID := e.Victim.SteamID64, e.Killer.SteamID64
		if st, ok := rc.spotT[vID][kID]; ok {
			rctMs := (rc.rt() - st) * 1000
			if rctMs >= 0 && rctMs <= 3000 { // genuine react-and-kill window
				if s := rc.stats(k.Killer); s != nil {
					preaim := rc.spotAim[vID][kID]
					s.AimN++
					s.RctMs += rctMs
					s.Preaim += preaim
					// "snap": killed almost instantly DESPITE the crosshair being
					// well off-target — i.e. a superhuman correction. (A pre-aimed
					// angle-hold has a LOW pre-aim offset, so it isn't counted —
					// that's the point: this flags aim that shouldn't be possible,
					// not good positioning.)
					if preaim >= 12 && rctMs <= 300 {
						s.Snap++
					}
				}
			}
		}
	}
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

// onProjectileThrow records where each grenade was released, so the detonation
// handlers can attach a real throw origin instead of the landing spot.
func (rc *replayCollector) onProjectileThrow(e events.GrenadeProjectileThrow) {
	proj := e.Projectile
	if rc.cur == nil || proj == nil || proj.WeaponInstance == nil {
		return
	}
	kind := kindOfEq(proj.WeaponInstance.Type)
	if kind == "" {
		return
	}
	op := proj.Position()
	if len(proj.Trajectory) > 0 {
		op = proj.Trajectory[0].Position // the launch point, appended at throw
	}
	o := throwOrigin{x: i32(op.X), y: i32(op.Y), by: rc.playerIndex(proj.Thrower), kind: kind, t: round2(rc.rt())}
	rc.nadeOrigins[proj.Entity.ID()] = o
	if kind == "molotov" {
		rc.moloOrigins = append(rc.moloOrigins, o)
	}
}

// addNade appends a nade row, resolving its throw origin from the registry
// (by projectile entity id) with a molotov-only thrower+time fallback. When no
// origin is found, Ox/Oy default to the landing so the line is just zero-length.
func (rc *replayCollector) addNade(kind string, pos r3.Vector, dur float64, by *common.Player, entID int) {
	if rc.cur == nil {
		return
	}
	// Dedup duplicate detonation dispatches for the same grenade (flashes fire a
	// game event AND a Source-1 mimic). Same entity id within ~1s = the same
	// detonation; a far-later reuse of the id is a different grenade, so keep it.
	if entID >= 0 {
		if last, seen := rc.nadeSeen[entID]; seen && rc.rt()-last < 1 {
			return
		}
		rc.nadeSeen[entID] = rc.rt()
	}
	n := ReplayNade{T: round2(rc.rt()), Kind: kind, X: i32(pos.X), Y: i32(pos.Y), Dur: dur, By: rc.playerIndex(by)}
	o, ok := throwOrigin{}, false
	if entID >= 0 {
		o, ok = rc.nadeOrigins[entID]
	}
	if !ok && kind == "molotov" {
		o, ok = rc.popMolo(n.By)
	}
	if ok {
		n.Ox, n.Oy = o.x, o.y
		if n.By < 0 {
			n.By = o.by
		}
	} else {
		n.Ox, n.Oy = n.X, n.Y
	}
	rc.cur.Nades = append(rc.cur.Nades, n)
}

// addNadeDamage attributes grenade damage to the most recent matching nade this
// round (same thrower + kind, within the grenade's active window) so the util
// list can show what each HE/molotov did and to whom.
func (rc *replayCollector) addNadeDamage(by int, kind string, victim, dmg int) {
	if rc.cur == nil || by < 0 {
		return
	}
	window := 2.0 // HE damages at the explosion tick
	if kind == "molotov" {
		window = 10.0 // a fire burns for several seconds
	}
	now := rc.rt()
	for i := len(rc.cur.Nades) - 1; i >= 0; i-- {
		n := &rc.cur.Nades[i]
		if n.By != by || n.Kind != kind {
			continue
		}
		if now-n.T > window {
			return // most recent matching grenade is too old — leave unattributed
		}
		if n.Dmg == nil {
			n.Dmg = map[int]int{}
		}
		n.Dmg[victim] += dmg
		return
	}
}

// popMolo finds and removes the best molotov throw-origin: prefer the same
// thrower, then the oldest throw (infernos ignite in throw order). Returns
// ok=false when the queue is empty.
func (rc *replayCollector) popMolo(by int) (throwOrigin, bool) {
	best := -1
	for i, o := range rc.moloOrigins {
		if best < 0 {
			best = i
			continue
		}
		b := rc.moloOrigins[best]
		// favour a thrower match, then the OLDEST throw — infernos ignite in
		// throw order, so popping oldest-first keeps origins paired correctly.
		bMatch, oMatch := b.by == by && by >= 0, o.by == by && by >= 0
		if oMatch && !bMatch {
			best = i
		} else if oMatch == bMatch && o.t < b.t {
			best = i
		}
	}
	if best < 0 {
		return throwOrigin{}, false
	}
	o := rc.moloOrigins[best]
	rc.moloOrigins = append(rc.moloOrigins[:best], rc.moloOrigins[best+1:]...)
	return o, true
}

// kindOfEq maps a grenade equipment type to our nade kind, "" if not a grenade.
func kindOfEq(t common.EquipmentType) string {
	switch t {
	case common.EqSmoke:
		return "smoke"
	case common.EqHE:
		return "he"
	case common.EqFlash:
		return "flash"
	case common.EqDecoy:
		return "decoy"
	case common.EqMolotov, common.EqIncendiary:
		return "molotov"
	default:
		return ""
	}
}

func (rc *replayCollector) onSmoke(e events.SmokeStart) { rc.addNade("smoke", e.Position, 18, e.Thrower, e.GrenadeEntityID) }
func (rc *replayCollector) onFlash(e events.FlashExplode) { rc.addNade("flash", e.Position, 0, e.Thrower, e.GrenadeEntityID) }
func (rc *replayCollector) onHE(e events.HeExplode)       { rc.addNade("he", e.Position, 0, e.Thrower, e.GrenadeEntityID) }
func (rc *replayCollector) onDecoy(e events.DecoyStart)   { rc.addNade("decoy", e.Position, 0, e.Thrower, e.GrenadeEntityID) }

// onInferno uses InfernoStart (the actual fire) rather than FireGrenadeStart,
// which in Source 2 has a nil thrower and may not fire. The inferno entity id
// doesn't match the projectile, so molotov origins use the thrower+time fallback.
func (rc *replayCollector) onInferno(e events.InfernoStart) {
	if e.Inferno == nil {
		return
	}
	pos := e.Inferno.Entity.Position()
	rc.addNade("molotov", pos, 7, e.Inferno.Thrower(), -1)
}

// onFreezeEnd snapshots each player's buy (equipment value + a coarse buy type)
// at the moment the round goes live.
func (rc *replayCollector) onFreezeEnd(events.RoundFreezetimeEnd) {
	if rc.cur == nil || rc.p.GameState().IsWarmupPeriod() {
		return
	}
	rc.cur.FreezeEnd = round2(rc.rt()) // round goes live — used to drop buy-phase spawn camping
	for _, pl := range rc.p.GameState().Participants().Playing() {
		s := rc.stats(rc.playerIndex(pl))
		if s == nil {
			continue
		}
		equip := equipValue(pl)
		s.Equip = equip
		s.Buy = buyType(equip, rc.cur.Number)
		s.Money = pl.Money() // cash left after buying
		s.Bought = loadout(pl)
	}
}

// loadout is the player's weapons + armor + kit at freeze-time end — i.e. what
// they're playing the round with (knife/bomb excluded).
func loadout(pl *common.Player) []string {
	var out []string
	for _, w := range pl.Weapons() {
		if w == nil || w.Type == common.EqKnife || w.Type == common.EqBomb {
			continue
		}
		out = append(out, w.String())
	}
	if pl.Armor() > 0 {
		if pl.HasHelmet() {
			out = append(out, "Kevlar + Helmet")
		} else {
			out = append(out, "Kevlar Vest")
		}
	}
	if pl.HasDefuseKit() {
		out = append(out, "Defuse Kit")
	}
	return out
}

// eqPrice is the CS2 buy-menu cost per equipment type. The demo's
// m_unFreezetimeEndEquipmentValue property is unreliable (often stale on the
// freeze-end tick, reporting a previous round's value), so we value the loadout
// ourselves. Default spawn pistols are $0 (not paid for). Prices as of 2024.
var eqPrice = map[common.EquipmentType]int{
	common.EqGlock: 0, common.EqUSP: 0, common.EqP2000: 0,
	common.EqP250: 300, common.EqDualBerettas: 300, common.EqFiveSeven: 500,
	common.EqTec9: 500, common.EqCZ: 500, common.EqDeagle: 700, common.EqRevolver: 600,
	common.EqMac10: 1050, common.EqMP9: 1250, common.EqMP7: 1500, common.EqMP5: 1500,
	common.EqUMP: 1200, common.EqP90: 2350, common.EqBizon: 1400,
	common.EqGalil: 1800, common.EqFamas: 2050, common.EqAK47: 2700, common.EqM4A4: 3100,
	common.EqM4A1: 2900, common.EqSG553: 3000, common.EqAUG: 3300,
	common.EqSSG08: 1700, common.EqAWP: 4750,
	common.EqScar20: 5000, common.EqG3SG1: 5000,
	common.EqNova: 1050, common.EqXM1014: 2000, common.EqSawedOff: 1100,
	common.EqMag7: 1300, common.EqM249: 5200, common.EqNegev: 1700,
	common.EqFlash: 200, common.EqHE: 300, common.EqSmoke: 300, common.EqMolotov: 400,
	common.EqIncendiary: 600, common.EqDecoy: 50, common.EqZeus: 200,
}

// equipValue sums the buy-menu worth of a player's gear (weapons + grenades +
// armor + kit) — a reliable stand-in for the demo's flaky freeze-end equipment
// value, and guaranteed to match the loadout we display.
func equipValue(pl *common.Player) int {
	if pl == nil {
		return 0
	}
	v := 0
	for _, w := range pl.Weapons() {
		if w != nil {
			v += eqPrice[w.Type] // knife/bomb/unknown → 0
		}
	}
	if pl.Armor() > 0 {
		v += 650
		if pl.HasHelmet() {
			v += 350
		}
	}
	if pl.HasDefuseKit() {
		v += 400
	}
	return v
}

// onItemDrop marks a weapon as lying on the ground, so a later pickup of the
// same entity is recognised as a ground pickup rather than a buy.
func (rc *replayCollector) onItemDrop(e events.ItemDrop) {
	if rc.cur == nil || e.Weapon == nil {
		return
	}
	rc.droppedW[e.Weapon.UniqueID2().String()] = true
}

// onItemPickup records guns a player grabbed off the ground — a previously
// dropped weapon (a teammate's drop or a dead player's gun) — as distinct from a
// buy, which spawns a brand-new entity id that was never on the ground.
func (rc *replayCollector) onItemPickup(e events.ItemPickup) {
	if rc.cur == nil || e.Player == nil || e.Weapon == nil {
		return
	}
	w := e.Weapon
	if w.Type == common.EqKnife || w.Type == common.EqBomb || w.Class() == common.EqClassGrenade {
		return // guns only — knife/bomb/utility aren't "dropped weapons" worth noting
	}
	id := w.UniqueID2().String()
	if !rc.droppedW[id] {
		return // never on the ground → a fresh buy, not a pickup
	}
	delete(rc.droppedW, id) // now held by this player
	i := rc.playerIndex(e.Player)
	if i < 0 {
		return
	}
	key := fmt.Sprintf("%d:%s", i, id)
	if rc.pickedSeen[key] {
		return // already credited this player with this exact weapon
	}
	rc.pickedSeen[key] = true
	if s := rc.stats(i); s != nil {
		s.PickedUp = append(s.PickedUp, w.String())
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
	// HealthDamageTaken excludes over-damage (capped at the victim's remaining HP),
	// so per-enemy damage can't exceed 100 — HealthDamage is the raw/over-damage.
	dmg := e.HealthDamageTaken
	s.Dmg += dmg
	vi := rc.playerIndex(e.Player)
	if vi >= 0 {
		if s.DmgTo == nil {
			s.DmgTo = map[int]int{}
		}
		s.DmgTo[vi] += dmg
	}
	if e.Weapon != nil && e.Weapon.Class() == common.EqClassGrenade {
		s.UtilDmg += dmg
		if k := kindOfEq(e.Weapon.Type); vi >= 0 && (k == "he" || k == "molotov") {
			rc.addNadeDamage(rc.playerIndex(e.Attacker), k, vi, dmg)
		}
	}
	if isFirearm(e.Weapon) {
		s.Hits++
		if e.HitGroup == events.HitGroupHead {
			s.HsHits++
		}
	}
}

// onWeaponFire counts firearm shots for accuracy (hits/shots). Grenades, knife
// and zeus are excluded so accuracy reflects gunplay only.
func (rc *replayCollector) onWeaponFire(e events.WeaponFire) {
	if rc.cur == nil || e.Shooter == nil || !isFirearm(e.Weapon) {
		return
	}
	if s := rc.stats(rc.playerIndex(e.Shooter)); s != nil {
		s.Shots++
	}
}

// isFirearm reports whether a weapon counts toward shot accuracy. Pump/auto
// shotguns are EXCLUDED: one trigger pull fires many pellets, each landing as a
// separate damage event, so they'd register one Shot but several Hits and
// inflate accuracy past 100%. LMGs (M249/Negev) stay — one bullet per shot.
func isFirearm(w *common.Equipment) bool {
	if w == nil {
		return false
	}
	switch w.Type {
	case common.EqSawedOff, common.EqNova, common.EqMag7, common.EqXM1014:
		return false
	}
	switch w.Class() {
	case common.EqClassPistols, common.EqClassSMG, common.EqClassHeavy, common.EqClassRifle:
		return true
	default:
		return false
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
// Buckets mirror the frontend classifier (lib/demo/economy.ts).
func buyType(equip, roundNum int) string {
	if roundNum == 1 || roundNum == 13 {
		return "pistol"
	}
	switch {
	case equip < 1000:
		return "eco"
	case equip < 2500:
		return "semi"
	case equip < 4000:
		return "force"
	default:
		return "full"
	}
}

func i32(v float64) int32     { return int32(math.Round(v)) }
func round2(v float64) float64 { return math.Round(v*100) / 100 }
