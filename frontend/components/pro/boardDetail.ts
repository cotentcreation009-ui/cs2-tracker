// Readings for the board's hover and expand layers. Everything here is a
// re-phrasing of fields the feeds already carry — nothing is estimated.

import type { MatchState, ProTeam } from "./types";
import { dayGroup, formatTag, liveMap, mapsWon, startInfo } from "./format";

/** "Best of 3" from the feed's "best-of-3", else the short tag. */
export function prettyFormat(m: MatchState): string {
  const raw = m.formatName?.replace(/[-_]+/g, " ").trim();
  if (raw) return raw.charAt(0).toUpperCase() + raw.slice(1);
  return formatTag(m) || "Format not listed";
}

/** "Today 17:30 · in 34m", "Delayed · was 17:30", "Saturday, Sep 27 17:30 · in 2d". */
export function whenLabel(iso?: string): string {
  const { rel, abs, date, delayed } = startInfo(iso);
  if (!date) return "Time to be announced";
  if (delayed) return `Delayed · was ${abs}`;
  return `${dayGroup(date)} ${abs}${rel ? ` · ${rel}` : ""}`;
}

/** How long ago a finished series ended — the reading ResultRow gives. */
export function endedAgo(m: MatchState, now: number): string {
  const t = new Date(m.liveUpdatedAt ?? m.startScheduled ?? 0).getTime();
  if (!t) return "";
  const h = Math.max(0, Math.round((now - t) / 3_600_000));
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function streamHost(url: string): string {
  if (/twitch\.tv/i.test(url)) return "Twitch";
  if (/youtube\.com|youtu\.be/i.test(url)) return "YouTube";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Listed";
  }
}

export interface TeamContext {
  kind: "live" | "next";
  match: MatchState;
  opponent?: ProTeam;
  /** "8–6 on Inferno · Rd 15 · maps 1–1" (live) or "Today 17:30 · in 3h · Bo3" (next). */
  line: string;
}

/**
 * What a team is doing in the feed right now: its live series, else the next
 * one on the schedule (`upcoming` is in start order, so the first hit is it).
 */
export function teamContext(
  gridId: string | undefined,
  live: MatchState[],
  upcoming: MatchState[],
): TeamContext | null {
  if (!gridId) return null;
  const has = (m: MatchState) => m.teams?.some((t) => t.gridId === gridId) ?? false;

  const lm = live.find(has);
  if (lm) {
    const opponent = lm.teams?.find((t) => t.gridId !== gridId);
    const map = liveMap(lm);
    const us = map?.scoreByTeam?.[gridId] ?? mapsWon(lm, gridId);
    const them = opponent
      ? (map?.scoreByTeam?.[opponent.gridId] ?? mapsWon(lm, opponent.gridId))
      : 0;
    const parts = [map ? `${us}–${them} on ${map.mapName || `Map ${map.sequence}`}` : `${us}–${them}`];
    if (map?.currentRound) parts.push(`Rd ${map.currentRound}`);
    if ((lm.bestOf ?? 0) > 1 && opponent) {
      parts.push(`maps ${mapsWon(lm, gridId)}–${mapsWon(lm, opponent.gridId)}`);
    }
    return { kind: "live", match: lm, opponent, line: parts.join(" · ") };
  }

  const nm = upcoming.find(has);
  if (nm) {
    const opponent = nm.teams?.find((t) => t.gridId !== gridId);
    const tag = formatTag(nm);
    return {
      kind: "next",
      match: nm,
      opponent,
      line: [whenLabel(nm.startScheduled), tag].filter(Boolean).join(" · "),
    };
  }
  return null;
}
