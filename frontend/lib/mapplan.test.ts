import { describe, it, expect } from "vitest";
import { computeMapPlan } from "@/lib/mapplan";
import type { LeetifyRecentMatch } from "@/lib/types";

// Pins the counter-report map plan: sample-aware pick/ban order + most-played
// "main" detection. The lead scenario is the real screenshot that motivated the
// audit (Dust2 is the main; small-sample 88% maps must not look more certain
// than a proven 29-16).

function games(map: string, w: number, l: number): LeetifyRecentMatch[] {
  const mk = (outcome: string): LeetifyRecentMatch => ({
    id: `${map}-${outcome}`,
    finished_at: "2026-01-01T00:00:00Z",
    data_source: "matchmaking",
    outcome,
    map_name: map,
    leetify_rating: 1,
    score: [13, 7],
    preaim: 8,
    reaction_time_ms: 600,
    accuracy_head: 25,
    accuracy_enemy_spotted: 30,
    spray_accuracy: 20,
  });
  return [
    ...Array.from({ length: w }, () => mk("win")),
    ...Array.from({ length: l }, () => mk("loss")),
  ];
}

describe("computeMapPlan", () => {
  // The screenshot: Nuke 6-5, Dust2 29-16, Ancient 4-2, Mirage 7-1, Anubis 6-1,
  // Inferno 6-1.
  const screenshot = [
    ...games("de_nuke", 6, 5),
    ...games("de_dust2", 29, 16),
    ...games("de_ancient", 4, 2),
    ...games("de_mirage", 7, 1),
    ...games("de_anubis", 6, 1),
    ...games("de_inferno", 6, 1),
  ];

  it("flags the clearly most-played map as the main", () => {
    const p = computeMapPlan(screenshot);
    expect(p.main?.map).toBe("de_dust2");
    expect(p.hasMain).toBe(true);
    expect(p.main?.n).toBe(45);
  });

  it("the main reads as strong (winning record), not a soft pick target", () => {
    const p = computeMapPlan(screenshot);
    expect(p.mainStrong).toBe(true);
  });

  it("bans the strongest map, sample-adjusted (lucky 7-1 still tops, but pulled down)", () => {
    const p = computeMapPlan(screenshot);
    expect(p.ban[0].map).toBe("de_mirage");
    // 88% raw shrinks well below 88 on 8 games
    expect(p.ban[0].adj).toBeLessThan(80);
    expect(p.ban[0].pct).toBeCloseTo(87.5, 1);
  });

  it("picks the genuinely weakest map (Nuke), adjusted", () => {
    const p = computeMapPlan(screenshot);
    expect(p.pick[0].map).toBe("de_nuke");
  });

  it("reports no soft map when every option is a winning record", () => {
    const p = computeMapPlan(screenshot);
    expect(p.hasSoftMap).toBe(false);
  });

  it("small samples cannot outrank a proven record in the ban list", () => {
    // 7-1 (8 games) vs a proven 40-10 (80%, 50 games): the proven one should win.
    const p = computeMapPlan([
      ...games("de_mirage", 7, 1), // 87.5% raw, tiny sample
      ...games("de_dust2", 40, 10), // 80% raw, big sample
      ...games("de_nuke", 5, 5),
    ]);
    expect(p.ban[0].map).toBe("de_dust2");
  });

  it("detects a genuinely soft (losing) map", () => {
    const p = computeMapPlan([
      ...games("de_vertigo", 2, 8), // 20%
      ...games("de_dust2", 10, 5),
      ...games("de_mirage", 8, 4),
    ]);
    expect(p.hasSoftMap).toBe(true);
    expect(p.pick[0].map).toBe("de_vertigo");
  });

  it("does not invent a main from an even spread", () => {
    const p = computeMapPlan([
      ...games("de_dust2", 5, 4),
      ...games("de_mirage", 5, 4),
      ...games("de_nuke", 5, 4),
    ]);
    expect(p.hasMain).toBe(false);
  });

  it("excludes maps below the minimum game count from pick/ban", () => {
    const p = computeMapPlan([
      ...games("de_dust2", 10, 5),
      ...games("de_mirage", 8, 4),
      ...games("de_train", 1, 1), // 2 games — below min
    ]);
    expect(p.pick.some((m) => m.map === "de_train")).toBe(false);
    expect(p.ban.some((m) => m.map === "de_train")).toBe(false);
  });
});
