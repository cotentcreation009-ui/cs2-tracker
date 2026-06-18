// Server-side client for the Go backend. All calls run from React Server
// Components (or route handlers), so the browser never talks to the backend
// directly and there is no CORS surface in normal use.
//
// API_INTERNAL_URL points at the backend from inside the network:
//   - docker compose:  http://backend:8080
//   - local dev:       http://localhost:8080

import type {
  Kill,
  LeaderboardEntry,
  MapStat,
  MatchDetail,
  PlayerMatchSummary,
  PlayerProfile,
  WeaponStat,
} from "./types";

export const API_BASE =
  process.env.API_INTERNAL_URL?.replace(/\/$/, "") || "http://localhost:8080";

/** Raised when the backend returns a non-2xx response we want to handle. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function getJSON<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  } catch (err) {
    throw new ApiError(
      0,
      `cannot reach backend at ${API_BASE} (${(err as Error).message})`,
    );
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export function getProfile(steamId: string): Promise<PlayerProfile> {
  return getJSON<PlayerProfile>(`/api/players/${steamId}`);
}

export async function getPlayerMatches(
  steamId: string,
  limit = 20,
): Promise<PlayerMatchSummary[]> {
  const data = await getJSON<{ matches: PlayerMatchSummary[] }>(
    `/api/players/${steamId}/matches?limit=${limit}`,
  );
  return data.matches ?? [];
}

export function getMatch(id: string | number): Promise<MatchDetail> {
  return getJSON<MatchDetail>(`/api/matches/${id}`);
}

export async function getWeaponStats(
  steamId: string,
  limit = 12,
): Promise<WeaponStat[]> {
  const data = await getJSON<{ weapons: WeaponStat[] }>(
    `/api/players/${steamId}/weapons?limit=${limit}`,
  );
  return data.weapons ?? [];
}

export async function getMapStats(steamId: string): Promise<MapStat[]> {
  const data = await getJSON<{ maps: MapStat[] }>(
    `/api/players/${steamId}/maps`,
  );
  return data.maps ?? [];
}

export async function getMatchKills(id: string | number): Promise<Kill[]> {
  const data = await getJSON<{ kills: Kill[] }>(`/api/matches/${id}/kills`);
  return data.kills ?? [];
}

export async function getLeaderboard(limit = 25): Promise<LeaderboardEntry[]> {
  const data = await getJSON<{ players: LeaderboardEntry[] }>(
    `/api/leaderboard?limit=${limit}`,
  );
  return data.players ?? [];
}

export async function resolveSteamId(query: string): Promise<string> {
  const data = await getJSON<{ steamId64: string }>(
    `/api/resolve?q=${encodeURIComponent(query)}`,
  );
  return data.steamId64;
}
