import { describe, it, expect } from "vitest";
import { approxRating, type PlayerInsight } from "./insights";

// approxRating only reads these fields — the rest of PlayerInsight is inert
const p = (over: Partial<PlayerInsight>): PlayerInsight =>
  ({
    kills: 0,
    deaths: 0,
    assists: 0,
    assistsApprox: 0,
    kastPct: 0,
    adr: 0,
    roundsPlayed: 24,
    ...over,
  }) as PlayerInsight;

describe("approxRating", () => {
  it("puts an even performance near 1.0", () => {
    const r = approxRating(p({ kills: 17, deaths: 17, assists: 4, kastPct: 68, adr: 78 }));
    expect(r).toBeGreaterThan(0.85);
    expect(r).toBeLessThan(1.2);
  });

  it("ranks a star well above an anchor having a bad day", () => {
    const star = approxRating(p({ kills: 30, deaths: 12, assists: 6, kastPct: 85, adr: 105 }));
    const anchor = approxRating(p({ kills: 6, deaths: 20, assists: 2, kastPct: 45, adr: 38 }));
    expect(star).toBeGreaterThan(1.3);
    expect(anchor).toBeLessThan(0.7);
    expect(star).toBeGreaterThan(anchor);
  });

  it("rewards KAST/impact, not just raw kills", () => {
    // same kills, one dies constantly with no round presence
    const baiter = approxRating(p({ kills: 20, deaths: 22, assists: 1, kastPct: 55, adr: 70 }));
    const impact = approxRating(p({ kills: 20, deaths: 12, assists: 6, kastPct: 78, adr: 88 }));
    expect(impact).toBeGreaterThan(baiter);
  });

  it("never goes negative and survives zero rounds", () => {
    expect(approxRating(p({ roundsPlayed: 0, deaths: 5 }))).toBeGreaterThanOrEqual(0);
  });
});
