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

/** mm:ss round clock. */
export function clockLabel(seconds?: number): string {
  if (seconds == null || seconds < 0 || Number.isNaN(seconds)) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Relative + absolute start time for an upcoming match. */
export function startInfo(iso?: string): {
  rel: string;
  abs: string;
  date: Date | null;
} {
  if (!iso) return { rel: "", abs: "", date: null };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { rel: "", abs: "", date: null };
  const abs = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const mins = Math.round((d.getTime() - Date.now()) / 60000);
  let rel: string;
  if (mins <= 0) rel = "starting soon";
  else if (mins < 60) rel = `in ${mins}m`;
  else {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h < 24) rel = m ? `in ${h}h ${m}m` : `in ${h}h`;
    else rel = `in ${Math.floor(h / 24)}d`;
  }
  return { rel, abs, date: d };
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

/** A short "Bo3" style tag, best-effort from whatever the feed gave us. */
export function formatTag(m: MatchState): string {
  if (m.formatShort) return m.formatShort;
  if (m.bestOf && m.bestOf > 0) return `Bo${m.bestOf}`;
  return m.formatName ?? "";
}
