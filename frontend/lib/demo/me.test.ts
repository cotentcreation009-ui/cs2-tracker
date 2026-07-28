import { describe, it, expect } from "vitest";
import { demoDigest, suggestMe } from "./me";
import type { ReplayMeta, ReplayRound } from "./types";

const meta: ReplayMeta = {
  map: "de_inferno",
  tickRate: 64,
  frameHz: 1,
  players: [
    { steamId: "111", name: "Me", team: "CT" },
    { steamId: "222", name: "Foe", team: "T" },
  ],
  rounds: 3,
};

function rd(over: Partial<ReplayRound>): ReplayRound {
  return {
    n: 1,
    winner: "CT",
    reason: "",
    ct: [0],
    t: [1],
    frames: [],
    kills: [],
    nades: [],
    bomb: [],
    ...over,
  } as ReplayRound;
}

describe("demoDigest", () => {
  it("computes kills/deaths/ADR/HS/reaction and the match result for me", () => {
    const rounds = [
      rd({
        kills: [{ t: 10, k: 0, v: 1, kx: 0, ky: 0, vx: 0, vy: 0, w: "ak47", hs: true }],
        stats: [{ i: 0, dmg: 100, rctMs: 400, aimN: 2 }],
      }),
      rd({
        winner: "T",
        kills: [{ t: 12, k: 1, v: 0, kx: 0, ky: 0, vx: 0, vy: 0, w: "ak47" }],
        stats: [{ i: 0, dmg: 40 }],
      }),
      rd({ stats: [{ i: 0, dmg: 60 }] }),
    ];
    const d = demoDigest(meta, rounds, "111")!;
    expect(d.kills).toBe(1);
    expect(d.deaths).toBe(1);
    expect(d.hsPct).toBe(100);
    expect(d.adr).toBeCloseTo(200 / 3);
    expect(d.reactionMs).toBe(200);
    expect(d.wins).toBe(2);
    expect(d.rounds).toBe(3);
    expect(d.matchWon).toBe(true); // my team (CT start) won 2 of 3
  });

  it("returns null for a player not in the demo", () => {
    expect(demoDigest(meta, [rd({})], "999")).toBeNull();
  });

  it("resolves late connectors' team by roster overlap, not round-1 membership", () => {
    const m3 = {
      ...meta,
      players: [
        { steamId: "111", name: "Me", team: "CT" as const },
        { steamId: "222", name: "Mate", team: "CT" as const },
        { steamId: "333", name: "Foe", team: "T" as const },
      ],
    };
    // I'm absent in round 1 (teamA = {1}); I join round 2 on CT beside a
    // team-A player. Both rounds go to team A — my matchWon must be true.
    const rounds = [
      rd({ ct: [1], t: [2] }),
      rd({ ct: [0, 1], t: [2] }),
    ];
    expect(demoDigest(m3, rounds, "111")!.matchWon).toBe(true);
  });

  it("charts no ADR at all (null, not 0) for stats-less old parses", () => {
    const d = demoDigest(meta, [rd({}), rd({ winner: "T" })], "111")!;
    expect(d.adr).toBeNull();
  });

  it("skips bot-controlled rounds' aim data but keeps the rest", () => {
    const rounds = [
      rd({ bots: [0], stats: [{ i: 0, dmg: 50, rctMs: 100, aimN: 1 }] }),
      rd({ stats: [{ i: 0, dmg: 50, rctMs: 300, aimN: 1 }] }),
    ];
    const d = demoDigest(meta, rounds, "111")!;
    expect(d.reactionMs).toBe(300); // only the human round counts
    expect(d.adr).toBe(50); // damage still counts
  });
});

describe("suggestMe", () => {
  it("ranks the id that appears in the most demos first, skipping sample ids", () => {
    const s = (players: { steamId: string; name: string }[]) => ({
      meta: { ...meta, players: players.map((p) => ({ ...p, team: "CT" as const })) },
    });
    const out = suggestMe([
      s([{ steamId: "111", name: "Me" }, { steamId: "222", name: "A" }]),
      s([{ steamId: "111", name: "Me" }, { steamId: "333", name: "B" }]),
      s([{ steamId: "111", name: "MeNew" }, { steamId: "sample-1", name: "Nova" }]),
    ]);
    expect(out[0]).toMatchObject({ steamId: "111", demos: 3, name: "MeNew" });
    expect(out.find((c) => c.steamId.startsWith("sample-"))).toBeUndefined();
  });
});
