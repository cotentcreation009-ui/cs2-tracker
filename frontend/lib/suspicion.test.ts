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

  it("near-max aim + fast reaction (normal K/D/HS) → High, not Moderate", () => {
    // "Kiwi"-type: aim 99.4 (beyond pro) + 436ms reaction, but normal K/D/HS.
    // Two genuinely-extreme aim tells should tip into High; normal output stats
    // keep it out of Very High.
    const sus = computeSuspicion(
      mkLeetify({ reaction: 436, preaim: 7.8, aim: 99.4, head: 27 }),
      mkFaceit({ kd: 1.09, hs: 27 }),
      null,
    );
    expect(sus!.gap).toBeNull(); // no FACEIT cross-check in recent matches
    expect(sus!.score).toBeGreaterThanOrEqual(60); // High, not Moderate
    expect(sus!.score).toBeLessThan(80); // not Very High (K/D + HS are normal)
    expect(sus!.band).toBe("high");
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

  it("redacted friends-only profile still runs the meter (aim + Leetify K/D), capped + low-confidence", () => {
    // Leetify redacts reaction/preaim/HS (→ 0) on friends-only profiles; only the
    // aim rating + K/D survive. The meter should RUN (2 signals) but never assert
    // High without the mechanical tells to back it.
    const sus = computeSuspicion(
      { ...mkLeetify({ reaction: 0, preaim: 0, aim: 89, head: 0 }), kd: 1.33 },
      null,
      null,
    );
    expect(sus).not.toBeNull();
    expect(sus!.hasEnough).toBe(true); // now shows on a private profile
    expect(sus!.lowConfidence).toBe(true);
    expect(sus!.score).toBeLessThanOrEqual(50);
    expect(sus!.band === "high" || sus!.band === "veryhigh").toBe(false);
  });

  it("redacted profile with very high aim is still capped at Moderate (no mechanical tells)", () => {
    const sus = computeSuspicion(
      { ...mkLeetify({ reaction: 0, preaim: 0, aim: 99, head: 0 }), kd: 1.6 },
      null,
      null,
    );
    expect(sus!.hasEnough).toBe(true);
    expect(sus!.score).toBeLessThanOrEqual(50); // can't false-flag High without reaction/preaim
    expect(sus!.band === "high" || sus!.band === "veryhigh").toBe(false);
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

// Top-percentile anchors the meter is tuned to (per-signal sub-scores hit 100 at
// or above these values): aim 95, reaction 430ms, K/D 1.8, Leetify rating 3.0.
// These pin the ramp endpoints so a later edit can't silently loosen them.
describe("top-percentile anchor calibration", () => {
  const sub = (s: ReturnType<typeof computeSuspicion>, key: string): number =>
    s?.factors.find((f) => f.key === key)?.score ?? -1;

  it("aim rating 95 tops out (100); 90 sits mid", () => {
    expect(sub(computeSuspicion(mkLeetify({ aim: 95 }), null, null), "aim")).toBe(100);
    expect(sub(computeSuspicion(mkLeetify({ aim: 90 }), null, null), "aim")).toBeCloseTo(50, 0);
    expect(sub(computeSuspicion(mkLeetify({ aim: 96 }), null, null), "aim")).toBe(100);
  });

  it("430ms reaction tops out (100); a slow 560ms is 0", () => {
    expect(sub(computeSuspicion(mkLeetify({ reaction: 430 }), null, null), "reaction")).toBe(100);
    expect(sub(computeSuspicion(mkLeetify({ reaction: 560 }), null, null), "reaction")).toBe(0);
  });

  it("K/D 1.5 lands in High (60–80); 1.8 tops out", () => {
    const at15 = sub(computeSuspicion(null, mkFaceit({ kd: 1.5 }), null), "kd");
    expect(at15).toBeGreaterThanOrEqual(60);
    expect(at15).toBeLessThan(80);
    expect(sub(computeSuspicion(null, mkFaceit({ kd: 1.8 }), null), "kd")).toBe(100);
  });

  it("Leetify overall rating 3.0 tops out; 1.5 is 0", () => {
    const base = mkLeetify({ aim: 80 });
    const at3 = computeSuspicion({ ...base, ranks: { ...base.ranks, leetify: 3 } }, null, null);
    const at15 = computeSuspicion({ ...base, ranks: { ...base.ranks, leetify: 1.5 } }, null, null);
    expect(sub(at3, "leetify")).toBe(100);
    expect(sub(at15, "leetify")).toBe(0);
  });
});
