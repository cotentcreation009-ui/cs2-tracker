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
