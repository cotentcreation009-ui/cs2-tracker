// Session-lifetime cache for per-player account lookups + AI reads. The
// Cheat/AI tab unmounts whenever the user switches lens, which used to throw
// away every "Account check" result and paid-for AI write-up; this module map
// keeps them for the life of the page so re-opening the tab is instant and the
// AI endpoint is never re-billed for the same subject. Also dedupes in-flight
// lookups so "Check all" + a manual click can't double-fetch.

import { accountScores, type AccountScores } from "./account";
import {
  clientFaceit,
  clientSteamExtras,
  clientSteamStats,
  clientLeetify,
} from "./accountClient";

const scoresCache = new Map<string, AccountScores>();
const inflight = new Map<string, Promise<AccountScores>>();

export function cachedAccountScores(steamId: string): AccountScores | null {
  return scoresCache.get(steamId) ?? null;
}

export function fetchAccountScores(steamId: string): Promise<AccountScores> {
  const hit = scoresCache.get(steamId);
  if (hit) return Promise.resolve(hit);
  const running = inflight.get(steamId);
  if (running) return running;
  const p = Promise.all([
    clientFaceit(steamId).catch(() => null),
    clientSteamExtras(steamId).catch(() => null),
    clientSteamStats(steamId).catch(() => null),
    clientLeetify(steamId).catch(() => null),
  ])
    .then(([faceit, extras, steamStats, leetify]) => {
      const s = accountScores(faceit, extras, steamStats, leetify);
      // Only cache real data: an all-null result can be a transient backend
      // blip (every client fetch soft-fails to null), and caching it would
      // pin "no public data" for the whole session with no retry path.
      if (s.hasData) scoresCache.set(steamId, s);
      inflight.delete(steamId);
      return s;
    })
    .catch((e) => {
      inflight.delete(steamId);
      throw e;
    });
  inflight.set(steamId, p);
  return p;
}

// AI write-ups (player reads keyed by steamId, match reads keyed by "match:…").
const aiCache = new Map<string, string>();

export function getAiRead(key: string): string | null {
  return aiCache.get(key) ?? null;
}
export function setAiRead(key: string, text: string): void {
  aiCache.set(key, text);
}
