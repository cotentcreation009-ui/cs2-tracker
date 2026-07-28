import { describe, it, expect } from "vitest";
import { aimConsistency } from "./consistency";
import type { ReplayRound } from "./types";

// one round with one player's aim aggregates (sums, averaged by aimN)
function round(n: number, over: { rctMs?: number; aimN?: number; preaim?: number; shots?: number; hits?: number }): ReplayRound {
  return {
    n,
    winner: "CT",
    reason: "",
    ct: [0],
    t: [5],
    frames: [],
    kills: [],
    nades: [],
    bomb: [],
    stats: [{ i: 0, ...over }],
  } as unknown as ReplayRound;
}

describe("aimConsistency", () => {
  it("extracts per-round averages and gates accuracy on >=5 shots", () => {
    const rounds = [
      round(1, { rctMs: 600, aimN: 2, preaim: 8, shots: 10, hits: 3 }),
      round(2, { rctMs: 250, aimN: 1, preaim: 3, shots: 4, hits: 4 }), // too few shots
      round(3, { shots: 20, hits: 5 }), // no aim samples
    ];
    const c = aimConsistency(rounds, 0);
    expect(c.reaction).toEqual([
      { round: 1, v: 300 },
      { round: 2, v: 250 },
    ]);
    expect(c.preaim.map((p) => p.v)).toEqual([4, 3]);
    expect(c.accuracy).toEqual([
      { round: 1, v: 30 },
      { round: 3, v: 25 },
    ]);
  });

  it("flags a sharp mid-match reaction improvement at the right round", () => {
    // rounds 1-8 ~300ms, rounds 9-16 ~150ms — a hard step down
    const rounds = Array.from({ length: 16 }, (_, i) => {
      const base = i < 8 ? 300 : 150;
      return round(i + 1, { rctMs: base + (i % 3) * 10, aimN: 1 });
    });
    const c = aimConsistency(rounds, 0);
    expect(c.step).not.toBeNull();
    expect(c.step!.metric).toBe("reaction");
    expect(c.step!.atRound).toBe(9);
    expect(c.step!.before).toBeGreaterThan(280);
    expect(c.step!.after).toBeLessThan(180);
  });

  it("ignores decline — getting worse is tilt, not a toggle", () => {
    // reaction climbing 150 → 300 (played worse late)
    const rounds = Array.from({ length: 16 }, (_, i) =>
      round(i + 1, { rctMs: (i < 8 ? 150 : 300) + (i % 3) * 10, aimN: 1 }),
    );
    expect(aimConsistency(rounds, 0).step).toBeNull();
  });

  it("does not flag ordinary noisy series", () => {
    const noise = [280, 310, 250, 340, 290, 260, 330, 300, 270, 320, 295, 285];
    const rounds = noise.map((v, i) => round(i + 1, { rctMs: v, aimN: 1 }));
    expect(aimConsistency(rounds, 0).step).toBeNull();
  });

  it("needs at least 6 samples to call a step", () => {
    const rounds = [300, 300, 300, 150, 150].map((v, i) => round(i + 1, { rctMs: v, aimN: 1 }));
    expect(aimConsistency(rounds, 0).step).toBeNull();
  });

  it("flags a PERFECT noise-free step at the right round (zero pooled sigma)", () => {
    // quantized accuracy can be exactly constant on both sides of a toggle —
    // the sharpest possible step must not be skipped or misplaced
    const rounds = [20, 20, 20, 20, 20, 20, 60, 60, 60, 60, 60, 60].map((acc, i) =>
      round(i + 1, { shots: 20, hits: (acc / 100) * 20 }),
    );
    const c = aimConsistency(rounds, 0);
    expect(c.step).not.toBeNull();
    expect(c.step!.metric).toBe("accuracy");
    expect(c.step!.atRound).toBe(7);
    expect(c.step!.before).toBeCloseTo(20);
    expect(c.step!.after).toBeCloseTo(60);
  });

  it("a tiny wobble on a flat series never flags", () => {
    // 20% constant, then 20.4% constant — zero variance but a meaningless diff
    const rounds = [500, 500, 500, 500, 502, 502, 502, 502].map((hits, i) =>
      round(i + 1, { shots: 2500, hits }),
    );
    expect(aimConsistency(rounds, 0).step).toBeNull();
  });

  it("picks accuracy steps too (rising = suspicious)", () => {
    const rounds = Array.from({ length: 14 }, (_, i) => {
      const acc = i < 7 ? 20 + (i % 3) * 2 : 55 + (i % 3) * 2; // % roughly doubles
      return round(i + 1, { shots: 20, hits: Math.round((acc / 100) * 20) });
    });
    const c = aimConsistency(rounds, 0);
    expect(c.step?.metric).toBe("accuracy");
    expect(c.step?.atRound).toBe(8);
  });
});
