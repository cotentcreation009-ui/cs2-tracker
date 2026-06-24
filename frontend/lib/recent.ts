import type { PlayerHit } from "@/lib/types";

// Recently-viewed players, persisted client-side so the search box and homepage
// can offer quick re-access (turns a cold lookup tool into a sticky one).
const KEY = "cs2:recent-players";
const MAX = 8;

export function getRecentPlayers(): PlayerHit[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return []; // guard against a malformed/stale value
    return parsed.filter(
      (p): p is PlayerHit => !!p && typeof p.steamId64 === "string",
    );
  } catch {
    return [];
  }
}

export function pushRecentPlayer(p: PlayerHit): void {
  if (typeof window === "undefined" || !p.steamId64) return;
  try {
    const list = getRecentPlayers().filter((x) => x.steamId64 !== p.steamId64);
    list.unshift({
      steamId64: p.steamId64,
      personaName: p.personaName,
      avatarUrl: p.avatarUrl,
    });
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* storage full / disabled — ignore */
  }
}
