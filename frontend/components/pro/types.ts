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

export interface ProHistory {
  enabled?: boolean;
  teams?: ProTeam[];
  form?: Record<string, ProFormEntry[]>; // by gridId
  h2h?: ProH2HEntry[];
  rosters?: Record<string, ProRosterPlayer[]>; // by gridId
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
