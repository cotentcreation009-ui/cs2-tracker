import { describe, it, expect } from "vitest";
import { ageMs } from "@/lib/format";

// The age the Leetify panel shows for a stale copy comes from here. A stamp
// the backend never set must read as "unknown", never as an age: Go's zero
// time is a valid date two thousand years back, and a plain Date parse turned
// it into "Last updated 2025y ago" on fresh data.
describe("ageMs", () => {
  const now = Date.parse("2026-09-30T12:00:00Z");

  it("measures a real stamp", () => {
    expect(ageMs("2026-09-30T09:00:00Z", now)).toBe(3 * 60 * 60 * 1000);
  });

  it("is unknown when the stamp is missing", () => {
    expect(ageMs(undefined, now)).toBeNull();
    expect(ageMs(null, now)).toBeNull();
    expect(ageMs("", now)).toBeNull();
  });

  it("is unknown for Go's zero time and anything up to the epoch", () => {
    expect(ageMs("0001-01-01T00:00:00Z", now)).toBeNull();
    expect(ageMs("1969-12-31T23:59:59Z", now)).toBeNull();
    expect(ageMs("1970-01-01T00:00:00Z", now)).toBeNull();
  });

  it("is unknown for garbage", () => {
    expect(ageMs("not a date", now)).toBeNull();
  });
});
