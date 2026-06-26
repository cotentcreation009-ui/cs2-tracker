// Canonical normalized demo model (the reference build's "§5" contract).
//
// BOTH parse paths emit this exact shape — client-WASM (demoinfocs→WASM) and the
// server-side worker — and EVERYTHING downstream (storage, analytics, radar
// replay) consumes only this. Coordinates are world units; viewAngle is yaw
// degrees (0–360); team is normalized to "CT"/"T"/null at the parser. Unknown
// coords are null (never 0,0,0). Positions are downsampled to ~1 Hz of live
// round time before upload.

export type Team = "CT" | "T" | null;
export type DemoType = "gotv" | "pov";
export type RoundOutcome = "elimination" | "bomb" | "defuse" | "time" | null;
export type EconomyType = "pistol" | "eco" | "force" | "full";

export type EventType =
  | "kill"
  | "death"
  | "smoke"
  | "flash"
  | "molotov"
  | "he"
  | "bomb"
  | "defuse"
  | "explode"
  | "purchase"
  | "weapon_fire"
  | "util_damage"
  | "flash_blind";

export interface NormPlayer {
  steamId: string;
  name: string;
  team: Team;
  isBot: boolean;
  kills: number;
  deaths: number;
}

export interface NormRound {
  roundNumber: number;
  startTick: number;
  freezeEndTick?: number | null;
  endTick: number;
  winnerSide: Team;
  outcome: RoundOutcome;
  economyType: EconomyType;
  isOvertime: boolean;
}

export interface NormEvent {
  roundNumber: number;
  tick: number;
  type: EventType;
  playerSteamId: string;
  playerName: string;
  team: Team;
  weapon?: string | null;
  posX: number | null;
  posY: number | null;
  posZ: number | null;
  targetX?: number | null; // throw origin / aim for utility; killer→victim for kills
  targetY?: number | null;
  // overloaded: util_damage=damage, flash_blind=blind centiseconds, purchase=cost
  cost?: number | null;
}

export interface NormPosition {
  roundNumber: number;
  tick: number;
  playerSteamId: string;
  playerName: string;
  team: Team;
  posX: number | null;
  posY: number | null;
  posZ: number | null;
  viewAngle: number | null;
}

export interface NormMatchMeta {
  clientMatchId: string;
  filename: string;
  mapName: string;
  date: string;
  durationSeconds: number;
}

export interface NormalizedDemo {
  schemaVersion: 1;
  demoType: DemoType;
  tickRate: number;
  halfLength: number;
  overtimeMaxRounds: number;
  demoHash?: string;
  match: NormMatchMeta;
  players: NormPlayer[];
  rounds: NormRound[];
  events: NormEvent[];
  positions: NormPosition[];
}

// Library bookkeeping wrapper (stored in IndexedDB for the client path).
export interface StoredDemo {
  id: string;
  name: string;
  savedAt: number;
  source: "browser-wasm" | "server";
  demo: NormalizedDemo;
}
