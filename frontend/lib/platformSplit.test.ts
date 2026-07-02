import { describe, it, expect } from "vitest";
import { computePlatformSplit } from "@/lib/platformSplit";
import type { LeetifyRecentMatch } from "@/lib/types";

// Pins the Premier-vs-FACEIT split: per-platform aggregation + the cross-
// platform rating gap/verdict (same definition as the CheatMeter).

function mk(over: Partial<LeetifyRecentMatch>): LeetifyRecentMatch {
  return {
    id: "m",
    finished_at: "2026-01-01T00:00:00Z",
    data_source: "premier",
    outcome: "win",
    map_name: "de_dust2",
    leetify_rating: 1.0,
    score: [13, 7],
    preaim: 8,
    reaction_time_ms: 600,
    accuracy_head: 25,
    accuracy_enemy_spotted: 30,
    spray_accuracy: 20,
    ...over,
  };
}

function many(n: number, over: Partial<LeetifyRecentMatch>): LeetifyRecentMatch[] {
  return Array.from({ length: n }, () => mk(over));
}

describe("computePlatformSplit", () => {
  it("splits matches by platform and averages each", () => {
    const recent = [
      ...many(5, { data_source: "premier", leetify_rating: 1.2, outcome: "win" }),
      ...many(4, { data_source: "faceit", leetify_rating: 0.4, outcome: "loss" }),
    ];
    const s = computePlatformSplit(recent);
    const prem = s.stats.find((p) => p.key === "premier")!;
    const face = s.stats.find((p) => p.key === "faceit")!;
    expect(prem.n).toBe(5);
    expect(prem.avgRating).toBeCloseTo(1.2, 5);
    expect(prem.winPct).toBe(100);
    expect(face.n).toBe(4);
    expect(face.winPct).toBe(0);
  });

  it("flags a suspicious Valve>FACEIT gap (insane on Valve, ordinary on FACEIT)", () => {
    const recent = [
      ...many(6, { data_source: "premier", leetify_rating: 1.4 }),
      ...many(6, { data_source: "faceit", leetify_rating: 0.5 }),
    ];
    const s = computePlatformSplit(recent);
    expect(s.comparable).toBe(true);
    expect(s.ratingGap!).toBeCloseTo(0.9, 5); // 1.4 − 0.5
    expect(s.verdict).toBe("stronger-valve");
  });

  it("marks a consistent player as consistent", () => {
    const recent = [
      ...many(6, { data_source: "premier", leetify_rating: 1.0 }),
      ...many(6, { data_source: "faceit", leetify_rating: 0.95 }),
    ];
    expect(computePlatformSplit(recent).verdict).toBe("consistent");
  });

  it("detects stronger-on-FACEIT (less suspicious direction)", () => {
    const recent = [
      ...many(6, { data_source: "premier", leetify_rating: 0.4 }),
      ...many(6, { data_source: "faceit", leetify_rating: 1.1 }),
    ];
    expect(computePlatformSplit(recent).verdict).toBe("stronger-faceit");
  });

  it("combines MM + Premier into the Valve 'official' side of the gap", () => {
    const recent = [
      ...many(3, { data_source: "premier", leetify_rating: 1.2 }),
      ...many(3, { data_source: "matchmaking", leetify_rating: 1.2 }),
      ...many(6, { data_source: "faceit", leetify_rating: 0.4 }),
    ];
    const s = computePlatformSplit(recent);
    expect(s.official!.n).toBe(6); // 3 premier + 3 MM
    expect(s.official!.avgRating).toBeCloseTo(1.2, 5);
    expect(s.verdict).toBe("stronger-valve");
  });

  it("withholds the auto-verdict when one side lacks the minimum sample, but still shows both", () => {
    const recent = [
      ...many(10, { data_source: "premier", leetify_rating: 1.3 }),
      ...many(2, { data_source: "faceit", leetify_rating: 0.3 }), // < MIN_N
    ];
    const s = computePlatformSplit(recent);
    expect(s.comparable).toBe(false);
    expect(s.verdict).toBe("insufficient");
    // still shown (with any n>=1) so the user can compare the raw numbers
    expect(s.stats.find((p) => p.key === "faceit")?.n).toBe(2);
    expect(s.stats.find((p) => p.key === "premier")?.n).toBe(10);
  });

  it("ignores 0-sentinel aim values when averaging", () => {
    const recent = many(4, { data_source: "premier", preaim: 0, reaction_time_ms: 0 }).concat(
      many(2, { data_source: "premier", preaim: 6, reaction_time_ms: 500 }),
    );
    const s = computePlatformSplit(recent);
    const prem = s.stats.find((p) => p.key === "premier")!;
    expect(prem.avgPreaim).toBeCloseTo(6, 5); // only the 2 positive samples
    expect(prem.avgReaction).toBeCloseTo(500, 5);
  });
});
