import type { FaceitProfile, LeetifyProfile, SteamGameStats } from "@/lib/types";

// ---------------------------------------------------------------------------
// CheatMeter suspicion / anomaly engine.
//
// A STATISTICAL ANOMALY heuristic, NOT proof of cheating. It weighs signals
// (cross-platform performance gap, reaction time, crosshair placement, K/D, HS
// accuracy, aim rating, consistency, bans) into a 0–100 likelihood. High-skill
// legit players score high too — the output is a "look closer" flag, never an
// accusation. Everything below is computed from real, public stats only.
// ---------------------------------------------------------------------------

export type Band = "verylow" | "low" | "moderate" | "high" | "veryhigh";

export const BAND_LABEL: Record<Band, string> = {
  verylow: "Very Low",
  low: "Low",
  moderate: "Moderate",
  high: "High",
  veryhigh: "Very High",
};
export const BAND_HEX: Record<Band, string> = {
  verylow: "#46d369",
  low: "#9ad44a",
  moderate: "#f5b942",
  high: "#ff8a3d",
  veryhigh: "#f5694a",
};
export const BAND_TEXT: Record<Band, string> = {
  verylow: "text-good",
  low: "text-[#9ad44a]",
  moderate: "text-mid",
  high: "text-[#ff8a3d]",
  veryhigh: "text-bad",
};
export const RISK_LABEL: Record<Band, string> = {
  verylow: "Minimal risk",
  low: "Low risk",
  moderate: "Moderate risk",
  high: "High risk",
  veryhigh: "Very high risk",
};

export function band5(score: number): Band {
  if (score >= 80) return "veryhigh";
  if (score >= 60) return "high";
  if (score >= 40) return "moderate";
  if (score >= 20) return "low";
  return "verylow";
}

export interface SusFactor {
  key: string;
  icon: string;
  label: string;
  display: string;
  detail: string;
  score: number;
  band: Band;
  weight: number;
}

export interface MetricCard {
  key: string;
  icon: string;
  label: string;
  value: string;
  band: Band;
  loVal: string;
  loLabel: string;
  hiVal: string;
  hiLabel: string;
  marker: number; // 0–100 position along the scale
  note: string;
}

export interface QueueStat {
  source: string;
  label: string;
  n: number;
  avgRating: number;
  winPct: number;
}

export interface Suspicion {
  score: number;
  band: Band;
  subtitle: string;
  verdict: string;
  confidence: number;
  factors: SusFactor[];
  metrics: MetricCard[];
  queues: QueueStat[];
  gap: number | null;
  trend: { rating: number[]; secondary: number[]; secondaryLabel: string };
  summary: { wins: number; losses: number; draws: number; total: number };
  scope: { matches: number; hours: number | null };
  hasEnough: boolean;
}

const clamp = (n: number, a = 0, b = 100) => Math.max(a, Math.min(b, n));
const up = (v: number, lo: number, hi: number) =>
  clamp(((v - lo) / (hi - lo)) * 100);
const down = (v: number, benign: number, sus: number) =>
  clamp(((benign - v) / (benign - sus)) * 100);

const steamKd = (steamStats?: SteamGameStats | null): number => {
  const s = steamStats?.stats;
  if (!s) return 0;
  const k = s["total_kills"] ?? 0;
  const d = s["total_deaths"] ?? 0;
  return d > 0 ? k / d : 0;
};

const noteFor = (band: Band): string =>
  ({
    verylow: "Within normal range",
    low: "Around average",
    moderate: "Above average",
    high: "Well above average",
    veryhigh: "Elite / unusual",
  })[band];

