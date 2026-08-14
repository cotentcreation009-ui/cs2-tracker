// Shape of the /api/pro-matches contract (camelCase JSON served by the Go
// backend, sourced from the GRID API). Everything past the identity fields is
// optional/tolerant: upcoming matches carry only teams + tournament + start +
// format, and the backend may omit fields the GRID feed didn't populate.

export type ProStatus = "upcoming" | "live" | "finished";

export interface ProTeam {
  gridId: string;
  name: string;
  shortName?: string;
  logoUrl?: string;
  colorPrimary?: string;
  colorSecondary?: string;
}

export interface ProRound {
  number: number;
  winnerTeam?: string;
  winnerSide?: string; // "CT" | "T"
  finished?: boolean;
}

export interface ProMap {
  sequence: number;
  mapName?: string;
  started?: boolean;
  finished?: boolean;
  scoreByTeam?: Record<string, number>; // rounds won on this map, by gridId
  sideByTeam?: Record<string, string>; // "CT" | "T", by gridId
  currentRound?: number;
  clockSeconds?: number;
  rounds?: ProRound[];
  winnerTeam?: string;
  teams?: ProMapTeam[]; // per-team scoreboard for this map (from Series State)
}

// One team's line on a map: side, round score, and its players' scoreboard.
export interface ProMapTeam {
  gridId: string;
  side?: string; // "CT" | "T"
  score: number;
  won?: boolean;
  money?: number; // liquid cash — the buy-state signal
  netWorth?: number;
  players?: ProMapPlayer[];
}

export interface ProMapPlayer {
  name: string;
  kills: number;
  assists: number;
  deaths: number;
  netWorth?: number;
}

// Recent-form + head-to-head (lazy /history endpoint).
export interface ProFormEntry {
  seriesId: string;
  date: string;
  won: boolean;
  score: [number, number]; // [team, opponent]
  opponentId: string;
  opponentName: string;
  opponentLogo?: string;
}

export interface ProH2HEntry {
  seriesId: string;
  date: string;
  winnerId?: string;
  scoreByTeam: Record<string, number>;
}

// One roster player row. src "grid" = official GRID Statistics-Feed
// aggregates over the window; src "agg" = fallback computed from the team's
// recent tracked series; "" = no data (new signing/sub).
export interface ProRosterPlayer {
  id?: string; // GRID player id (roster players only) — enables the drill-down
  nick: string;
  inRoster: boolean;
  src: "grid" | "agg" | "";
  series: number;
  maps: number;
  kills: number;
  deaths: number;
  assists?: number;
  kd: number;
  avgKills: number;
  kpr?: number;
  fkPct: number;
  winPct: number;
}

// One explainable prediction input: both teams' values and the signed pull it
// adds toward teams[0] (positive = favors the first team).
export interface ProPredFactor {
  key: "form" | "h2h" | "margin" | "lineup" | "mappool" | string;
  label: string;
  a: number;
  b: number;
  contribution: number;
  pp: number; // percentage-point swing in context (+ = toward teams[0])
  note?: string;
}

// Per-team window summary behind the factor rows (raw W-L, current streak).
export interface ProPredTeamStats {
  wins: number;
  losses: number;
  streak: number;
  streakWon: boolean;
}

// Pre-match win estimate — a transparent heuristic over the SAME evidence the
// history panel shows (form, head-to-head, margins, lineup K/D). Refuses to
// produce a number on thin data (available=false + reason).
export interface ProPrediction {
  available: boolean;
  reason?: string;
  pA: number; // P(teams[0] wins the series)
  factors?: ProPredFactor[];
  seriesN: [number, number];
  model: string;
}

// One map's W-L record for a team over the tracked window.
export interface ProMapRecord {
  map: string; // normalized: "mirage", "inferno", …
  w: number;
  l: number;
}

export interface ProHistory {
  enabled?: boolean;
  teams?: ProTeam[];
  form?: Record<string, ProFormEntry[]>; // by gridId
  h2h?: ProH2HEntry[];
  rosters?: Record<string, ProRosterPlayer[]>; // by gridId
  maps?: Record<string, ProMapRecord[]>; // by gridId — the map-pool receipts
  prediction?: ProPrediction;
  predStats?: Record<string, ProPredTeamStats>; // by gridId
  // the model's own resolved track record (append-once pre-match calls,
  // reconciled after series finish) — the system grading itself in public
  record?: { model: string; n: number; correct: number } | null;
}

// The pro-team page (/pro-matches/team/[id]).
export interface ProTeamResult {
  seriesId: string;
  date: string;
  won: boolean;
  score: [number, number]; // [team, opponent]
  opponent: ProTeam;
  tournament?: string;
  format?: string; // "Bo1" | "Bo3" | ...
}

export type ProTeamPlayer = ProRosterPlayer;

export interface ProTeamPage {
  enabled?: boolean;
  team?: ProTeam;
  record?: { wins: number; losses: number; streak: number; streakWon: boolean };
  players?: ProTeamPlayer[];
  results?: ProTeamResult[];
  nextMatch?: ProNextMatch | null;
  /** Valve Regional Standings — absent for an org that isn't ranked. */
  vrs?: ProVrsStanding | null;
}

/**
 * A team's place in Counter-Strike's official ranking. `of` is how many teams
 * the published table covers, so a standing can be shown as "#34 of 214"
 * rather than a bare number that reads as "out of twenty".
 */
export interface ProVrsStanding {
  standing: number;
  points: number;
  asOf?: string;
  of?: number;
}

// The team's live or next scheduled series, trimmed from the board state.
export interface ProNextMatch {
  seriesId: string;
  status: "live" | "upcoming";
  startScheduled?: string;
  tournamentName?: string;
  tournamentLogoUrl?: string;
  formatShort?: string;
  bestOf?: number;
  teams?: ProTeam[];
  seriesScore?: Record<string, number>;
  streamUrl?: string;
}

// Per-window official aggregates for one player (the click-a-player drawer).
export interface ProPlayerWindowStats {
  seriesCount: number;
  seriesWinPct: number;
  maps: number;
  mapWinPct: number;
  kills: number;
  deaths: number;
  assists: number;
  avgKills: number;
  maxKills: number;
  kd: number;
  firstKillPct: number;
  rounds: number;
  roundWinPct: number;
  kpr: number;
}

export interface ProPlayerWindow {
  window: string;
  label: string;
  stats: ProPlayerWindowStats | null;
}

export interface ProPlayerStatsResponse {
  enabled?: boolean;
  any?: boolean;
  windows?: ProPlayerWindow[];
}

export interface MatchState {
  seriesId: string;
  status: ProStatus;
  startScheduled?: string;
  formatName?: string;
  formatShort?: string;
  bestOf?: number;
  tournamentId?: string;
  tournamentName?: string;
  tournamentLogoUrl?: string;
  teams?: ProTeam[];
  seriesScore?: Record<string, number>; // maps won, by gridId
  seriesWinner?: string;
  maps?: ProMap[];
  currentMap?: number; // sequence of the live map
  valid?: boolean;
  liveUpdatedAt?: string;
  fetchedAt?: string;
  streamUrl?: string;
}

export interface ProMatchesResponse {
  enabled: boolean;
  matches: MatchState[];
  updatedAt?: string;
  error?: string;
}
