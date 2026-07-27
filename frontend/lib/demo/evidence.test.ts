import { describe, it, expect } from "vitest";
import { cheatMoments } from "./evidence";
import type { ReplayKill, ReplayMeta, ReplayPlayerStat, ReplayRound } from "./types";

// players: 0+3 CT, 1+2 T — player 0 is the suspect under review
const meta: ReplayMeta = {
  map: "de_test",
  tickRate: 64,
  frameHz: 1,
  players: [
    { steamId: "a", name: "Suspect", team: "CT" },
    { steamId: "b", name: "Victim1", team: "T" },
    { steamId: "c", name: "Victim2", team: "T" },
    { steamId: "d", name: "Mate", team: "CT" },
  ],
  rounds: 1,
};

const kill = (over: Partial<ReplayKill> = {}): ReplayKill => ({
  t: 30,
  k: 0,
  v: 1,
  kx: 0,
  ky: 0,
  vx: 100,
  vy: 100,
  w: "ak47",
  ...over,
});

function rd(n: number, kills: ReplayKill[], stats?: ReplayPlayerStat[]): ReplayRound {
  return {
    n,
    winner: "CT",
    reason: "",
    ct: [0, 3],
    t: [1, 2],
    frames: [],
    kills,
    nades: [],
    bomb: [],
    ...(stats ? { stats } : {}),
  } as ReplayRound;
}

describe("cheatMoments qualification", () => {
  it("does NOT flag an ordinary headshot kill — that's volume, not a tell", () => {
    expect(cheatMoments(meta, [rd(1, [kill({ hs: true })])], 0)).toHaveLength(0);
  });

  it("does NOT flag fast-but-plausible reactions (120-260ms) on their own", () => {
    expect(cheatMoments(meta, [rd(1, [kill({ rct: 240, hs: true })])], 0)).toHaveLength(0);
    expect(cheatMoments(meta, [rd(1, [kill({ rct: 150, hs: true })])], 0)).toHaveLength(0);
  });

  it("flags a trigger-like reaction (<120ms) and keeps the per-kill time in the tag", () => {
    const ms = cheatMoments(meta, [rd(1, [kill({ rct: 95 })])], 0);
    expect(ms).toHaveLength(1);
    expect(ms[0].tags).toContain("95ms reaction");
  });

  it("flags a kill landed while flashed", () => {
    const ms = cheatMoments(meta, [rd(1, [kill({ bl: true })])], 0);
    expect(ms).toHaveLength(1);
    expect(ms[0].tags).toContain("killed while flashed");
  });

  it("flags a wallbang only when it's a headshot", () => {
    expect(cheatMoments(meta, [rd(1, [kill({ wb: true })])], 0)).toHaveLength(0);
    const ms = cheatMoments(meta, [rd(1, [kill({ wb: true, hs: true })])], 0);
    expect(ms).toHaveLength(1);
    expect(ms[0].tags).toContain("headshot through a wall");
  });

  it("flags sustained extreme pre-aim (2+ samples under 2°) but not angle-holding", () => {
    const at = (deg: number, aimN = 2) =>
      cheatMoments(meta, [rd(1, [kill()], [{ i: 0, aimN, preaim: deg * aimN }])], 0);
    expect(at(5)).toHaveLength(0); // ordinary
    expect(at(2.5)).toHaveLength(0); // low but not extreme
    expect(at(1.2, 1)).toHaveLength(0); // one sample = one held angle
    const ms = at(1.2);
    expect(ms).toHaveLength(1);
    expect(ms[0].tags).toContain("1.2° pre-aim");
  });

  it("flags a snap-kill round", () => {
    const ms = cheatMoments(meta, [rd(1, [kill()], [{ i: 0, snap: 2, aimN: 2 }])], 0);
    expect(ms).toHaveLength(1);
    expect(ms[0].tags).toContain("2 snap kills");
  });

  it("flags anomalous round accuracy (≥70% of ≥10 shots) but not 65%", () => {
    const at = (hits: number, shots: number) =>
      cheatMoments(meta, [rd(1, [kill()], [{ i: 0, shots, hits }])], 0);
    expect(at(13, 20)).toHaveLength(0); // 65%
    const ms = at(15, 20); // 75%
    expect(ms).toHaveLength(1);
    expect(ms[0].tags).toContain("75% accuracy");
  });

  it("treats the parser's unseen flag as corroboration, never a flag by itself", () => {
    // the CS2 spotted mask misses ~29% of ordinary kills — us alone means little
    expect(cheatMoments(meta, [rd(1, [kill({ us: true, hs: true })])], 0)).toHaveLength(0);
    const ms = cheatMoments(meta, [rd(1, [kill({ us: true, rct: 95 })])], 0);
    expect(ms).toHaveLength(1);
    expect(ms[0].tags).toContain("never spotted the victim");
    expect(ms[0].tags).toContain("95ms reaction");
  });

  it("never flags teamkills, whatever their tells", () => {
    expect(cheatMoments(meta, [rd(1, [kill({ v: 3, bl: true, rct: 100 })])], 0)).toHaveLength(0);
  });

  it("collapses a flagged multi-kill round into one row with a count", () => {
    const ms = cheatMoments(
      meta,
      [rd(1, [kill({ t: 20, rct: 150 }), kill({ t: 30, v: 2, rct: 140 }), kill({ t: 40, v: 1 })], [{ i: 0, snap: 1, aimN: 3 }])],
      0,
    );
    expect(ms).toHaveLength(1);
    expect(ms[0].extraKills).toBe(2);
    expect(ms[0].tags).toContain("3K round");
  });
});
