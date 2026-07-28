import { describe, it, expect } from "vitest";
import { tradePairs, execPackages } from "./teamscout";
import { worldToRadar } from "@/lib/maps/calibration";
import type { Zone } from "@/lib/maps/zones";
import type { ReplayKill, ReplayMeta, ReplayRound } from "./types";

const MAP = "de_inferno";
const meta: ReplayMeta = {
  map: MAP,
  tickRate: 64,
  frameHz: 1,
  players: Array.from({ length: 10 }, (_, i) => ({
    steamId: `p${i}`,
    name: `P${i}`,
    team: i < 5 ? ("CT" as const) : ("T" as const),
  })),
  rounds: 2,
};

const kill = (t: number, k: number, v: number): ReplayKill =>
  ({ t, k, v, kx: 0, ky: 0, vx: 0, vy: 0, w: "ak47" }) as ReplayKill;

function rd(over: Partial<ReplayRound>): ReplayRound {
  return {
    n: 1,
    winner: "CT",
    reason: "",
    ct: [0, 1, 2, 3, 4],
    t: [5, 6, 7, 8, 9],
    frames: [],
    kills: [],
    nades: [],
    bomb: [],
    ...over,
  } as ReplayRound;
}

describe("tradePairs", () => {
  it("credits the avenger within the window, once per death", () => {
    // T5 kills CT0; CT1 kills T5 3s later — team A's death was traded by 1
    const r = rd({ kills: [kill(20, 5, 0), kill(23, 1, 5), kill(40, 1, 6)] });
    const { a, b } = tradePairs(meta, [r]);
    expect(a.deaths).toBe(1);
    expect(a.traded).toBe(1);
    expect(a.pairs[0]).toMatchObject({ avenged: 0, avenger: 1, count: 1 });
    // team B: T5 and T6 died, neither avenged (T7 never killed CT1 in window)
    expect(b.deaths).toBe(2);
    expect(b.traded).toBe(0);
  });

  it("a revenge outside 5s is not a trade", () => {
    const r = rd({ kills: [kill(20, 5, 0), kill(27, 1, 5)] });
    expect(tradePairs(meta, [r]).a.traded).toBe(0);
  });
});

describe("execPackages", () => {
  const ra = worldToRadar(MAP, 1000, 1000)!;
  const zones: Zone[] = [{ id: "za", name: "A Site", kind: "A", points: [{ x: ra.x, y: ra.y }] }];
  const nade = (t: number, by: number, k = "smoke") => ({ t, k, x: 1000, y: 1000, ox: 0, oy: 0, dur: 0, by });

  it("finds a 3-nade T burst and labels its site with win tracking", () => {
    const r1 = rd({ n: 3, winner: "T", nades: [nade(20, 5), nade(24, 6, "flash"), nade(28, 7)] });
    const r2 = rd({ n: 4, winner: "CT", nades: [nade(30, 5), nade(31, 6), nade(33, 8, "molotov")] });
    const { b } = execPackages(meta, [r1, r2], zones);
    expect(b.tRounds).toBe(2);
    expect(b.packages).toHaveLength(1);
    expect(b.packages[0]).toMatchObject({ site: "A", count: 2, wins: 1 });
    expect(b.packages[0].kinds.smoke).toBe(4);
    expect(b.packages[0].rounds).toEqual([3, 4]);
  });

  it("spread poking (no 12s burst of 3) is not a package", () => {
    const r = rd({ nades: [nade(20, 5), nade(40, 6), nade(60, 7)] });
    expect(execPackages(meta, [r], zones).b.packages).toHaveLength(0);
  });
});
