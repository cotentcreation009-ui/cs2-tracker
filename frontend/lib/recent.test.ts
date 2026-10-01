import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRecentPlayers,
  getRecentPlayers,
  pushRecentPlayer,
  subscribeRecent,
} from "@/lib/recent";

// The recently-viewed list is the one piece of the homepage that is the
// visitor's own: localStorage, this browser, never the server. These pin the
// contract its readers rely on — the cap, the de-dup, that garbage reads as
// empty rather than throwing, and that Clear reaches every reader at once.

const KEY = "cs2:recent-players";

function fakeWindow() {
  const store = new Map<string, string>();
  const listeners = new Map<string, Set<() => void>>();
  const win = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    dispatchEvent: vi.fn((ev: { type: string }) => {
      listeners.get(ev.type)?.forEach((cb) => cb());
      return true;
    }),
    addEventListener: (type: string, cb: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(cb);
    },
    removeEventListener: (type: string, cb: () => void) => {
      listeners.get(type)?.delete(cb);
    },
  };
  return { win, store };
}

const hit = (n: number) => ({
  steamId64: `7656119800000000${n}`,
  personaName: `p${n}`,
  avatarUrl: "",
});

describe("recent players", () => {
  let store: Map<string, string>;
  let win: ReturnType<typeof fakeWindow>["win"];

  beforeEach(() => {
    ({ win, store } = fakeWindow());
    vi.stubGlobal("window", win);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is empty without a window (server render)", () => {
    vi.stubGlobal("window", undefined);
    expect(getRecentPlayers()).toEqual([]);
    expect(() => pushRecentPlayer(hit(1))).not.toThrow();
    expect(() => clearRecentPlayers()).not.toThrow();
    expect(subscribeRecent(() => {})).toBeTypeOf("function");
  });

  it("keeps the newest eight, newest first", () => {
    for (let i = 1; i <= 10; i++) pushRecentPlayer(hit(i));
    const list = getRecentPlayers();
    expect(list).toHaveLength(8);
    expect(list[0].personaName).toBe("p10");
    expect(list[7].personaName).toBe("p3");
  });

  it("moves a re-viewed player to the front instead of duplicating it", () => {
    pushRecentPlayer(hit(1));
    pushRecentPlayer(hit(2));
    pushRecentPlayer(hit(1));
    const list = getRecentPlayers();
    expect(list.map((p) => p.personaName)).toEqual(["p1", "p2"]);
  });

  it("reads malformed storage as empty", () => {
    store.set(KEY, "{not json");
    expect(getRecentPlayers()).toEqual([]);
    store.set(KEY, JSON.stringify({ steamId64: "x" })); // not an array
    expect(getRecentPlayers()).toEqual([]);
    store.set(KEY, JSON.stringify([null, { personaName: "no id" }, hit(4)]));
    expect(getRecentPlayers().map((p) => p.personaName)).toEqual(["p4"]);
  });

  it("clear removes the key and tells every subscriber", () => {
    pushRecentPlayer(hit(1));
    const seen = vi.fn();
    const off = subscribeRecent(seen);
    clearRecentPlayers();
    expect(store.has(KEY)).toBe(false);
    expect(getRecentPlayers()).toEqual([]);
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    pushRecentPlayer(hit(2));
    expect(seen).toHaveBeenCalledTimes(1); // unsubscribed
  });

  it("a push notifies too, so the search box and the strip agree", () => {
    const seen = vi.fn();
    subscribeRecent(seen);
    pushRecentPlayer(hit(1));
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
