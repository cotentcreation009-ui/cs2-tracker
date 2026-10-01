import type { FaceitRankedPlayer } from "@/lib/types";

// Pure helpers behind the homepage's "Top FACEIT players" strip, kept out of
// the components so vitest can pin them (nothing in the component tree is
// ever rendered in tests).

// FACEIT's own region codes. Kept in step with the allowlist in
// backend/internal/faceit/rankings.go — the backend refuses anything else
// with a 400 before touching its cache. A plain const (not the pro board's
// copy) because that module is "use client" and this list is read by the
// server component too.
export const REGIONS = [
  { code: "EU", label: "Europe" },
  { code: "NA", label: "N. America" },
  { code: "SA", label: "S. America" },
  { code: "AS", label: "Asia" },
  { code: "OCE", label: "Oceania" },
] as const;

export type RegionCode = (typeof REGIONS)[number]["code"];

export const DEFAULT_REGION: RegionCode = "EU";

// Per-viewer convenience only: the last region pill a visitor picked. Read in
// an effect after mount, so the server HTML is always the default region.
export const REGION_STORAGE_KEY = "cs2:faceit-region";

export function regionLabel(code: string): string {
  return REGIONS.find((r) => r.code === code)?.label ?? code;
}

// rowHref decides where a row goes: the CSRun profile when FACEIT told us the
// player's SteamID64, else out to their FACEIT page. null when neither is
// known (the row still renders; it just is not a link).
export function rowHref(
  row: Pick<FaceitRankedPlayer, "steamId64" | "faceitUrl">,
): { href: string; external: boolean } | null {
  if (row.steamId64 && /^\d{17}$/.test(row.steamId64)) {
    return { href: `/profiles/${row.steamId64}`, external: false };
  }
  if (row.faceitUrl) return { href: row.faceitUrl, external: true };
  return null;
}

// pickRegion is the island's first choice: the stored pick when that region
// has data, else the default region, else whatever is available.
export function pickRegion(
  stored: string | null | undefined,
  available: readonly string[],
): string {
  if (stored && available.includes(stored)) return stored;
  if (available.includes(DEFAULT_REGION)) return DEFAULT_REGION;
  return available[0] ?? DEFAULT_REGION;
}

// splitColumns lays ten rows out as 1–5 | 6–10 (an odd count puts the extra
// row in the first column), so the left column always reads top-down from #1.
export function splitColumns<T>(rows: readonly T[]): [T[], T[]] {
  const half = Math.ceil(rows.length / 2);
  return [rows.slice(0, half), rows.slice(half)];
}

// asOfLabel says how current the snapshot is, from the moment FACEIT was
// ASKED (never the response time). A stale copy says so. An unusable stamp
// (missing, unparseable, Go's zero time) reads as nothing rather than as a
// fake date. The day is added when the stamp is not from today (UTC), which
// only a stale copy can be.
export function asOfLabel(
  fetchedAt: string | null | undefined,
  stale: boolean | undefined,
  now: number = Date.now(),
): string {
  if (!fetchedAt) return "";
  const t = new Date(fetchedAt);
  const ms = t.getTime();
  if (Number.isNaN(ms) || ms <= 0) return "";
  const hh = String(t.getUTCHours()).padStart(2, "0");
  const mm = String(t.getUTCMinutes()).padStart(2, "0");
  let stamp = `${hh}:${mm} UTC`;
  const today = new Date(now);
  if (
    t.getUTCFullYear() !== today.getUTCFullYear() ||
    t.getUTCMonth() !== today.getUTCMonth() ||
    t.getUTCDate() !== today.getUTCDate()
  ) {
    const day = t.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
    stamp = `${day}, ${stamp}`;
  }
  return stale
    ? `last refreshed ${stamp} · FACEIT isn't answering right now`
    : `as of ${stamp}`;
}

// initialOf is the letter on the tile when FACEIT sent no avatar. Array.from
// so a nickname that starts with an emoji or a CJK character keeps the whole
// code point instead of half a surrogate pair.
export function initialOf(nick: string): string {
  return Array.from(nick.trim())[0]?.toUpperCase() ?? "?";
}

export function levelTitle(level?: number): string {
  return level && level > 0 ? `FACEIT level ${level}` : "FACEIT level unknown";
}
