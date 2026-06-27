// Per-player ACCOUNT scores for a demo player, from their public profile data
// (Steam / FACEIT / Leetify, looked up by steamId). These complement the in-
// match CheatMeter: Smurf (low investment + high skill), Boosted (high rank +
// weak mechanics), and a rolled-up Trust score. All heuristics on public stats,
// never proof — and degrade gracefully when a profile is private/missing.

import type { FaceitProfile, LeetifyProfile, SteamExtras, SteamGameStats } from "@/lib/types";
import { computeSuspicion, band5, BAND_HEX, BAND_LABEL, type Band, type Suspicion } from "@/lib/suspicion";

export { BAND_HEX, BAND_LABEL };
export type { Band };

const clamp = (n: number, a = 0, b = 100) => Math.max(a, Math.min(b, n));
const up = (v: number, lo: number, hi: number) => clamp(((v - lo) / (hi - lo)) * 100);
const down = (v: number, benign: number, sus: number) => clamp(((benign - v) / (benign - sus)) * 100);

export interface SubScore {
  score: number;
  band: Band;
  reasons: string[];
}

export interface AccountScores {
  cheat: Suspicion | null;
  smurf: SubScore | null;
  boosted: SubScore | null;
  trust: number | null;
  hasData: boolean;
}

export function accountScores(
  faceit: FaceitProfile | null,
  extras: SteamExtras | null,
  steamStats: SteamGameStats | null,
  leetify: LeetifyProfile | null,
): AccountScores {
  const cheat = computeSuspicion(leetify, faceit, steamStats);

  const hours = steamStats?.stats?.["total_time_played"]
    ? steamStats.stats["total_time_played"] / 3600
    : null;
  const level = extras?.steamLevel ?? null;
  const friends = extras?.friends ?? null;
  const kd = faceit?.kdRatio ?? null;
  const elo = faceit?.elo ?? null;
  const fMatches = faceit?.matches ?? null;
  const winrate = faceit?.winRatePct ?? null;

  // --- SMURF: low investment / new account paired with high skill ---
  let smurf: SubScore | null = null;
  {
    const reasons: string[] = [];
    const exp: number[] = [];
    if (hours != null) {
      const v = down(hours, 1500, 150);
      exp.push(v);
      if (v > 55) reasons.push(`only ${hours.toFixed(0)}h played`);
    }
    if (level != null && level > 0) {
      const v = down(level, 25, 2);
      exp.push(v);
      if (v > 55) reasons.push(`Steam level ${level}`);
    }
    if (friends != null) {
      const v = down(friends, 30, 2) * 0.7;
      exp.push(v);
      if (v > 45) reasons.push(`${friends} friends`);
    }
    const skill: number[] = [];
    if (kd != null) {
      const v = up(kd, 1.05, 1.6);
      skill.push(v);
      if (v > 50) reasons.push(`${kd.toFixed(2)} FACEIT K/D`);
    }
    if (elo != null && fMatches != null && fMatches < 200) {
      const v = up(elo, 1500, 2600);
      skill.push(v);
      if (v > 50) reasons.push(`${elo} ELO in only ${fMatches} matches`);
    }
    if (leetify?.rating?.aim) skill.push(up(leetify.rating.aim, 75, 95) * 0.85);
    if (exp.length && skill.length) {
      const e = exp.reduce((a, b) => a + b, 0) / exp.length;
      const s = Math.max(...skill);
      const score = clamp(Math.sqrt(e * s)); // both must be high
      smurf = { score, band: band5(score), reasons: reasons.slice(0, 3) };
    }
  }

  // --- BOOSTED: high rank with weak mechanics (or carried: low K/D, high wins) ---
  let boosted: SubScore | null = null;
  if (elo != null && kd != null) {
    const rank = up(elo, 1700, 3000);
    const weak = down(kd, 1.1, 0.75);
    let score = Math.sqrt(rank * weak); // both must be high
    const reasons: string[] = [];
    if (rank > 40 && weak > 40) reasons.push(`${elo} ELO but ${kd.toFixed(2)} K/D`);
    if (winrate != null && winrate >= 58 && kd < 1.0) {
      score = Math.max(score, (up(winrate, 55, 70) + weak) / 2);
      reasons.push(`${winrate.toFixed(0)}% wins while bottom-fragging`);
    }
    score = clamp(score);
    boosted = { score, band: band5(score), reasons: reasons.slice(0, 3) };
  }

  // --- TRUST: inverse of the worst flag (a "looks legit" read) ---
  const banned = (leetify?.bans?.length ?? 0) > 0;
  const worst = Math.max(cheat?.score ?? 0, smurf?.score ?? 0, boosted?.score ?? 0);
  const trust = faceit || leetify || steamStats ? clamp(100 - worst - (banned ? 40 : 0)) : null;

  return { cheat, smurf, boosted, trust, hasData: !!(faceit || leetify || steamStats || extras) };
}
