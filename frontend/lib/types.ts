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
  rank?: number; // FACEIT level / Premier rating / Competitive rank (per rank_type)
  rank_type?: number; // 11 = Premier (rank is the rating), 12 = Competitive
  kills?: number; // merged from Leetify's legacy endpoint (v3 lacks them)
  deaths?: number;
  elo?: number; // FACEIT elo recorded with the game
  // rank/elo is the value AFTER the game; rank_before is what the player
  // carried in. Both absent unless the preceding game in that queue was also
  // rated, so a change never spans games Leetify left unrated.
  rank_before?: number;
  rank_delta?: number | null; // Premier rating / FACEIT elo change caused by this game
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
  kd?: number; // legacy endpoint only (v3 doesn't expose it)
  avg_party_size?: number; // legacy endpoint only
  peak_premier?: number; // highest Premier rating across the match list
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
  faceit_matches?: LeetifyRecentMatch[]; // ALL FACEIT matches (not just the recent window)
  premier_matches?: LeetifyRecentMatch[]; // ALL Premier matches (rank_type 11) — same idea
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
  // Aggregate over the last 30 matches, from the Data API's NAMED per-match
  // fields. The lifetime block has no ADR, K/R or assists, and FACEIT's
  // frontend stat rows are positional and undocumented. Absent when the
  // per-match feed could not be read.
  recent?: FaceitRecentStats;
  // Set when the recent aggregate failed, as opposed to the player simply
  // having no readable history — the two must not be cached alike.
  recentUnavailable?: boolean;
}

// Field names are the Go struct's JSON TAGS, not its field names. They were
// capitalised here to match an untagged version of that struct; when the Go
// side gained tags every one of these became undefined, and because this type
// described the wrong usage rather than the wire format, tsc reported nothing
// while four columns silently went blank in production.
export interface FaceitRecentStats {
  matches: number; // the SAMPLE size, not their career match count
  kills: number; // per match
  deaths: number; // per match
  assists: number; // per match
  kd: number;
  kr: number; // kills per round
  adr: number;
  hsPct: number;
  winRatePct: number;
  rating: number; // HLTV Rating 1.0; 0 when FACEIT withheld the multi-kill columns
}

export interface SteamGameStats {
  gameName: string;
  stats: Record<string, number>; // raw App 730 stat names -> values
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
  personaState?: number; // -1 unknown, 0 offline, >0 online/away/busy/snooze
  visibility?: number; // 0 unknown, 1 private, 3 public
  vacBanned?: boolean;
  numberOfVacBans?: number;
  numberOfGameBans?: number;
  daysSinceLastBan?: number; // days since most recent VAC/game ban (0 if none)
  // Minutes of CS2 in the last two weeks. An activity HINT: zero also means
  // "hidden", so never present it as proof of inactivity.
  cs2MinutesTwoWeeks?: number;
  economyBan?: string; // "none" | "probation" | "banned"
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
