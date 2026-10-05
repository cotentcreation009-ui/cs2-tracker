// The demo-download link for a match listed on a profile. The server resolves
// WHERE the demo is (a Valve replay URL or a FACEIT signed link); the browser
// then fetches the file from that host directly.

/** What `/api/profiles/{id}/leetify-game/{game}/demo` answers. */
export interface DemoLink {
  available: boolean;
  url?: string;
  source?: "valve" | "faceit";
  filename?: string;
  /** When Valve stops hosting the replay (RFC 3339); absent for FACEIT. */
  expires_at?: string;
  /** A sentence for the player, and its machine-readable twin. */
  reason?: string;
  code?: string;
  /** The FACEIT match room, where the demo can be fetched by hand. */
  room_url?: string;
}

// How long Valve keeps GOTV replays — the same month the server applies.
export const VALVE_REPLAY_MAX_AGE_MS = 31 * 24 * 3600 * 1000;

export const VALVE_EXPIRED_REASON =
  "Valve no longer hosts this demo (older than about a month).";

/** True when a Valve (non-FACEIT) game is past Valve's replay window. */
export function valveReplayExpired(
  dataSource: string,
  finishedAt: string,
  now: number = Date.now(),
): boolean {
  if (dataSource === "faceit") return false;
  const age = now - new Date(finishedAt).getTime();
  return Number.isFinite(age) && age > VALVE_REPLAY_MAX_AGE_MS;
}

/**
 * The endpoint to ask. The row's finish time and score ride along because
 * legacy-format games can only be found by matching them against the player's
 * Steam match list; the server ignores them for everything else.
 */
export function demoLinkEndpoint(
  steamId: string,
  gameId: string,
  row: { finishedAt?: string; score?: number[] } = {},
): string {
  const q = new URLSearchParams();
  if (row.finishedAt) q.set("finishedAt", row.finishedAt);
  if (row.score?.length === 2) q.set("score", `${row.score[0]}-${row.score[1]}`);
  const qs = q.toString();
  return `/api/profiles/${encodeURIComponent(steamId)}/leetify-game/${encodeURIComponent(gameId)}/demo${qs ? `?${qs}` : ""}`;
}

/** The link, if it is one a browser should be sent to (http or https only). */
export function safeDemoUrl(link: DemoLink | null | undefined): string | null {
  if (!link?.available || !link.url) return null;
  try {
    const u = new URL(link.url);
    return u.protocol === "https:" || u.protocol === "http:" ? link.url : null;
  } catch {
    return null;
  }
}

/**
 * Valve serves replays over plain http only. Browsers may hold back a download
 * an https page starts from an http host, so those links come with a
 * copy-the-link way out.
 */
export function isPlainHttp(url: string): boolean {
  return url.startsWith("http://");
}

/** The archive type a link delivers, for the tooltip and the started note. */
export function demoArchiveKind(link: Pick<DemoLink, "source" | "filename">): string {
  const name = (link.filename ?? "").toLowerCase();
  for (const ext of [".dem.bz2", ".dem.zst", ".dem.gz", ".dem"]) {
    if (name.endsWith(ext)) return ext;
  }
  return link.source === "faceit" ? ".dem.zst" : ".dem.bz2";
}
