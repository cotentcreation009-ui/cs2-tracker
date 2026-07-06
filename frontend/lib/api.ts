// Server-side client for the Go backend. All calls run from React Server
// Components (or route handlers), so the browser never talks to the backend
// directly and there is no CORS surface in normal use.
//
// API_INTERNAL_URL points at the backend from inside the network:
//   - docker compose:  http://backend:8080
//   - local dev:       http://localhost:8080

import type {
  FaceitProfile,
  Kill,
  LeaderboardEntry,
  LeetifyProfile,
  MapStat,
  SteamExtras,
  SteamGameStats,
  MatchDetail,
  PlayerMatchSummary,
  PlayerProfile,
  WeaponStat,
} from "./types";

export const API_BASE =
  process.env.API_INTERNAL_URL?.replace(/\/$/, "") || "http://localhost:8080";

// Sent on every server-side backend call. When the backend sets the matching
// INTERNAL_API_SECRET it rejects requests without this header, so only this
// (trusted, server-side) client can reach a publicly-hosted backend.
export const INTERNAL_TOKEN = process.env.INTERNAL_API_SECRET || "";

export function internalHeaders(): Record<string, string> {
  return INTERNAL_TOKEN ? { "X-Internal-Token": INTERNAL_TOKEN } : {};
}

// trustedClientIp extracts the real client IP from a header set by our own edge
// (Cloudflare's cf-connecting-ip), NOT the client-controllable X-Forwarded-For —
// so demo quotas can't be reset by spoofing XFF. Falls back to x-real-ip / the
// first XFF hop for non-CF deploys, and "" locally (backend then uses the
// connection IP). Forward the result as X-Real-IP, which chi's RealIP prefers.
export function trustedClientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? "";
  return "";
}

/** Raised when the backend returns a non-2xx response we want to handle. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Reads are cached for a short window so popular profiles (shared links are a
// bounded, highly-repeated keyspace) serve from the Next/CDN cache instead of
// re-hitting the backend + third-party APIs on every view. Pages that must be
// fresh per-request (e.g. compare, which reads searchParams) render dynamically
// and bypass this anyway.
const REVALIDATE_SECONDS = 60;

async function getJSON<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: internalHeaders(),
    });
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

// getLeetify fetches a player's live Leetify profile. It is supplementary, so
// any failure (no profile, unreachable, not configured) just returns null and
// the panel is hidden.
export async function getLeetify(
  steamId: string,
): Promise<LeetifyProfile | null> {
  try {
    return await getJSON<LeetifyProfile>(`/api/players/${steamId}/leetify`);
  } catch {
    return null;
  }
}

// getFaceit fetches a player's live FACEIT profile. Supplementary, so any
// failure (no key configured, no FACEIT account, unreachable) returns null and
// the panel is hidden.
export async function getFaceit(
  steamId: string,
): Promise<FaceitProfile | null> {
  try {
    return await getJSON<FaceitProfile>(`/api/players/${steamId}/faceit`);
  } catch {
    return null;
  }
}

// getSteamExtras fetches the CS2 friend code (+ best-effort friends/level).
// Supplementary, so failures return null.
export async function getSteamExtras(
  steamId: string,
): Promise<SteamExtras | null> {
  try {
    return await getJSON<SteamExtras>(`/api/players/${steamId}/steam-extras`);
  } catch {
    return null;
  }
}

// getSteamStats fetches a player's lifetime App 730 (CS2) stats. Supplementary,
// and only available for public-profile accounts, so failures return null.
export async function getSteamStats(
  steamId: string,
): Promise<SteamGameStats | null> {
  try {
    return await getJSON<SteamGameStats>(`/api/players/${steamId}/steam-stats`);
  } catch {
    return null;
  }
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

// resolveFaceitNickname maps a FACEIT nickname to a SteamID64 (via FACEIT's
// game_player_id). Used by the public/extension endpoint. Returns null on any
// failure (unknown nickname, no key, unreachable).
export async function resolveFaceitNickname(
  nickname: string,
): Promise<string | null> {
  try {
    const data = await getJSON<{ steamId64: string }>(
      `/api/faceit/resolve?nickname=${encodeURIComponent(nickname)}`,
    );
    return data.steamId64 || null;
  } catch {
    return null;
  }
}
