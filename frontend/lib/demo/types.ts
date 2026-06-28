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
  vx: number;
  vy: number;
  w: string;
  hs?: boolean;
}

export interface ReplayNade {
  t: number;
  k: "smoke" | "molotov" | "flash" | "he" | "decoy" | string;
  x: number; // landing / detonation
  y: number;
  ox?: number; // throw origin (where the thrower released it)
  oy?: number;
  dur: number;
  by: number; // thrower player index, -1 if unknown
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
}

export interface ReplayBomb {
  t: number;
  k: "plant_start" | "plant" | "defuse_start" | "defuse" | "explode" | string;
  x: number;
  y: number;
}

export interface ReplayRound {
  n: number;
  winner: "CT" | "T" | "";
  reason: string;
  freezeEnd?: number; // seconds since round start when buy time ends (older parses lack this)
  ct: number[]; // player indices on CT this round
  t: number[]; // player indices on T this round
  frames: ReplayFrame[];
  kills: ReplayKill[];
  nades: ReplayNade[];
  bomb: ReplayBomb[];
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
