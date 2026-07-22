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
