import { describe, expect, it } from "vitest";
import {
  demoArchiveKind,
  demoFileEndpoint,
  demoLinkEndpoint,
  safeDemoUrl,
  valveReplayExpired,
} from "./demoLink";

const DAY = 24 * 3600 * 1000;

describe("valveReplayExpired", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  it("is true for a Premier game older than Valve's month", () => {
    expect(valveReplayExpired("matchmaking", new Date(now - 45 * DAY).toISOString(), now)).toBe(true);
  });
  it("is false inside the month", () => {
    expect(valveReplayExpired("matchmaking", new Date(now - 3 * DAY).toISOString(), now)).toBe(false);
  });
  it("never applies to FACEIT, which keeps demos far longer", () => {
    expect(valveReplayExpired("faceit", new Date(now - 200 * DAY).toISOString(), now)).toBe(false);
  });
  it("does not call an unreadable date expired", () => {
    expect(valveReplayExpired("matchmaking", "", now)).toBe(false);
  });
});

describe("demoLinkEndpoint", () => {
  it("carries the row's finish time and score for legacy rows", () => {
    expect(
      demoLinkEndpoint("76561198019780871", "7c9bc801f1a8bb51-6e7cc3", {
        finishedAt: "2026-10-01T00:00:00Z",
        score: [13, 7],
      }),
    ).toBe(
      "/api/profiles/76561198019780871/leetify-game/7c9bc801f1a8bb51-6e7cc3/demo?finishedAt=2026-10-01T00%3A00%3A00Z&score=13-7",
    );
  });
  it("is a bare path when the row has neither", () => {
    expect(demoLinkEndpoint("1", "g")).toBe("/api/profiles/1/leetify-game/g/demo");
  });
});

describe("demoFileEndpoint", () => {
  it("is the lookup's path plus /file, same query", () => {
    expect(demoFileEndpoint("1", "g")).toBe("/api/profiles/1/leetify-game/g/demo/file");
    expect(
      demoFileEndpoint("76561198019780871", "7c9bc801f1a8bb51-6e7cc3", {
        finishedAt: "2026-10-01T00:00:00Z",
        score: [13, 7],
      }),
    ).toBe(
      "/api/profiles/76561198019780871/leetify-game/7c9bc801f1a8bb51-6e7cc3/demo/file?finishedAt=2026-10-01T00%3A00%3A00Z&score=13-7",
    );
  });
});

describe("safeDemoUrl", () => {
  it("passes Valve's http replay link and FACEIT's https one untouched", () => {
    const valve = "http://replay129.valve.net/730/003_1.dem.bz2";
    const faceit = "https://cdn.faceit.com/a.dem.zst?sig=a%2Fb";
    expect(safeDemoUrl({ available: true, url: valve })).toBe(valve);
    expect(safeDemoUrl({ available: true, url: faceit })).toBe(faceit);
  });
  it("refuses anything that is not a web link, and unavailable answers", () => {
    expect(safeDemoUrl({ available: true, url: "javascript:alert(1)" })).toBeNull();
    expect(safeDemoUrl({ available: true, url: "not a url" })).toBeNull();
    expect(safeDemoUrl({ available: false, url: "http://replay1.valve.net/x.dem.bz2" })).toBeNull();
    expect(safeDemoUrl(null)).toBeNull();
  });
});

describe("archive hints", () => {
  it("names the archive from the file, else from the source", () => {
    expect(demoArchiveKind({ source: "valve", filename: "003_1.dem.bz2" })).toBe(".dem.bz2");
    expect(demoArchiveKind({ source: "faceit", filename: "1-abc-1-1.dem.gz" })).toBe(".dem.gz");
    expect(demoArchiveKind({ source: "faceit" })).toBe(".dem.zst");
    expect(demoArchiveKind({})).toBe(".dem.bz2");
  });
});
