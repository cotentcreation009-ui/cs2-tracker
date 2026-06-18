// TypeScript mirrors of the backend JSON payloads. SteamID64s are serialised as
// strings by the API to avoid JavaScript number precision loss.

export type Side = "CT" | "T" | "";

export interface Player {
  steamId64: string;
  personaName: string;
  avatarUrl: string;
  profileUrl: string;
  vanityUrl?: string;
  countryCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlayerCareer {
  steamId64: string;
  matches: number;
  wins: number;
  losses: number;
  roundsPlayed: number;
  kills: number;
  deaths: number;
  assists: number;
  headshotKills: number;
  damage: number;
  kastRounds: number;
  openingKills: number;
  openingDeaths: number;
  clutchesWon: number;
  clutchesLost: number;
  k1: number;
  k2: number;
  k3: number;
  k4: number;
  k5: number;
  kd: number;
  adr: number;
  kastPct: number;
  hsPct: number;
  rating: number;
  winRate: number;
  updatedAt: string;
}

export interface PlayerProfile {
  player: Player;
  career: PlayerCareer;
}

export interface Match {
  id: number;
  shareCode?: string;
  demoSource: string;
  map: string;
  gameMode?: string;
  playedAt: string;
  durationSeconds: number;
  roundsTotal: number;
  teamAScore: number;
  teamBScore: number;
  tickRate: number;
  parsedAt: string;
  createdAt: string;
}

export interface MatchPlayer {
  matchId: number;
  steamId64: string;
  personaName: string;
  startSide: Side;
  roundsPlayed: number;
  kills: number;
  deaths: number;
  assists: number;
  headshotKills: number;
  damage: number;
  utilityDamage: number;
  enemiesFlashed: number;
  kastRounds: number;
  openingKills: number;
  openingDeaths: number;
  clutchesWon: number;
  clutchesLost: number;
  mvps: number;
  k1: number;
  k2: number;
  k3: number;
  k4: number;
  k5: number;
  adr: number;
  kastPct: number;
  hsPct: number;
  kd: number;
  kpr: number;
  dpr: number;
  rating: number;
  won: boolean;
}

export interface PlayerMatchSummary {
  match: Match;
  line: MatchPlayer;
}

export interface Round {
  matchId: number;
  number: number;
  winnerSide: Side;
  endReason: string;
}

export interface MatchDetail {
  match: Match;
  players: MatchPlayer[];
  rounds: Round[];
}

export interface WeaponStat {
  weapon: string;
  kills: number;
  headshots: number;
  hsPct: number;
}

export interface MapStat {
  map: string;
  matches: number;
  wins: number;
  losses: number;
  winRate: number;
  roundsPlayed: number;
  rating: number;
  adr: number;
  kd: number;
  hsPct: number;
}

export interface Kill {
  matchId: number;
  round: number;
  timeSeconds: number;
  killerId: string;
  victimId: string;
  assisterId?: string;
  weapon: string;
  headshot: boolean;
  opening: boolean;
  trade: boolean;
}
