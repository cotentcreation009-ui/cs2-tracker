import { describe, expect, it } from "vitest";
import { rowKD } from "./matchKd";

describe("rowKD", () => {
  it("keeps the row's own numbers when it has them", () => {
    expect(rowKD({ kills: 18, deaths: 20 }, { kills: 24, deaths: 12 })).toEqual({ kills: 18, deaths: 20 });
  });
  it("keeps a genuine zero-kill game (deaths only) as the row's own", () => {
    expect(rowKD({ deaths: 7 }, null)).toEqual({ kills: 0, deaths: 7 });
  });
  it("falls back to the loaded per-game stats when the row has neither", () => {
    expect(rowKD({}, { kills: 24, deaths: 12 })).toEqual({ kills: 24, deaths: 12 });
  });
  it("is null while nothing is known — still loading, or no scoreboard", () => {
    expect(rowKD({}, undefined)).toBeNull();
    expect(rowKD({}, null)).toBeNull();
    expect(rowKD({ kills: 0, deaths: 0 }, {})).toBeNull();
  });
});
