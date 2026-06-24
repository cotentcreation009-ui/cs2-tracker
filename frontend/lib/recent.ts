import type { PlayerHit } from "@/lib/types";

// Recently-viewed players, persisted client-side so the search box and homepage
// can offer quick re-access (turns a cold lookup tool into a sticky one).
const KEY = "cs2:recent-players";
const MAX = 8;

export function getRecentPlayers(): PlayerHit[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PlayerHit[]) : [];
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
