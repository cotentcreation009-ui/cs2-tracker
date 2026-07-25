import { describe, it, expect } from "vitest";
import { analyzeRotations } from "./rotates";
import type { ReplayFrame, ReplayMeta, ReplayRound } from "./types";

// ── synthetic map ───────────────────────────────────────────────────────────
// Site A at (0,0), site B at (4000,0) → sep 4000. CTs 0-4, Ts 5-9.
const A = { x: 0, y: 0 };
const B = { x: 4000, y: 0 };

const meta: ReplayMeta = {
  map: "de_test",
  tickRate: 64,
  frameHz: 1,
  players: [
    ...[0, 1, 2, 3, 4].map((i) => ({ steamId: `ct${i}`, name: `CT${i}`, team: "CT" as const })),
    ...[5, 6, 7, 8, 9].map((i) => ({ steamId: `t${i}`, name: `T${i}`, team: "T" as const })),
  ],
  rounds: 1,
};

type PosFn = (t: number) => { x: number; y: number } | null; // null = not yet tracked

// Linear move from `from` to `to` over [t0, t1]; parked before/after.
const move =
  (from: { x: number; y: number }, to: { x: number; y: number }, t0: number, t1: number): PosFn =>
  (t) => {
    if (t <= t0) return from;
    if (t >= t1) return to;
    const f = (t - t0) / (t1 - t0);
    return { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f };
  };
const park = (p: { x: number; y: number }): PosFn => () => p;

// Build a round with 1 Hz frames from t=1..dur for the given movement scripts.
function round(
  n: number,
  pos: Record<number, PosFn>,
  opts: Partial<ReplayRound> & { dur?: number } = {},
): ReplayRound {
  const dur = opts.dur ?? 80;
  const frames: ReplayFrame[] = [];
  for (let t = 1; t <= dur; t++) {
    const p = [];
    for (const [i, fn] of Object.entries(pos)) {
      const at = fn(t);
      if (at) p.push({ i: Number(i), x: at.x, y: at.y, d: 0, h: 100 });
    }
    frames.push({ t, p });
  }
  return {
    n,
    winner: "CT",
    reason: "",
    freezeEnd: 15,
    ct: [0, 1, 2, 3, 4],
    t: [5, 6, 7, 8, 9],
    frames,
    kills: [],
    nades: [],
    bomb: [],
    ...opts,
  };
}

// Everyone parked far from the action unless scripted otherwise. Idle CTs sit
// off B (never within contact range of the A-bound Ts); idle Ts hold a corner
// near B's side of the map.
const IDLE_CT = { x: 4000, y: 2600 };
const IDLE_T = { x: 2600, y: 2600 };
function cast(overrides: Record<number, PosFn>): Record<number, PosFn> {
  const pos: Record<number, PosFn> = {};
  for (let i = 0; i <= 4; i++) pos[i] = park(IDLE_CT);
  for (let i = 5; i <= 9; i++) pos[i] = park(IDLE_T);
  return { ...pos, ...overrides };
}

// Ts committing from their idle corner to outside A (still >CONTACT_RADIUS
// from A itself so a defender arriving at A gains no contact info).
const tCommitToA = (t0: number, t1: number) => move(IDLE_T, { x: 300, y: 2400 }, t0, t1);

// Anchor plants: one labeled plant at each site (late, so they never precede
// the rotates under test).
const PLANT_A = { t: 78, k: "plant", x: A.x, y: A.y, site: "A" };
const PLANT_B = { t: 78, k: "plant", x: B.x, y: B.y, site: "B" };

