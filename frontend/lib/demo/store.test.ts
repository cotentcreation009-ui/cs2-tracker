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
    expect(() => parseImportPayload({ kind: "statrun-demo", meta: { map: 3 }, rounds })).toThrow(/missing meta/);
    expect(() => parseImportPayload({ kind: "statrun-library", demos: [] })).toThrow(/no demos/);
    expect(() => parseImportPayload({ kind: "statrun-library", demos: [{ bad: true }] })).toThrow(/missing meta/);
  });
});
