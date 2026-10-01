import { describe, expect, it } from "vitest";
import {
  REGIONS,
  asOfLabel,
  initialOf,
  levelTitle,
  pickRegion,
  regionLabel,
  rowHref,
  splitColumns,
} from "./faceitTop";

describe("faceit top strip", () => {
  it("lists exactly the regions the backend allows", () => {
    expect(REGIONS.map((r) => r.code)).toEqual(["EU", "NA", "SA", "AS", "OCE"]);
    expect(regionLabel("OCE")).toBe("Oceania");
    expect(regionLabel("XX")).toBe("XX");
  });

  it("links to the CSRun profile when FACEIT told us the Steam id, else out to FACEIT", () => {
    expect(
      rowHref({ steamId64: "76561198386265483", faceitUrl: "https://www.faceit.com/en/players/donk666" }),
    ).toEqual({ href: "/profiles/76561198386265483", external: false });
    expect(rowHref({ faceitUrl: "https://www.faceit.com/en/players/donk666" })).toEqual({
      href: "https://www.faceit.com/en/players/donk666",
      external: true,
    });
    // A malformed id is not trusted into a profile URL.
    expect(rowHref({ steamId64: "12", faceitUrl: "https://www.faceit.com/en/players/x" })).toEqual({
      href: "https://www.faceit.com/en/players/x",
      external: true,
    });
    expect(rowHref({})).toBeNull();
  });

  it("picks the stored region when it has data, else EU, else the first available", () => {
    expect(pickRegion("NA", ["EU", "NA"])).toBe("NA");
    expect(pickRegion("SA", ["EU", "NA"])).toBe("EU");
    expect(pickRegion(null, ["EU", "NA"])).toBe("EU");
    expect(pickRegion("garbage", ["NA", "AS"])).toBe("NA");
    expect(pickRegion(undefined, [])).toBe("EU");
  });

  it("splits ten rows 1–5 | 6–10 and keeps the extra row on the left", () => {
    const ten = Array.from({ length: 10 }, (_, i) => i + 1);
    expect(splitColumns(ten)).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10],
    ]);
    expect(splitColumns([1, 2, 3])).toEqual([[1, 2], [3]]);
    expect(splitColumns([])).toEqual([[], []]);
  });

  it("stamps the snapshot by when FACEIT was asked, and says when it is stale", () => {
    const now = Date.parse("2026-10-01T15:00:00Z");
    expect(asOfLabel("2026-10-01T14:05:00Z", false, now)).toBe("as of 14:05 UTC");
    expect(asOfLabel("2026-10-01T13:05:00Z", true, now)).toBe(
      "last refreshed 13:05 UTC · FACEIT isn't answering right now",
    );
    // Yesterday's copy names the day so "13:05" cannot be mistaken for today.
    expect(asOfLabel("2026-09-30T13:05:00Z", true, now)).toBe(
      "last refreshed 30 Sept, 13:05 UTC · FACEIT isn't answering right now",
    );
  });

  it("shows no stamp at all for a missing or fake one", () => {
    expect(asOfLabel(undefined, false)).toBe("");
    expect(asOfLabel("", false)).toBe("");
    expect(asOfLabel("not a date", false)).toBe("");
    expect(asOfLabel("0001-01-01T00:00:00Z", false)).toBe(""); // Go's zero time
  });

  it("takes a whole code point as the initial", () => {
    expect(initialOf("donk666")).toBe("D");
    expect(initialOf("  ropz")).toBe("R");
    expect(initialOf("サイコパス")).toBe("サ");
    expect(initialOf("🔥hot")).toBe("🔥");
    expect(initialOf("")).toBe("?");
  });

  it("titles a level badge", () => {
    expect(levelTitle(10)).toBe("FACEIT level 10");
    expect(levelTitle(0)).toBe("FACEIT level unknown");
    expect(levelTitle(undefined)).toBe("FACEIT level unknown");
  });
});
