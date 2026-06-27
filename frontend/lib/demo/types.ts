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
  x: number;
  y: number;
  dur: number;
  by: number; // thrower player index, -1 if unknown
}

// Per-player, per-round aggregates (economy, damage, flashes). Fields are
// omitted when zero, so treat them as optional.
export interface ReplayPlayerStat {
  i: number;
  equip?: number; // equipment value at freeze-time end
  buy?: "pistol" | "eco" | "force" | "full" | string;
  dmg?: number; // health damage dealt to enemies
  utilDmg?: number; // of dmg, from grenades/molotov
  flashed?: number; // enemies flashed
  flashDur?: number; // total enemy blind seconds dealt
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
