import { describe, expect, it } from "vitest";
import { firstId } from "./firstId";

const after = <T,>(ms: number, v: T): Promise<T> =>
  new Promise((r) => setTimeout(() => r(v), ms));

describe("firstId", () => {
  it("does not wait for a hanging source that has nothing to say", async () => {
    // The bug this exists to prevent: the server card lookup hangs until the
    // backend's 5s deadline and then answers "not found", so awaiting it
    // before the browser lookup sat on a spinner for five seconds.
    const t0 = Date.now();
    const got = await firstId([after(300, null), after(5, "76561198386265483")]);
    expect(got).toBe("76561198386265483");
    expect(Date.now() - t0).toBeLessThan(250);
  });

  it("keeps waiting when the fastest source answers empty", async () => {
    // The mirror-image bug: Promise.race would settle on the quick null and
    // throw away the answer the slower source was about to give.
    const got = await firstId([after(1, null), after(40, "76561197989430253")]);
    expect(got).toBe("76561197989430253");
  });

  it("returns null only once every source has come back empty", async () => {
    expect(await firstId([after(1, null), after(20, null)])).toBeNull();
  });

  it("treats a rejected source as empty rather than failing the lookup", async () => {
    const boom = Promise.reject(new Error("offline"));
    expect(await firstId([boom, after(10, "76561198113666193")])).toBe(
      "76561198113666193",
    );
  });

  it("gives up when every source rejects", async () => {
    expect(
      await firstId([Promise.reject(new Error("a")), Promise.reject(new Error("b"))]),
    ).toBeNull();
  });

  it("has no source to ask", async () => {
    expect(await firstId([])).toBeNull();
  });
});
