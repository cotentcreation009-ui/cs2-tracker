// TypeScript mirror of the WASM parser's compact replay model
// (backend/internal/parser/replay.go). Coordinates are raw game-space; apply
// per-map calibration (lib/maps/calibration.ts) to map them to the radar image.

export interface ReplayPlayer {
  steamId: string;
  name: string;
  team: "CT" | "T" | "";
}

export interface ReplayPos {
  i: number; // index into ReplayMeta.players
  x: number;
  y: number;
  z?: number; // height (game units) — enables level-aware radars (older parses lack this)
  d: number; // look direction, degrees
  h: number; // health
  b?: boolean; // carrying the bomb
}

export interface ReplayFrame {
  t: number; // seconds since round start
  p: ReplayPos[];
}

export interface ReplayKill {
  t: number;
  k: number; // killer player index, -1 if none
  v: number; // victim player index
  kx: number;
  ky: number;
  kz?: number; // killer height (game units)
  vx: number;
  vy: number;
  vz?: number; // victim height (game units)
  w: string;
  hs?: boolean;
  a?: number; // assisting player index + 1 (0/undefined = none)
  fa?: boolean; // the assist was a flash assist (assister blinded the victim)
  wb?: boolean; // wallbang — bullet penetrated at least one object
  ts?: boolean; // through smoke
  bl?: boolean; // attacker was flashed
  ns?: boolean; // noscope — scoped weapon fired unscoped
  rct?: number; // reaction ms for THIS kill (victim became visible → kill); absent = not measurable
}

export interface ReplayNade {
  t: number;
  k: "smoke" | "molotov" | "flash" | "he" | "decoy" | string;
  x: number; // landing / detonation
  y: number;
  z?: number; // landing / detonation height (game units)
  ox?: number; // throw origin (where the thrower released it)
  oy?: number;
  oz?: number; // throw-origin height (game units)
  dur: number;
  by: number; // thrower player index, -1 if unknown
  dmg?: Record<string, number>; // damage this grenade dealt, by victim index (HE/molotov)
  vic?: Record<string, number>; // blind seconds this flash inflicted, by victim index — ALL victims (enemies, teammates, self)
}

// Per-player, per-round aggregates (economy, damage, flashes). Fields are
// omitted when zero, so treat them as optional.
export interface ReplayPlayerStat {
  i: number;
  equip?: number; // equipment value at freeze-time end
  buy?: "pistol" | "eco" | "force" | "full" | string;
  startMoney?: number; // cash at round start (before buying)
  money?: number; // cash left after buying (freeze-time end)
  bought?: string[]; // loadout at round start (weapons/armor/kit)
  pickedUp?: string[]; // guns grabbed off the ground (a dropped weapon), not bought
  dmg?: number; // health damage dealt to enemies
  dmgTo?: Record<string, number>; // damage dealt, by victim player index (even without a kill)
  utilDmg?: number; // of dmg, from grenades/molotov
  flashed?: number; // enemies flashed
  flashDur?: number; // total enemy blind seconds dealt
  aimN?: number; // kills with an aim-tell sample (victim became visible first)
  rctMs?: number; // sum reaction ms (since victim spotted) — average by aimN
  preaim?: number; // sum crosshair offset (deg) at spot instant — average by aimN
  snap?: number; // kills landed fast despite a far crosshair (superhuman correction)
  shots?: number; // firearm bullets fired
  hits?: number; // firearm bullets that dealt damage
  hsHits?: number; // of hits, headshots
  tf?: number; // teammates flashed (self excluded)
  tfDur?: number; // total teammate blind seconds dealt (rounded to 0.1s)
  tDmg?: number; // team damage dealt (self-damage excluded)
  wacc?: Record<string, ReplayWeaponAcc>; // per-weapon accuracy, by weapon display name (same firearm gate as shots/hits)
}

// One weapon's shots/hits tally inside ReplayPlayerStat.wacc.
export interface ReplayWeaponAcc {
  s?: number; // shots fired
  h?: number; // bullets that dealt damage to an enemy
}

// One in-game chat message. GOTV demos generally record only all-chat; team
// chat is usually absent from the demo itself. Absent on older parses.
export interface ReplayChat {
  t: number;
  by: number; // player index, -1 if unknown
  x: string; // the message
  all?: boolean; // said to everyone (vs team chat, when present)
}

export interface ReplayBomb {
  t: number;
  k: "plant_start" | "plant" | "defuse_start" | "defuse" | "explode" | string;
  x: number;
  y: number;
  z?: number; // height (game units)
  p?: number; // acting player index + 1 (0/undefined = unknown), same trick as ReplayKill.a
  site?: "A" | "B" | string; // bombsite, when the event carries one
  kit?: boolean; // defuse events: defuser has a kit
}

export interface ReplayRound {
  n: number;
  winner: "CT" | "T" | "";
  reason: string;
  st?: number; // in-game tick at round start (ties round times back to demo ticks; older parses lack this)
  freezeEnd?: number; // seconds since round start when buy time ends (older parses lack this)
  ct: number[]; // player indices on CT this round
  t: number[]; // player indices on T this round
  frames: ReplayFrame[];
  kills: ReplayKill[];
  nades: ReplayNade[];
  bomb: ReplayBomb[];
  chat?: ReplayChat[]; // in-game chat sent during the round (older parses lack this)
  stats?: ReplayPlayerStat[]; // per-player aggregates (older parses lack this)
}

export interface ReplayMeta {
  map: string;
  tickRate: number;
  frameHz: number;
  players: ReplayPlayer[];
  rounds: number;
}

// A fully assembled match (meta + its rounds) plus library bookkeeping.
export interface ReplayData {
  id: string;
  name: string;
  savedAt: number;
  meta: ReplayMeta;
  rounds: ReplayRound[];
}
