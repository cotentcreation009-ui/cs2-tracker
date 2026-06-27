// Client-side account lookups for the demo Account-check panel. These run in the
// BROWSER, so they must hit our same-origin proxy (/api/players/{id}/{panel})
// rather than the gated backend directly — the proxy injects the internal token
// server-side. (The server-only lib/api.ts fetchers can't be used from a client
// component: API_BASE + the internal token are undefined in the browser.)
import type { FaceitProfile, LeetifyProfile, SteamExtras, SteamGameStats } from "@/lib/types";

async function panel<T>(steamId: string, name: string): Promise<T | null> {
  try {
    const res = await fetch(`/api/players/${encodeURIComponent(steamId)}/${name}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const clientFaceit = (id: string) => panel<FaceitProfile>(id, "faceit");
export const clientLeetify = (id: string) => panel<LeetifyProfile>(id, "leetify");
export const clientSteamExtras = (id: string) => panel<SteamExtras>(id, "steam-extras");
export const clientSteamStats = (id: string) => panel<SteamGameStats>(id, "steam-stats");
