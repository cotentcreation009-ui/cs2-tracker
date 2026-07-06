import { describe, it, expect } from "vitest";
import { computePlatformSplit } from "@/lib/platformSplit";
import type { LeetifyRecentMatch } from "@/lib/types";

// Pins the Premier-vs-FACEIT split: Premier = rank_type 11 (NOT data_source, and
// NOT Competitive/rank_type 12), FACEIT = data_source "faceit", the game-count
// limit, and the gap verdict.

function mk(over: Partial<LeetifyRecentMatch>): LeetifyRecentMatch {
  return {
    id: "m",
    finished_at: "2026-01-01T00:00:00Z",
    data_source: "matchmaking",
    outcome: "win",
    map_name: "de_dust2",
    leetify_rating: 1.0,
    score: [13, 7],
    rank_type: 11,
    preaim: 8,
    reaction_time_ms: 600,
    accuracy_head: 25,
    accuracy_enemy_spotted: 30,
    spray_accuracy: 20,
    ...over,
  };
}

// Premier: matchmaking data_source + rank_type 11.
const premier = (over: Partial<LeetifyRecentMatch> = {}) =>
  mk({ data_source: "matchmaking", rank_type: 11, ...over });
// FACEIT: data_source faceit.
const faceit = (over: Partial<LeetifyRecentMatch> = {}) =>
  mk({ data_source: "faceit", rank_type: 0, ...over });
// Competitive (rank_type 12) — must be excluded entirely.
const comp = (over: Partial<LeetifyRecentMatch> = {}) =>
  mk({ data_source: "matchmaking", rank_type: 12, ...over });

const many = (n: number, f: () => LeetifyRecentMatch) =>
  Array.from({ length: n }, f);

describe("computePlatformSplit (Premier vs FACEIT)", () => {
  it("buckets Premier by rank_type 11 and FACEIT by data_source, ignoring Competitive", () => {
    const matches = [
      ...many(5, () => premier({ leetify_rating: 1.2 })),
      ...many(4, () => faceit({ leetify_rating: 0.4, outcome: "loss" })),
      ...many(6, () => comp({ leetify_rating: 0.9 })), // must NOT count
    ];
    const p = computePlatformSplit(matches);
    expect(p.premierTotal).toBe(5); // comp excluded
    expect(p.faceitTotal).toBe(4);
    expect(p.premier?.n).toBe(5);
    expect(p.premier?.avgRating).toBeCloseTo(1.2, 5);
    expect(p.faceit?.n).toBe(4);
    expect(p.faceit?.winPct).toBe(0);
  });

  it("flags a suspicious Premier>FACEIT gap", () => {
    const matches = [
      ...many(6, () => premier({ leetify_rating: 1.4 })),
      ...many(6, () => faceit({ leetify_rating: 0.5 })),
    ];
    const p = computePlatformSplit(matches);
    expect(p.comparable).toBe(true);
    expect(p.ratingGap!).toBeCloseTo(0.9, 5);
    expect(p.verdict).toBe("stronger-premier");
  });

  it("detects stronger-on-FACEIT and consistent", () => {
    expect(
      computePlatformSplit([
        ...many(6, () => premier({ leetify_rating: 0.4 })),
        ...many(6, () => faceit({ leetify_rating: 1.1 })),
      ]).verdict,
    ).toBe("stronger-faceit");
    expect(
      computePlatformSplit([
        ...many(6, () => premier({ leetify_rating: 1.0 })),
        ...many(6, () => faceit({ leetify_rating: 0.95 })),
      ]).verdict,
    ).toBe("consistent");
  });

  it("still surfaces FACEIT even when it's buried deep in a Premier-heavy history", () => {
    const matches = [
      ...many(80, () => premier({ leetify_rating: 1.0 })),
      ...many(5, () => faceit({ leetify_rating: 0.9 })), // old, but present
    ];
    const p = computePlatformSplit(matches);
    expect(p.faceitTotal).toBe(5);
    expect(p.faceit?.n).toBe(5); // shown regardless of recency
    expect(p.comparable).toBe(true);
  });

  it("limit caps how many recent games per platform are aggregated", () => {
    const matches = [
      ...many(3, () => premier({ leetify_rating: 2.0 })), // newest
      ...many(50, () => premier({ leetify_rating: 0.0 })), // older
      ...many(20, () => faceit({ leetify_rating: 1.0 })),
    ];
    const p10 = computePlatformSplit(matches, undefined, 10);
    expect(p10.premier?.n).toBe(10); // last 10 Premier only
    expect(p10.faceit?.n).toBe(10);
    expect(p10.premierTotal).toBe(53); // totals are the full pool
    const pAll = computePlatformSplit(matches);
    expect(pAll.premier?.n).toBe(53);
  });

  it("uses the dedicated FACEIT list so games outside the recent window still count", () => {
    // recent window (matches) has only Premier; the FACEIT games arrive via the
    // separate full list — exactly the 'old FACEIT games' case.
    const premierOnly = many(80, () => premier({ leetify_rating: 1.0 }));
    const faceitList = many(6, () => faceit({ leetify_rating: 0.5 }));
    const p = computePlatformSplit(premierOnly, faceitList);
    expect(p.faceitTotal).toBe(6);
    expect(p.faceit?.n).toBe(6);
    expect(p.comparable).toBe(true);
    expect(p.verdict).toBe("stronger-premier");
  });

  it("no FACEIT at all → faceit null, premier still present", () => {
    const p = computePlatformSplit(many(20, () => premier({})));
    expect(p.faceit).toBeNull();
    expect(p.faceitTotal).toBe(0);
    expect(p.premier?.n).toBe(20);
    expect(p.comparable).toBe(false);
    expect(p.verdict).toBe("insufficient");
  });

  it("uses the dedicated PREMIER list so a FACEIT-heavy window still gets full Premier (Kiwi bug)", () => {
    // recent window: 97 FACEIT + 3 Premier (v3's 100-cap cut the older Premier
    // games off); the dedicated premier list carries the full 40.
    const window = [
      ...many(3, () => premier({ leetify_rating: 0.2 })),
      ...many(97, () => faceit({ leetify_rating: 0.0 })),
    ];
    const premierList = many(40, () => premier({ leetify_rating: 0.2 }));
    const p = computePlatformSplit(window, undefined, Infinity, premierList);
    expect(p.premierTotal).toBe(40); // not 3
    expect(p.premier?.n).toBe(40);
    expect(p.comparable).toBe(true);
  });
});