export function computeSuspicion(
  leetify: LeetifyProfile | null | undefined,
  faceit: FaceitProfile | null | undefined,
  steamStats: SteamGameStats | null | undefined,
): Suspicion | null {
  if (!leetify) return null;
  const s = leetify.stats;
  const recent = leetify.recent_matches ?? [];
  const last = recent.slice(0, 30);

  // --- per-queue + cross-platform gap ---
  const SRC = [
    { k: "matchmaking", l: "MM" },
    { k: "premier", l: "Premier" },
    { k: "faceit", l: "FACEIT" },
  ];
  const queues: QueueStat[] = SRC.map((src) => {
    const ms = recent.filter((m) => m.data_source === src.k);
    if (!ms.length) return null;
    const avgRating = ms.reduce((a, m) => a + m.leetify_rating, 0) / ms.length;
    const w = ms.filter((m) => m.outcome === "win").length;
    return {
      source: src.k,
      label: src.l,
      n: ms.length,
      avgRating,
      winPct: (w / ms.length) * 100,
    };
  }).filter((q): q is QueueStat => q !== null);

  let gap: number | null = null;
  const faceitQ = queues.find((q) => q.source === "faceit");
  const off = queues.filter((q) => q.source !== "faceit");
  const offN = off.reduce((a, q) => a + q.n, 0);
  if (faceitQ && faceitQ.n >= 3 && offN >= 3) {
    const offAvg = off.reduce((a, q) => a + q.avgRating * q.n, 0) / offN;
    gap = offAvg - faceitQ.avgRating;
  }

  // --- consistency (low rating variance over recent matches) ---
  const ratings = last.map((m) => m.leetify_rating);
  let consistencyPct = 0;
  if (ratings.length >= 4) {
    const mean = ratings.reduce((a, v) => a + v, 0) / ratings.length;
    const variance =
      ratings.reduce((a, v) => a + (v - mean) ** 2, 0) / ratings.length;
    const sd = Math.sqrt(variance);
    consistencyPct = clamp(100 - sd * 55);
  }

  const kd = faceit?.kdRatio || steamKd(steamStats);

  // --- factor table (drives the score + the right-hand list) ---
  const F: SusFactor[] = [];
  const push = (
    key: string,
    icon: string,
    label: string,
    display: string,
    detail: string,
    score: number,
    weight: number,
  ) => F.push({ key, icon, label, display, detail, score, band: band5(score), weight });

  if (gap != null)
    push("xplat", "swap", "Cross-platform gap", `${gap >= 0 ? "+" : ""}${gap.toFixed(2)}`, "MM/Premier vs FACEIT rating", up(gap, 0.15, 1.0), 0.22);
  if (s.reaction_time_ms > 0)
    push("reaction", "bolt", "Reaction time", `${s.reaction_time_ms.toFixed(0)} ms`, "time to damage in duels", down(s.reaction_time_ms, 650, 480), 0.14);
  if (s.preaim > 0)
    push("preaim", "cross", "Crosshair placement", `${s.preaim.toFixed(1)}°`, "lower = unnaturally precise", down(s.preaim, 12, 6), 0.12);
  if (kd > 0)
    push("kd", "target", "K/D ratio", kd.toFixed(2), "avg ≈ 1.0", up(kd, 1.0, 2.0), 0.12);
  if (s.accuracy_head > 0)
    push("hs", "target", "HS accuracy", `${s.accuracy_head.toFixed(0)}%`, "share of hits on the head", up(s.accuracy_head, 20, 42), 0.1);
  if (leetify.rating.aim > 0)
    push("aim", "cross", "Aim rating", leetify.rating.aim.toFixed(1), "Leetify aim (0–100)", up(leetify.rating.aim, 55, 92), 0.07);
  if (consistencyPct > 0)
    push("consistency", "chart", "Consistency", `${consistencyPct.toFixed(0)}%`, `${last.length} recent matches`, up(consistencyPct, 55, 92), 0.05);
  if (leetify.rating.utility > 0)
    push("utility", "flask", "Utility usage", leetify.rating.utility.toFixed(1), "Leetify utility (0–100)", up(leetify.rating.utility, 55, 85), 0.02);
  if (Number.isFinite(leetify.rating.clutch))
    push("clutch", "flame", "Clutch rating", `${leetify.rating.clutch >= 0 ? "+" : ""}${leetify.rating.clutch.toFixed(2)}`, "impact in clutch rounds", up(leetify.rating.clutch, 0, 0.12), 0.02);
  const banCount = leetify.bans?.length ?? 0;
  push("bans", "shield", "Ban / VAC history", banCount > 0 ? `${banCount}` : "Clean", "bans on record (Leetify)", banCount > 0 ? 100 : 0, 0.14);

  const wsum = F.reduce((a, f) => a + f.weight, 0);
  const score = wsum ? clamp(F.reduce((a, f) => a + f.score * f.weight, 0) / wsum) : 0;
  const band = band5(score);

  // --- detailed metric scale-cards (the middle row) ---
  const metrics: MetricCard[] = [];
  const card = (
    key: string,
    icon: string,
    label: string,
    value: string,
    marker: number,
    loVal: string,
    loLabel: string,
    hiVal: string,
    hiLabel: string,
  ) =>
    metrics.push({
      key,
      icon,
      label,
      value,
      band: band5(marker),
      marker,
      loVal,
      loLabel,
      hiVal,
      hiLabel,
      note: noteFor(band5(marker)),
    });

  if (s.reaction_time_ms > 0)
    card("reaction", "bolt", "Reaction time", `${s.reaction_time_ms.toFixed(0)}ms`, down(s.reaction_time_ms, 650, 480), "650ms", "Avg", "480ms", "Elite");
  if (s.preaim > 0)
    card("preaim", "cross", "Crosshair placement", `${s.preaim.toFixed(1)}°`, down(s.preaim, 12, 6), "12°", "Avg", "6°", "Elite");
  if (kd > 0)
    card("kd", "target", "K/D ratio", kd.toFixed(2), up(kd, 0.9, 1.6), "0.90", "Avg", "1.60", "High");
  if (leetify.rating.aim > 0)
    card("aim", "cross", "Aim rating", leetify.rating.aim.toFixed(1), up(leetify.rating.aim, 50, 90), "50", "Avg", "90", "Top 5%");
  if (s.accuracy_head > 0)
    card("hs", "target", "HS accuracy", `${s.accuracy_head.toFixed(0)}%`, up(s.accuracy_head, 18, 40), "18%", "Low", "40%", "High");

  // --- recent W/L/D donut + consistency trend ---
  const wins = last.filter((m) => m.outcome === "win").length;
  const losses = last.filter((m) => m.outcome === "loss").length;
  const draws = last.length - wins - losses;

  const chrono = [...last].reverse();
  const trend = {
    rating: chrono.map((m) => m.leetify_rating),
    secondary: chrono.map((m) => m.accuracy_head),
    secondaryLabel: "HS acc",
  };

  // --- confidence: how much real data backs the read ---
  const confidence = clamp(
    45 +
      Math.min(recent.length, 30) +
      (faceit ? 8 : 0) +
      (steamStats ? 6 : 0) +
      Math.min(F.length, 9),
    40,
    97,
  );

  const subtitle: string = {
    verylow: "No unusual patterns detected",
    low: "Mostly normal, a couple of points above average",
    moderate: "Some stats sit above the expected range",
    high: "Highly suspicious behaviour detected",
    veryhigh: "Multiple strong anomalies detected",
  }[band];
  const verdict: string = {
    verylow: "Stats are consistent with legit play across the board.",
    low: "A stat or two runs hot, but nothing a skilled player wouldn't show.",
    moderate: "A few indicators sit outside the norm — worth a glance.",
    high: "Multiple behavioural indicators are above the expected range of legit players.",
    veryhigh: "Several indicators are significantly outside the expected range of legit players.",
  }[band];

  return {
    score,
    band,
    subtitle,
    verdict,
    confidence,
    factors: F,
    metrics,
    queues,
    gap,
    trend,
    summary: { wins, losses, draws, total: last.length },
    scope: {
      matches: leetify.total_matches || faceit?.matches || recent.length,
      hours: steamStats?.stats?.["total_time_played"]
        ? steamStats.stats["total_time_played"] / 3600
        : null,
    },
    hasEnough: F.length >= 4,
  };
}
