import { describe, expect, it } from "vitest";
import { routeForQuery } from "@/lib/searchRoute";

describe("routeForQuery", () => {
  it("sends a pasted profile URL to the same page here", () => {
    expect(
      routeForQuery("https://steamcommunity.com/profiles/76561198077030352"),
    ).toBe("/profiles/76561198077030352");
    expect(routeForQuery("https://steamcommunity.com/id/gaben/")).toBe(
      "/id/gaben",
    );
    // Case-insensitive host/segment, and a trailing query or hash is not part
    // of the name.
    expect(routeForQuery("STEAMCOMMUNITY.COM/ID/GabeN?l=en#x")).toBe(
      "/id/GabeN",
    );
  });

  it("treats seventeen digits as a SteamID64", () => {
    expect(routeForQuery(" 76561198077030352 ")).toBe(
      "/profiles/76561198077030352",
    );
  });

  it("treats anything else as a vanity name, URL-encoded", () => {
    expect(routeForQuery("gaben")).toBe("/id/gaben");
    expect(routeForQuery("7656119807703035")).toBe("/id/7656119807703035"); // 16 digits
    expect(routeForQuery("a b/c")).toBe("/id/a%20b%2Fc");
  });

  it("goes nowhere on a blank query", () => {
    expect(routeForQuery("")).toBeNull();
    expect(routeForQuery("   ")).toBeNull();
  });
});
