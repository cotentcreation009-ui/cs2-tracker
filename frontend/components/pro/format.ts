// Presentation helpers for the pro-matches board. All of this renders
// client-side, so using the viewer's local timezone is correct and can't cause
// a hydration mismatch.

import type { MatchState, ProMap } from "./types";

// CS2 side colours from the brand palette (CT = light blue, T = gold).
export const CT_HEX = "#9cc1ff";
export const T_HEX = "#f0cd78";

export function sideHex(side?: string): string | null {
  const s = (side || "").toUpperCase();
  if (s === "CT") return CT_HEX;
  if (s === "T") return T_HEX;
  return null;
}

// Only trust well-formed hex colours from the feed; everything else falls back
// to theme defaults at the call site.
export function validHex(c?: string): string | null {
  return c && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c) ? c : null;
}

// Black or white — whichever stays legible on top of `hex` (for initials on a
// team-colour badge). Uses perceived luminance.
export function readableOn(hex: string): string {
  const h = hex.replace("#", "");
  const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(f.slice(0, 2), 16);
  const g = parseInt(f.slice(2, 4), 16);
  const b = parseInt(f.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#0a0e17" : "#ffffff";
}

/** Two colors that IDENTIFY the two teams on a dark card: brand colors when
 * they work, resolved to distinct fallbacks when one is missing, too dark to
 * see, or both landed on near-identical hues (real case: a missing
 * colorPrimary fell back to the same amber as the opponent's brand, rendering
 * a split bar as one solid color). */
export function teamBarColors(aIn?: string, bIn?: string): [string, string] {
  const usable = (h?: string): string | null => {
    const v = validHex(h);
    if (!v) return null;
    const n = v.replace("#", "");
    const r = parseInt(n.slice(0, 2), 16);
    const g = parseInt(n.slice(2, 4), 16);
    const bl = parseInt(n.slice(4, 6), 16);
    // relative-luminance floor — near-black brand colors vanish on the card
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl < 46 ? null : v;
  };
  const dist = (h1: string, h2: string) => {
    const p = (h: string, i: number) => parseInt(h.replace("#", "").slice(i, i + 2), 16);
    return Math.abs(p(h1, 0) - p(h2, 0)) + Math.abs(p(h1, 2) - p(h2, 2)) + Math.abs(p(h1, 4) - p(h2, 4));
  };
  const a = usable(aIn) ?? "#5b9dff";
  let b = usable(bIn) ?? "#e7b53c";
  if (dist(a, b) < 140) b = dist(a, "#e7b53c") < 140 ? "#38d6ff" : "#e7b53c";
  return [a, b];
}

/** mm:ss round clock. */
export function clockLabel(seconds?: number): string {
  if (seconds == null || seconds < 0 || Number.isNaN(seconds)) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Relative + absolute start time for an upcoming match. `delayed` means the
 * scheduled slot passed >15 minutes ago with the match still not live — routine
 * in CS2 (series wait on the previous match), and far more honest than showing
 * "starting soon" in red for hours. */
export function startInfo(iso?: string): {
  rel: string;
  abs: string;
  date: Date | null;
  delayed: boolean;
} {
  if (!iso) return { rel: "", abs: "", date: null, delayed: false };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { rel: "", abs: "", date: null, delayed: false };
  const abs = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const mins = Math.round((d.getTime() - Date.now()) / 60000);
  let rel: string;
  let delayed = false;
  if (mins <= -15) {
    rel = "delayed";
    delayed = true;
  } else if (mins <= 0) rel = "starting soon";
  else if (mins < 60) rel = `in ${mins}m`;
  else {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h < 24) rel = m ? `in ${h}h ${m}m` : `in ${h}h`;
    else rel = `in ${Math.floor(h / 24)}d`;
  }
  return { rel, abs, date: d, delayed };
}

/** Bucket an upcoming start into Today / Tomorrow / weekday-date. */
export function dayGroup(d: Date): string {
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const delta = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
  if (delta <= 0) return "Today";
  if (delta === 1) return "Tomorrow";
  return d.toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/** Short "Ns ago" freshness label. */
export function agoShort(iso?: string, now: number = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

/** Maps won by a team in the series (0 when upcoming/omitted). */
export function mapsWon(m: MatchState, gridId?: string): number {
  if (!gridId) return 0;
  return m.seriesScore?.[gridId] ?? 0;
}

/** The map currently in progress (falls back to the last started map). */
export function liveMap(m: MatchState): ProMap | undefined {
  const maps = m.maps ?? [];
  if (m.currentMap != null) {
    const bySeq = maps.find((x) => x.sequence === m.currentMap);
    if (bySeq) return bySeq;
  }
  return (
    maps.find((x) => x.started && !x.finished) ??
    [...maps].reverse().find((x) => x.started)
  );
}

/** Map-point / match-point state for a live map — the moments that make a fan
 * click through NOW. CS2 MR12: regulation is first to 13; 12–12 goes to MR3
 * overtimes (first to 16, then 19, …), so the leader is one round from taking
 * the map exactly when score ≥ 12, ahead, and (score − 12) % 3 === 0. It's
 * MATCH point when that map would also close out the series. */
export function pointState(
  m: MatchState,
  map?: ProMap,
): { kind: "map" | "match"; teamId: string } | null {
  if (!map || !map.started || map.finished) return null;
  const score = map.scoreByTeam ?? {};
  const ids = Object.keys(score);
  if (ids.length < 2) return null;
  const [s1, s2] = [score[ids[0]] ?? 0, score[ids[1]] ?? 0];
  if (s1 === s2) return null;
  const leader = s1 > s2 ? ids[0] : ids[1];
  const top = Math.max(s1, s2);
  if (top < 12 || (top - 12) % 3 !== 0) return null;
  const need = Math.floor((m.bestOf || 1) / 2) + 1;
  const wonMaps = m.seriesScore?.[leader] ?? 0;
  return { kind: wonMaps + 1 >= need ? "match" : "map", teamId: leader };
}

/** A short "Bo3" style tag, best-effort from whatever the feed gave us. */
export function formatTag(m: MatchState): string {
  if (m.formatShort) return m.formatShort;
  if (m.bestOf && m.bestOf > 0) return `Bo${m.bestOf}`;
  return m.formatName ?? "";
}
