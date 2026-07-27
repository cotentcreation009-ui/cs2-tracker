import { describe, it, expect } from "vitest";
import { zoneTimings, earlySetups } from "./zonetiming";
import { worldToRadar } from "@/lib/maps/calibration";
import type { Zone } from "@/lib/maps/zones";
import type { ReplayFrame, ReplayMeta, ReplayRound } from "./types";

const MAP = "de_inferno"; // calibrated map so classifyPosition resolves

const meta: ReplayMeta = {
  map: MAP,
  tickRate: 64,
  frameHz: 1,
  players: Array.from({ length: 10 }, (_, i) => ({
    steamId: `p${i}`,
    name: `P${i}`,
    team: i < 5 ? ("CT" as const) : ("T" as const),
  })),
  rounds: 1,
};

// two anchor zones at the radar positions of two far-apart world points
const A = { x: 1000, y: 1000 };
const B = { x: -1500, y: -1500 };
const ra = worldToRadar(MAP, A.x, A.y)!;
const rb = worldToRadar(MAP, B.x, B.y)!;
const zones: Zone[] = [
  { id: "za", name: "Alpha", kind: "A", points: [{ x: ra.x, y: ra.y }] },
  { id: "zb", name: "Beta", kind: "B", points: [{ x: rb.x, y: rb.y }] },
];

const frame = (t: number, p: { i: number; x: number; y: number; d?: number; h?: number }[]): ReplayFrame => ({
  t,
  p: p.map((q) => ({ i: q.i, x: q.x, y: q.y, d: q.d ?? 0, h: q.h ?? 100 })),
});

function rd(frames: ReplayFrame[], n = 1): ReplayRound {
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
  } as unknown as ReplayRound;
}

describe("zoneTimings", () => {
  it("records each side's first touch, in seconds after freeze end", () => {
    const r = rd([
      frame(16, [{ i: 0, x: B.x, y: B.y }]), // CT in Beta at +1s
      frame(20, [{ i: 5, x: A.x, y: A.y }]), // T in Alpha at +5s
      frame(40, [{ i: 0, x: A.x, y: A.y }]), // CT reaches Alpha at +25s
    ]);
    const rows = zoneTimings(meta, [r], zones);
    const alpha = rows.find((z) => z.zone === "Alpha")!;
    const beta = rows.find((z) => z.zone === "Beta")!;
    expect(alpha.t.median).toBe(5);
    expect(alpha.ct.median).toBe(25);
    expect(beta.ct.median).toBe(1);
    expect(beta.t.n).toBe(0);
    expect(beta.t.median).toBeNull();
  });

  it("medians across rounds and flags contested zones", () => {
    const mk = (tT: number, tCT: number) =>
      rd([
        frame(15 + tT, [{ i: 5, x: A.x, y: A.y }]),
        frame(15 + tCT, [{ i: 0, x: A.x, y: A.y }]),
      ]);
    // T touches at 10,12,14 (median 12); CT at 11,13,15 (median 13) → contested
    const rows = zoneTimings(meta, [mk(10, 11), mk(12, 13), mk(14, 15)], zones);
    const alpha = rows.find((z) => z.zone === "Alpha")!;
    expect(alpha.t.median).toBe(12);
    expect(alpha.ct.median).toBe(13);
    expect(alpha.t.fastest).toBe(10);
    expect(alpha.contested).toBe(true);
  });

  it("ignores dead players and respects the player scope", () => {
    const r = rd([
      frame(20, [{ i: 5, x: A.x, y: A.y, h: 0 }]), // dead — no touch
      frame(30, [{ i: 6, x: A.x, y: A.y }]),
    ]);
    const all = zoneTimings(meta, [r], zones);
    expect(all.find((z) => z.zone === "Alpha")!.t.median).toBe(15);
    const scoped = zoneTimings(meta, [r], zones, (i) => i === 5);
    expect(scoped.find((z) => z.zone === "Alpha")).toBeUndefined();
  });
});

describe("earlySetups", () => {
  it("picks the medoid spot per player-side with a circular-mean facing", () => {
    // player 5 stands near A in two rounds and far away in one (the outlier)
    const rounds = [
      rd([frame(35, [{ i: 5, x: A.x, y: A.y, d: 80 }])], 1),
      rd([frame(35, [{ i: 5, x: A.x + 50, y: A.y, d: 100 }])], 2),
      rd([frame(35, [{ i: 5, x: B.x, y: B.y, d: 0 }])], 3),
    ];
    const spots = earlySetups(meta, rounds, 20);
    const s = spots.find((sp) => sp.i === 5)!;
    expect(s.side).toBe("T");
    expect(s.n).toBe(3);
    expect(Math.abs(s.x - A.x) <= 50).toBe(true); // medoid is in the A cluster
    expect(s.dirDeg).toBeCloseTo(90, 0); // mean of 80 and 100; outlier's 0° excluded
  });

  it("skips rounds with no frame near the target and dead players", () => {
    const rounds = [
      rd([frame(60, [{ i: 5, x: A.x, y: A.y }])]), // nothing near 35s
      rd([frame(35, [{ i: 5, x: A.x, y: A.y, h: 0 }])]), // dead
    ];
    expect(earlySetups(meta, rounds, 20)).toHaveLength(0);
  });
});
