import type { LeetifyRecentMatch } from "@/lib/types";

// Splits a player's recent matches by platform (Premier / FACEIT / MM) and
// aggregates the per-match performance + aim stats for each, so a lopsided
// player — sharp on one platform, ordinary on another — is obvious at a glance.
// The rating gap uses the SAME definition as the CheatMeter's cross-platform
// factor (Valve official avg rating − FACEIT avg rating) so the two agree.

export interface PlatformStat {
  key: string; // data_source key
  label: string;
  n: number;
  winPct: number;
  avgRating: number; // Leetify rating (can be negative)
  avgPreaim: number; // degrees, lower = tighter (0 = no data)
  avgReaction: number; // ms, lower = faster (0 = no data)
  avgHs: number; // head-accuracy %, 0 = no data
  avgSpray: number; // spray-accuracy %, 0 = no data
}

export type Verdict =
  | "consistent"
  | "stronger-valve"
  | "stronger-faceit"
  | "insufficient";

export interface PlatformSplit {
  stats: PlatformStat[]; // platforms with >= MIN_N matches, Premier → FACEIT → MM
  faceit: PlatformStat | null;
  official: PlatformStat | null; // Premier + MM combined (Valve official)
  ratingGap: number | null; // official.avgRating − faceit.avgRating (both >= MIN_N)
  verdict: Verdict;
  comparable: boolean; // both sides have >= MIN_N matches
}

// Minimum matches on a platform for its averages to mean anything.
export const MIN_N = 3;
// A Leetify-rating gap beyond this reads as a real cross-platform discrepancy.
export const GAP_THRESHOLD = 0.25;

function statFor(
  key: string,
  label: string,
  ms: LeetifyRecentMatch[],
): PlatformStat | null {
  if (!ms.length) return null;
  const n = ms.length;
  const mean = (f: (m: LeetifyRecentMatch) => number) =>
    ms.reduce((a, m) => a + f(m), 0) / n;
  // aim metrics use 0 as a "missing" sentinel, so average only positive values
  const meanPos = (f: (m: LeetifyRecentMatch) => number) => {
    const v = ms.map(f).filter((x) => x > 0);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  };
  const w = ms.filter((m) => m.outcome === "win").length;
  return {
    key,
    label,
    n,
    winPct: (w / n) * 100,
    avgRating: mean((m) => m.leetify_rating),
    avgPreaim: meanPos((m) => m.preaim),
    avgReaction: meanPos((m) => m.reaction_time_ms),
    avgHs: meanPos((m) => m.accuracy_head),
    avgSpray: meanPos((m) => m.spray_accuracy),
  };
}

export function computePlatformSplit(recent: LeetifyRecentMatch[]): PlatformSplit {
  const by = (k: string) => recent.filter((m) => m.data_source === k);
  const premier = statFor("premier", "Premier", by("premier"));
  const faceit = statFor("faceit", "FACEIT", by("faceit"));
  const mm = statFor("matchmaking", "MM", by("matchmaking"));

  // Valve official = Premier + MM (what a cheat with weak VAC would inflate,
  // vs FACEIT's kernel anti-cheat).
  const official = statFor(
    "official",
    "Valve",
    recent.filter(
      (m) => m.data_source === "premier" || m.data_source === "matchmaking",
    ),
  );

  const stats = [premier, faceit, mm].filter(
    (s): s is PlatformStat => s != null && s.n >= MIN_N,
  );

  let ratingGap: number | null = null;
  let verdict: Verdict = "insufficient";
  let comparable = false;
  if (official && faceit && official.n >= MIN_N && faceit.n >= MIN_N) {
    comparable = true;
    ratingGap = official.avgRating - faceit.avgRating;
    verdict =
      Math.abs(ratingGap) < GAP_THRESHOLD
        ? "consistent"
        : ratingGap > 0
          ? "stronger-valve"
          : "stronger-faceit";
  }

  return { stats, faceit, official, ratingGap, verdict, comparable };
}