describe("analyzeRotations", () => {
  it("needs plants at both sites", () => {
    const r = round(1, cast({}), { bomb: [PLANT_A] });
    expect(analyzeRotations(meta, [r]).available).toBe(false);
  });

  it("flags a blind-correct CT rotate: after the enemy commit, before any info", () => {
    // CT0 anchors B, leaves for A at t=40 — 8s after all five Ts committed to
    // A's side (t≈30-32) — with zero kills/nades/bomb/contact before t=40.
    const r1 = round(
      1,
      cast({
        0: move(B, A, 40, 56),
        5: tCommitToA(28, 36),
        6: tCommitToA(28, 36),
        7: tCommitToA(28, 36),
        8: tCommitToA(28, 36),
        9: tCommitToA(28, 36),
      }),
      { bomb: [PLANT_A] },
    );
    const r2 = round(2, cast({}), { bomb: [PLANT_B] });
    const rep = analyzeRotations(meta, [r1, r2]);
    expect(rep.available).toBe(true);

    const p0 = rep.byPlayer.get(0);
    expect(p0).toBeTruthy();
    expect(p0!.blindCorrect).toBe(1);
    expect(p0!.blindWrong).toBe(0);
    const ev = p0!.events[0];
    expect(ev.verdict).toBe("blind-correct");
    expect(ev.from).toBe("B");
    expect(ev.to).toBe("A");
    expect(ev.t0).toBeGreaterThanOrEqual(38);
    expect(ev.t0).toBeLessThanOrEqual(42);
    // reacted within ~10s of the commit onset
    expect(ev.reactSec).not.toBeNull();
    expect(ev.reactSec!).toBeLessThanOrEqual(12);
    expect(p0!.x).toBeGreaterThan(0);
  });

  it("marks the same rotate informed when a kill preceded it", () => {
    const r1 = round(
      1,
      cast({
        0: move(B, A, 40, 56),
        5: tCommitToA(28, 36),
        6: tCommitToA(28, 36),
        7: tCommitToA(28, 36),
      }),
      {
        bomb: [PLANT_A],
        kills: [{ t: 35, k: 1, v: 8, kx: 0, ky: 0, vx: 0, vy: 0, w: "ak47" }],
      },
    );
    const r2 = round(2, cast({}), { bomb: [PLANT_B] });
    const rep = analyzeRotations(meta, [r1, r2]);
    const p0 = rep.byPlayer.get(0);
    expect(p0!.blindCorrect).toBe(0);
    expect(p0!.informed).toBe(1);
    expect(p0!.x).toBe(0);
  });

  it("counts a blind rotate away from the real hit as blind-wrong", () => {
    // Ts lean toward B (CT0's own site) — staged outside everyone's contact
    // radius — and CT0 leaves it for A anyway.
    const tCommitToB = (t0: number, t1: number) => move(IDLE_T, { x: 2900, y: 1700 }, t0, t1);
    const r1 = round(
      1,
      cast({
        0: move(B, A, 40, 56),
        5: tCommitToB(28, 36),
        6: tCommitToB(28, 36),
        7: tCommitToB(28, 36),
        8: tCommitToB(28, 36),
        9: tCommitToB(28, 36),
      }),
      { bomb: [PLANT_A] },
    );
    const r2 = round(2, cast({}), { bomb: [PLANT_B] });
    const rep = analyzeRotations(meta, [r1, r2]);
    const p0 = rep.byPlayer.get(0);
    expect(p0!.blindWrong).toBe(1);
    expect(p0!.blindCorrect).toBe(0);
    expect(p0!.x).toBe(0); // clamped at 0, never negative
  });

  it("keeps a T-side hit on a statically weak site a hunch, not a tell", () => {
    // CTs sit B-side from the ROUND START (a static stack, not a mid-round
    // shift). T5 rotates from near B all the way onto empty A — exactly what a
    // legit default read looks like, so it must stay a hunch.
    const r1 = round(
      1,
      cast({
        5: move({ x: 3400, y: 1400 }, { x: 300, y: 900 }, 30, 40),
      }),
      { bomb: [PLANT_A] },
    );
    const r2 = round(2, cast({}), { bomb: [PLANT_B] });
    const rep = analyzeRotations(meta, [r1, r2]);
    const p5 = rep.byPlayer.get(5);
    expect(p5).toBeTruthy();
    expect(p5!.total).toBe(1);
    expect(p5!.events[0].verdict).toBe("hunch");
    expect(p5!.blindCorrect).toBe(0);
    expect(p5!.x).toBe(0);
  });

  it("ignores the spawn deployment (no settle before freeze-end grace)", () => {
    // CT1 runs from mid straight to A right at freeze end — a deploy, not a
    // rotate (t0 < freezeEnd + grace).
    const r1 = round(
      1,
      cast({
        1: move({ x: 2600, y: -400 }, A, 15, 26),
      }),
      { bomb: [PLANT_A] },
    );
    const r2 = round(2, cast({}), { bomb: [PLANT_B] });
    const rep = analyzeRotations(meta, [r1, r2]);
    expect(rep.byPlayer.get(1)?.total ?? 0).toBe(0);
  });

  it("treats an enemy nade detonation as information", () => {
    const r1 = round(
      1,
      cast({
        0: move(B, A, 40, 56),
        5: tCommitToA(28, 36),
        6: tCommitToA(28, 36),
        7: tCommitToA(28, 36),
      }),
      {
        bomb: [PLANT_A],
        nades: [{ t: 37, k: "smoke", x: 200, y: 100, dur: 18, by: 5 }],
      },
    );
    const r2 = round(2, cast({}), { bomb: [PLANT_B] });
    const rep = analyzeRotations(meta, [r1, r2]);
    expect(rep.byPlayer.get(0)!.informed).toBe(1);
    expect(rep.byPlayer.get(0)!.blindCorrect).toBe(0);
  });
});
