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
  steamCreatedAt?: string; // Steam account creation time (public profiles only)
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
  utilityDamage: number;
  enemiesFlashed: number;
  mvps: number;
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
  ctBuy?: string;
  tBuy?: string;
  ctEquipValue: number;
  tEquipValue: number;
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

export interface LeetifyRecentMatch {
  id: string;
  finished_at: string;
  data_source: string; // matchmaking | premier | faceit | ...
  outcome: string; // win | loss | tie
  map_name: string;
  leetify_rating: number;
  score: number[]; // [team, enemy]
  preaim: number;
  reaction_time_ms: number;
  accuracy_head: number;
  accuracy_enemy_spotted: number;
  spray_accuracy: number;
}

export interface LeetifyProfile {
  name: string;
  steam64_id: string;
  total_matches: number;
  winrate: number; // 0..1
  privacy_mode: string;
  first_match_date?: string;
  bans?: unknown[];
  rating: {
    aim: number;
    positioning: number;
    utility: number;
    clutch: number;
    opening: number;
    ct_leetify: number;
    t_leetify: number;
  };
  stats: {
    accuracy_head: number;
    accuracy_enemy_spotted: number;
    preaim: number;
    reaction_time_ms: number;
    spray_accuracy: number;
    counter_strafing_good_shots_ratio: number;
    ct_opening_duel_success_percentage: number;
    t_opening_duel_success_percentage: number;
    trade_kills_success_percentage: number;
    traded_deaths_success_percentage: number;
    trade_kill_opportunities_per_round: number;
    flashbang_hit_foe_per_flashbang: number;
    flashbang_leading_to_kill: number;
    he_foes_damage_avg: number;
    utility_on_death_avg: number;
  };
  ranks: {
    leetify?: number;
    premier?: number;
    faceit?: number;
    faceit_elo?: number;
    wingman?: number;
  };
  recent_matches?: LeetifyRecentMatch[];
}

export interface FaceitProfile {
  playerId: string;
  nickname: string;
  country: string;
  avatar: string;
  faceitUrl: string;
  region: string;
  skillLevel: number;
  elo: number;
  matches: number;
  winRatePct: number;
  kdRatio: number;
  hsPct: number;
  avgKills: number;
  currentWinStreak: number;
  longestWinStreak: number;
  recentResults: string[]; // most-recent-first; "1" = win, "0" = loss
}

export interface PlayerHit {
  steamId64: string;
  personaName: string;
  avatarUrl: string;
}

export interface SteamExtras {
  steamId64: string;
  friendCode: string; // CS2 in-game friend code, e.g. "ADWZF-L9AL"
  friends: number; // 0 when the friends list is private / no key
  steamLevel: number; // 0 when hidden / no key
}

export interface IngestJob {
  id: string;
  type: string;
  status: "queued" | "running" | "done" | "failed" | string;
  source?: string;
  demoPath?: string;
  demoUrl?: string;
  shareCode?: string;
  matchId?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeaderboardEntry {
  steamId64: string;
  personaName: string;
  avatarUrl: string;
  matches: number;
  rating: number;
  kd: number;
  adr: number;
  winRate: number;
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
