// The matches column's two views and the readings its Results view needs.
// Pure functions, so the view switch, the URL it is kept in and the order of
// the results are pinned by tests without rendering anything.

import type { MatchState, ProTeam } from "./types";

/** "board" is the live + upcoming page the reader lands on; "results" lists
 * what has finished. */
export type BoardView = "board" | "results";

/** The query parameter the view lives in (`?view=results`), so a link to the
 * results survives a reload and can be shared. The default has no parameter. */
export const VIEW_PARAM = "view";

/** How long the backend keeps a finished series on the feed: `prune` in
 * backend/internal/grid/poller.go drops one 48 h after Central last listed it.
 * The UI says this number, so change both together. */
export const RESULTS_WINDOW_HOURS = 48;

/** The view a location's query string asks for; anything but `view=results`
 * is the board, so a mistyped value cannot blank the page. */
export function parseBoardView(search: string): BoardView {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return params.get(VIEW_PARAM) === "results" ? "results" : "board";
}

/** The query string for `view`, keeping every other parameter: "?view=results",
 * or the others alone (an empty string when there are none) for the board. */
export function withBoardView(search: string, view: BoardView): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (view === "results") params.set(VIEW_PARAM, "results");
  else params.delete(VIEW_PARAM);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** When a series ended, as epoch millis: the feed's last state update (GRID
 * stops updating a series when it finishes), else its scheduled start. 0 when
 * neither is usable. */
export function endedAt(m: MatchState): number {
  const t = new Date(m.liveUpdatedAt ?? m.startScheduled ?? 0).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** The finished series with both teams known, newest first. Rows without two
 * teams have nothing to show (a forfeited or malformed series). */
export function sortFinished(matches: MatchState[]): MatchState[] {
  return matches
    .filter((m) => m.status === "finished" && (m.teams?.length ?? 0) === 2)
    .sort((x, y) => endedAt(y) - endedAt(x));
}

export interface SeriesResult {
  a?: ProTeam;
  b?: ProTeam;
  /** Maps won, in the teams' order. */
  sa: number;
  sb: number;
  /** The team that took the series: the feed's own call when it made one,
   * else whoever won more maps; null for a tie or an unscored series. */
  winner: ProTeam | null;
}

/** Both teams, the final map score and the winner of a finished series. */
export function seriesResult(m: MatchState): SeriesResult {
  const a = m.teams?.[0];
  const b = m.teams?.[1];
  const sa = m.seriesScore?.[a?.gridId ?? ""] ?? 0;
  const sb = m.seriesScore?.[b?.gridId ?? ""] ?? 0;
  let winner: ProTeam | null = null;
  if (m.seriesWinner && a?.gridId === m.seriesWinner) winner = a;
  else if (m.seriesWinner && b?.gridId === m.seriesWinner) winner = b;
  else if (sa > sb) winner = a ?? null;
  else if (sb > sa) winner = b ?? null;
  return { a, b, sa, sb, winner };
}

/** "just now", "3h ago", "2d ago" — how long ago a finished series ended, or
 * "" when the feed gave no time at all. Hours are rounded, so a series that
 * ended 40 minutes ago reads "1h ago" rather than a false-precision "0h". */
export function endedAgo(m: MatchState, now: number): string {
  const t = endedAt(m);
  if (!t) return "";
  const h = Math.max(0, Math.round((now - t) / 3_600_000));
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** "Ancient 13–11 · Anubis 16–14": every map that was played, in order, with
 * the score in the teams' order. Empty when the feed carries no map detail. */
export function mapsLine(m: MatchState): string {
  const { a, b } = seriesResult(m);
  return (m.maps ?? [])
    .filter((x) => x.started || x.finished)
    .map((x) => {
      const name = x.mapName || `Map ${x.sequence}`;
      const sa = a ? (x.scoreByTeam?.[a.gridId] ?? 0) : 0;
      const sb = b ? (x.scoreByTeam?.[b.gridId] ?? 0) : 0;
      return `${name} ${sa}–${sb}`;
    })
    .join(" · ");
}
