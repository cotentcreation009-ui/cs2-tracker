import type { LeetifyRecentMatch } from "@/lib/types";

// Premier-vs-FACEIT split. Compares a player's Premier matches (rank_type 11 —
// Leetify tags these data_source "matchmaking" but the rating type is what makes
// them Premier) against their FACEIT matches (data_source "faceit"). MM
// Competitive, Wingman and everything else are deliberately excluded — this is
// specifically Premier vs FACEIT (Valve's VAC vs FACEIT's kernel anti-cheat).
//
// Each side is bucketed across the WHOLE match pool, so FACEIT still shows even
// if the player hasn't queued it recently; `limit` then caps how many of each
// platform's most-recent games are aggregated (the 10/20/50/100 filter).

export interface PlatformStat {
  key: string;
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
  | "stronger-premier"
  | "stronger-faceit"
  | "insufficient";

export interface PlatformSplit {
  premier: PlatformStat | null; // last `limit` Premier games
  faceit: PlatformStat | null; // last `limit` FACEIT games
  premierTotal: number; // total Premier games in the pool (for filter sizing)
  faceitTotal: number; // total FACEIT games in the pool
  ratingGap: number | null; // premier.avgRating − faceit.avgRating (both >= MIN_N)
  verdict: Verdict;
  comparable: boolean; // both sides have >= MIN_N games in the window
}

// Minimum games on a platform for its averages (and the gap verdict) to mean
// anything.
export const MIN_N = 3;
// A Leetify-rating gap beyond this reads as a real cross-platform discrepancy.
export const GAP_THRESHOLD = 0.25;

const isPremier = (m: LeetifyRecentMatch) => m.rank_type === 11;
const isFaceit = (m: LeetifyRecentMatch) => m.data_source === "faceit";

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

export function computePlatformSplit(
  matches: LeetifyRecentMatch[],
  faceitMatches?: LeetifyRecentMatch[],
  limit = Infinity,
): PlatformSplit {
  const premierAll = matches.filter(isPremier);
  // FACEIT comes from its dedicated full list when available (so games from
  // months back still count), falling back to whatever's in the recent window.
  const faceitAll =
    faceitMatches && faceitMatches.length ? faceitMatches : matches.filter(isFaceit);
  const premier = statFor("premier", "Premier", premierAll.slice(0, limit));
  const faceit = statFor("faceit", "FACEIT", faceitAll.slice(0, limit));

  let ratingGap: number | null = null;
  let verdict: Verdict = "insufficient";
  let comparable = false;
  if (premier && faceit && premier.n >= MIN_N && faceit.n >= MIN_N) {
    comparable = true;
    ratingGap = premier.avgRating - faceit.avgRating;
    verdict =
      Math.abs(ratingGap) < GAP_THRESHOLD
        ? "consistent"
        : ratingGap > 0
          ? "stronger-premier"
          : "stronger-faceit";
  }

  return {
    premier,
    faceit,
    premierTotal: premierAll.length,
    faceitTotal: faceitAll.length,
    ratingGap,
    verdict,
    comparable,
  };
}
