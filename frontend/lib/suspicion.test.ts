import { describe, it, expect } from "vitest";
import { computeSuspicion } from "@/lib/suspicion";
import type { FaceitProfile, LeetifyProfile, LeetifyRecentMatch, SteamExtras } from "@/lib/types";

// Calibration regression tests for the CheatMeter (computeSuspicion). These pin
// the audit's probe outcomes so future threshold/weight changes can't silently
// re-introduce the false-positive (legit pro → High) or false-negative
// (consistent cheater exonerated) regressions.

function mkMatch(over: Partial<LeetifyRecentMatch> = {}): LeetifyRecentMatch {
  return {
    id: "m",
    finished_at: "2026-01-01T00:00:00Z",
    data_source: "matchmaking",
    outcome: "win",
    map_name: "de_dust2",
    leetify_rating: 1.0,
    score: [13, 5],
    preaim: 8,
    reaction_time_ms: 600,
    accuracy_head: 25,
    accuracy_enemy_spotted: 30,
    spray_accuracy: 20,
    ...over,
  };
}

function mkLeetify(o: {
  reaction?: number;
  preaim?: number;
  aim?: number;
  head?: number;
  bans?: unknown[];
  recent?: LeetifyRecentMatch[];
} = {}): LeetifyProfile {
  return {
    name: "p",
    steam64_id: "1",
    total_matches: 500,
    winrate: 0.5,
    privacy_mode: "public",
    bans: o.bans ?? [],
    rating: { aim: o.aim ?? 70, positioning: 60, utility: 60, clutch: 60, opening: 60, ct_leetify: 1, t_leetify: 1 },
    stats: {
      accuracy_head: o.head ?? 25,
      accuracy_enemy_spotted: 30,
      preaim: o.preaim ?? 12,
      reaction_time_ms: o.reaction ?? 650,
      spray_accuracy: 20,
      counter_strafing_good_shots_ratio: 0.5,
      ct_opening_duel_success_percentage: 50,
      t_opening_duel_success_percentage: 50,
      trade_kills_success_percentage: 20,
      traded_deaths_success_percentage: 20,
      trade_kill_opportunities_per_round: 0.3,
      flashbang_hit_foe_per_flashbang: 0.5,
      flashbang_leading_to_kill: 0.2,
      he_foes_damage_avg: 5,
      utility_on_death_avg: 100,
    },
    ranks: { leetify: 1, premier: 15000 },
    recent_matches: o.recent ?? Array.from({ length: 20 }, () => mkMatch()),
  };
}

function mkFaceit(o: { kd?: number; hs?: number } = {}): FaceitProfile {
  return {
    playerId: "f",
    nickname: "n",
    country: "us",
    avatar: "",
    faceitUrl: "",
    region: "EU",
    skillLevel: 10,
    elo: 2500,
    matches: 1000,
    winRatePct: 55,
    kdRatio: o.kd ?? 1.0,
    hsPct: o.hs ?? 45,
    avgKills: 18,
    currentWinStreak: 1,
    longestWinStreak: 5,
    recentResults: ["1", "0", "1"],
  };
}

describe("CheatMeter calibration probes", () => {
  it("typical legit → Very Low", () => {
    const sus = computeSuspicion(mkLeetify({ reaction: 650, preaim: 12, aim: 70, head: 25 }), null, null);
    expect(sus).not.toBeNull();
    expect(sus!.score).toBeLessThan(20);
    expect(sus!.band).toBe("verylow");
  });

  it("strong/pro-level legit (no gap) never reads High", () => {
    const sus = computeSuspicion(mkLeetify({ reaction: 480, preaim: 6.5, aim: 92, head: 35 }), null, null);
    expect(sus!.score).toBeLessThan(60); // must NOT reach High on a public page
    expect(sus!.band === "high" || sus!.band === "veryhigh").toBe(false);
  });

  it("blatant aimbot (no gap) → Very High", () => {
    const sus = computeSuspicion(mkLeetify({ reaction: 380, preaim: 2, aim: 99, head: 80 }), null, null);
    expect(sus!.score).toBeGreaterThanOrEqual(80);
    expect(sus!.band).toBe("veryhigh");
  });

  it("consistent cheater (gap≈0) is NOT exonerated", () => {
    const recent = [
      ...Array.from({ length: 10 }, () => mkMatch({ data_source: "matchmaking", leetify_rating: 1.0 })),
      ...Array.from({ length: 10 }, () => mkMatch({ data_source: "faceit", leetify_rating: 1.0 })),
    ];
    const sus = computeSuspicion(mkLeetify({ reaction: 380, preaim: 2, aim: 99, head: 80, recent }), null, null);
    expect(sus!.gap).not.toBeNull();
    expect(Math.abs(sus!.gap!)).toBeLessThan(0.1); // genuinely consistent
    expect(sus!.score).toBeGreaterThanOrEqual(80); // stays Very High despite consistency
  });

  it("skill-only (no Leetify mechanical tells) is capped at Moderate", () => {
    const sus = computeSuspicion(null, mkFaceit({ kd: 2.0, hs: 75 }), null);
    expect(sus!.score).toBeLessThanOrEqual(40);
    expect(sus!.band === "high" || sus!.band === "veryhigh").toBe(false);
  });

  it("low-confidence read is flagged", () => {
    const sus = computeSuspicion(null, mkFaceit({ kd: 1.6, hs: 60 }), null);
    expect(sus!.lowConfidence).toBe(true);
  });

  it("fresh VAC ban floors to Very High", () => {
    const extras: SteamExtras = {
      steamId64: "1",
      friendCode: "",
      friends: 0,
      steamLevel: 0,
      vacBanned: true,
      numberOfVacBans: 1,
      daysSinceLastBan: 60,
    };
    const sus = computeSuspicion(mkLeetify({ reaction: 650, preaim: 12, aim: 70 }), null, null, extras);
    expect(sus!.score).toBeGreaterThanOrEqual(80);
  });

  it("old game ban floors only to Moderate, not Very High", () => {
    const extras: SteamExtras = {
      steamId64: "1",
      friendCode: "",
      friends: 0,
      steamLevel: 0,
      numberOfGameBans: 1,
      daysSinceLastBan: 1200,
    };
    const sus = computeSuspicion(mkLeetify({ reaction: 650, preaim: 12, aim: 70 }), null, null, extras);
    expect(sus!.score).toBeGreaterThanOrEqual(50);
    expect(sus!.score).toBeLessThan(60); // High floor, not Very High
  });
});
