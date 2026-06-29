import type { LeetifyRecentMatch } from "@/lib/types";

// Counter-report map plan. Turns a player's recent matches into "pick these /
// ban these" advice that is honest about sample size and surfaces their most-
// played ("main") map — the comfort pick a raw win-rate sort hides.

export interface MapPlanRow {
  map: string;
  n: number; // games on this map
  w: number;
  l: number;
  pct: number; // raw win %
  adj: number; // sample-adjusted win % (shrunk toward 50)
}

export interface MapPlan {
  pick: MapPlanRow[]; // up to 3, weakest-first (sample-adjusted)
  ban: MapPlanRow[]; // up to 3, strongest-first (sample-adjusted)
  main: MapPlanRow | null; // most-played known map
  hasMain: boolean; // one map clearly dominates their play time
  mainStrong: boolean; // they're genuinely strong on the main, not just most-played
  hasSoftMap: boolean; // at least one genuinely losing map among the picks
  totalReal: number; // total recent games on known maps
}

// Pseudo-games at even odds (a coin-flip prior). A 7-1 (88%) on 8 games shrinks
// to ~71%, while a 29-16 (64%) on 45 games barely moves — so a small lucky run
// can't outrank a proven record.
const SHRINK = 6;
const adjOf = (w: number, n: number) => ((w + SHRINK * 0.5) / (n + SHRINK)) * 100;

export function computeMapPlan(
  recent: LeetifyRecentMatch[],
  minGames = 3,
): MapPlan {
  const byMap = new Map<string, { n: number; w: number }>();
  for (const m of recent) {
    const k = m.map_name || "unknown";
    const e = byMap.get(k) || { n: 0, w: 0 };
    e.n += 1;
    if (m.outcome === "win") e.w += 1;
    byMap.set(k, e);
  }

  const real: MapPlanRow[] = [...byMap.entries()]
    .filter(([map]) => map !== "unknown")
    .map(([map, e]) => ({
      map,
      n: e.n,
      w: e.w,
      l: e.n - e.w,
      pct: (e.w / e.n) * 100,
      adj: adjOf(e.w, e.n),
    }));

  const ranked = real.filter((e) => e.n >= minGames);
  const pick = [...ranked].sort((a, b) => a.adj - b.adj).slice(0, 3);
  const ban = [...ranked].sort((a, b) => b.adj - a.adj).slice(0, 3);

  // most-played map — flagged only when it clearly dominates the schedule, so a
  // 5/5/5 even split doesn't get a false "main".
  const byVolume = [...real].sort((a, b) => b.n - a.n);
  const totalReal = real.reduce((s, e) => s + e.n, 0);
  const main = byVolume[0] ?? null;
  const runnerUp = byVolume[1] ?? null;
  const hasMain =
    !!main && main.n >= 5 && (!runnerUp || main.n >= 1.5 * runnerUp.n);
  const mainStrong = !!main && main.adj >= 55;
  const hasSoftMap = pick.some((p) => p.adj < 50);

  return { pick, ban, main, hasMain, mainStrong, hasSoftMap, totalReal };
}
