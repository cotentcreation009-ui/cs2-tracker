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
  primary?: boolean; // the discriminating signal (cross-platform gap)
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

  const kd = faceit?.kdRatio || steamKd(steamStats);
  const banCount = leetify.bans?.length ?? 0;
  const banned = banCount > 0;

  // --- sub-scores (0 = normal, 100 = extreme) ---
  // Strict thresholds: only genuinely superhuman values ramp up, NOT pro-level
  // skill (e.g. preaim must beat ~5° and reaction ~450ms before it counts).
  const sGap = gap != null ? up(gap, 0.1, 0.9) : null;
  const sReaction = s.reaction_time_ms > 0 ? down(s.reaction_time_ms, 630, 440) : null;
  const sPreaim = s.preaim > 0 ? down(s.preaim, 11, 4.5) : null;
  const sHs = s.accuracy_head > 0 ? up(s.accuracy_head, 20, 42) : null;
  const sAim = leetify.rating.aim > 0 ? up(leetify.rating.aim, 78, 99) : null;
  const sKd = kd > 0 ? up(kd, 1.0, 2.0) : null;

  // Mechanical-anomaly composite — reaction, crosshair placement and aim carry
  // the most weight (the most direct aimbot/triggerbot tells); HS% and K/D are
  // lighter, skill-linked support.
  const mechParts: [number, number][] = (
    [
      [sReaction, 0.26],
      [sPreaim, 0.24],
      [sAim, 0.22],
      [sHs, 0.16],
      [sKd, 0.12],
    ] as [number | null, number][]
  ).filter((p): p is [number, number] => p[0] != null);
  const mw = mechParts.reduce((a, p) => a + p[1], 0);
  const mech = mw ? mechParts.reduce((a, p) => a + p[0] * p[1], 0) / mw : 0;

  // Score: mechanics drive it. The cross-platform gap then works BOTH ways — a
  // big gap (great only in weak-anti-cheat queues) amplifies mechanics and adds
  // on top; a near-zero gap (proven consistent vs FACEIT's anti-cheat) is
  // exculpatory and discounts mechanics toward legit. No gap to cross-check →
  // mechanics mostly stand. A ban floors the score high.
  let score: number;
  if (sGap != null) {
    score = mech * (0.55 + 0.45 * (sGap / 100)) + sGap * 0.3;
  } else {
    score = mech * 0.8;
  }
  if (banned) score = Math.max(score, 85);
  score = clamp(score);
  const band = band5(score);

  // --- factor list (only signals that actually move the score) ---
  const F: SusFactor[] = [];
  const add = (
    key: string,
    icon: string,
    label: string,
    display: string,
    detail: string,
    sub: number | null,
    primary = false,
  ) => {
    if (sub != null) F.push({ key, icon, label, display, detail, score: sub, band: band5(sub), primary });
  };
  add("xplat", "swap", "Cross-platform gap", gap != null ? `${gap >= 0 ? "+" : ""}${gap.toFixed(2)}` : "—", "MM/Premier vs FACEIT — primary signal", sGap, true);
  add("reaction", "bolt", "Reaction time", `${s.reaction_time_ms.toFixed(0)} ms`, "time to damage in duels", sReaction);
  add("preaim", "cross", "Crosshair placement", `${s.preaim.toFixed(1)}°`, "lower = unnaturally precise", sPreaim);
  add("hs", "target", "HS accuracy", `${s.accuracy_head.toFixed(0)}%`, "share of hits on the head", sHs);
  add("aim", "cross", "Aim rating", leetify.rating.aim.toFixed(1), "skill-linked — only counts with a gap", sAim);
  add("kd", "target", "K/D ratio", kd.toFixed(2), "skill-linked — only counts with a gap", sKd);
  F.push({
    key: "bans",
    icon: "shield",
    label: "Ban / VAC history",
    display: banned ? `${banCount}` : "Clean",
    detail: "bans on record (Leetify)",
    score: banned ? 100 : 0,
    band: band5(banned ? 100 : 0),
  });

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
    card("reaction", "bolt", "Reaction time", `${s.reaction_time_ms.toFixed(0)}ms`, down(s.reaction_time_ms, 630, 440), "630ms", "Human", "440ms", "Inhuman");
  if (s.preaim > 0)
    card("preaim", "cross", "Crosshair placement", `${s.preaim.toFixed(1)}°`, down(s.preaim, 11, 4.5), "11°", "Typical", "4.5°", "Inhuman");
  if (leetify.rating.aim > 0)
    card("aim", "cross", "Aim rating", leetify.rating.aim.toFixed(1), up(leetify.rating.aim, 78, 99), "78", "High", "99", "Extreme");
  if (kd > 0)
    card("kd", "target", "K/D ratio", kd.toFixed(2), up(kd, 1.0, 2.0), "1.0", "Avg", "2.0", "Extreme");
  if (s.accuracy_head > 0)
    card("hs", "target", "HS accuracy", `${s.accuracy_head.toFixed(0)}%`, up(s.accuracy_head, 20, 42), "20%", "Typical", "42%", "Extreme");

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
