import { describe, it, expect } from "vitest";
import { roundWinProb } from "./winprob";
import type { ReplayKill, ReplayMeta, ReplayRound } from "./types";

const meta: ReplayMeta = {
  map: "de_test",
  tickRate: 64,
  frameHz: 1,
  players: Array.from({ length: 10 }, (_, i) => ({
    steamId: `p${i}`,
    name: `P${i}`,
    team: i < 5 ? ("CT" as const) : ("T" as const),
  })),
  rounds: 1,
};

const kill = (t: number, v: number, over: Partial<ReplayKill> = {}): ReplayKill => ({
  t, k: v < 5 ? 5 : 0, v, kx: 0, ky: 0, vx: 0, vy: 0, w: "ak47", ...over,
});

function rd(over: Partial<ReplayRound> = {}): ReplayRound {
  return {
    n: 2, // not a pistol round
    winner: "CT",
    reason: "",
    freezeEnd: 15,
    ct: [0, 1, 2, 3, 4],
    t: [5, 6, 7, 8, 9],
    frames: [{ t: 100, p: [] }],
    kills: [],
    nades: [],
    bomb: [],
    ...over,
  } as ReplayRound;
}

const pAt = (wp: ReturnType<typeof roundWinProb>, t: number) => {
  // last sample at or before t
  let p = wp.points[0]?.p ?? 0.5;
  for (const pt of wp.points) if (pt.t <= t) p = pt.p;
  return p;
};

describe("roundWinProb", () => {
  it("starts a 5v5 near even", () => {
    const p = pAt(roundWinProb(meta, rd()), 16);
    expect(p).toBeGreaterThan(0.4);
    expect(p).toBeLessThan(0.65);
  });

  it("man advantage dominates: CT 5v2 is strongly CT", () => {
    const r = rd({ kills: [kill(20, 5), kill(21, 6), kill(22, 7)] });
    expect(pAt(roundWinProb(meta, r), 25)).toBeGreaterThan(0.8);
  });

  it("a plant swings the round toward T and tightens as the C4 runs down", () => {
    const r = rd({ bomb: [{ t: 50, k: "plant", x: 0, y: 0 }] });
    const wp = roundWinProb(meta, r);
    const before = pAt(wp, 49);
    const just = pAt(wp, 51);
    const late = pAt(wp, 85); // 35s into the 40s C4
    expect(just).toBeLessThan(before);
    expect(late).toBeLessThan(just);
    expect(late).toBeLessThan(0.2);
  });

  it("terminal states pin the probability", () => {
    // all Ts dead, no plant → CT won
    const wipe = rd({ kills: [5, 6, 7, 8, 9].map((v, i) => kill(20 + i, v)) });
    expect(pAt(roundWinProb(meta, wipe), 30)).toBe(1);
    // defuse → 1, explode → 0
    const def = rd({ bomb: [{ t: 40, k: "plant", x: 0, y: 0 }, { t: 60, k: "defuse", x: 0, y: 0 }] });
    expect(pAt(roundWinProb(meta, def), 61)).toBe(1);
    const boom = rd({ bomb: [{ t: 40, k: "plant", x: 0, y: 0 }, { t: 80, k: "explode", x: 0, y: 0 }] });
    expect(pAt(roundWinProb(meta, boom), 81)).toBe(0);
  });

  it("credits each kill with its swing, signed from the CT view", () => {
    const r = rd({ kills: [kill(20, 5), kill(30, 0)] }); // T dies, then CT dies
    const wp = roundWinProb(meta, r);
    expect(wp.swings).toHaveLength(2);
    expect(wp.swings[0].delta).toBeGreaterThan(0); // T death helps CT
    expect(wp.swings[1].delta).toBeLessThan(0); // CT death hurts CT
  });

  it("a quiet clock leans CT when nothing happens", () => {
    const wp = roundWinProb(meta, rd());
    expect(pAt(wp, 110)).toBeGreaterThan(pAt(wp, 20));
  });
});
