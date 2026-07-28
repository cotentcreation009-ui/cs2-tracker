import { describe, it, expect } from "vitest";
import { parseImportPayload } from "./store";

const meta = {
  map: "de_inferno",
  tickRate: 64,
  frameHz: 1,
  players: [{ steamId: "1", name: "A", team: "CT" as const }],
  rounds: 2,
};
const rounds = [{ n: 1 }, { n: 2 }];

describe("parseImportPayload", () => {
  it("accepts a single-demo export", () => {
    const out = parseImportPayload({ kind: "statrun-demo", version: 1, name: "My match", savedAt: 123, meta, rounds });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("My match");
    expect(out[0].savedAt).toBe(123);
    expect(out[0].meta.map).toBe("de_inferno");
    expect(out[0].rounds).toHaveLength(2);
  });

  it("accepts a library export with several demos", () => {
    const d = { kind: "statrun-demo", name: "One", savedAt: 1, meta, rounds };
    const out = parseImportPayload({ kind: "statrun-library", version: 1, exportedAt: 5, demos: [d, { ...d, name: "Two" }] });
    expect(out.map((x) => x.name)).toEqual(["One", "Two"]);
  });

  it("accepts a raw parser payload (map + roundData)", () => {
    const out = parseImportPayload({ ...meta, roundData: rounds });
    expect(out).toHaveLength(1);
    expect(out[0].name).toContain("inferno");
    expect(out[0].rounds).toHaveLength(2);
  });

  it("fills fallbacks for missing name/savedAt", () => {
    const out = parseImportPayload({ kind: "statrun-demo", meta, rounds });
    expect(out[0].name).toBe("Imported demo");
    expect(out[0].savedAt).toBeGreaterThan(0);
  });

  it("rejects garbage with a human message", () => {
    expect(() => parseImportPayload(null)).toThrow(/JSON object/);
    expect(() => parseImportPayload({ hello: 1 })).toThrow(/Unrecognized/);
    expect(() => parseImportPayload({ kind: "statrun-demo", meta: { map: 3 }, rounds })).toThrow(/malformed meta/);
    expect(() => parseImportPayload({ kind: "statrun-library", demos: [] })).toThrow(/no demos/);
    expect(() => parseImportPayload({ kind: "statrun-library", demos: [{ bad: true }] })).toThrow(/malformed meta/);
  });

  it("rejects junk that would persist and crash pages later", () => {
    // null / non-object player entries would crash MatchToolbar on open
    expect(() =>
      parseImportPayload({ kind: "statrun-demo", meta: { ...meta, players: [null] }, rounds }),
    ).toThrow(/malformed/);
    expect(() =>
      parseImportPayload({ kind: "statrun-demo", meta: { ...meta, players: [7] }, rounds }),
    ).toThrow(/malformed/);
    // null round items would make the saved match fail to open forever
    expect(() => parseImportPayload({ kind: "statrun-demo", meta, rounds: [null] })).toThrow(/malformed/);
    expect(() => parseImportPayload({ kind: "statrun-demo", meta, rounds: [1, 2] })).toThrow(/malformed/);
    // raw parser payload without players would brick the /demos library page
    expect(() => parseImportPayload({ map: "de_dust2", roundData: [] })).toThrow(/incomplete/);
    expect(() => parseImportPayload({ map: "de_dust2", players: [null], roundData: rounds })).toThrow(/incomplete/);
  });

  it("fills raw-payload defaults instead of storing undefined meta numbers", () => {
    const out = parseImportPayload({ map: "de_nuke", players: meta.players, roundData: rounds });
    expect(out[0].meta.rounds).toBe(2); // derived from roundData.length
    expect(out[0].meta.tickRate).toBe(64);
    expect(out[0].meta.frameHz).toBe(1);
  });
});
