import type { FaceitProfile, LeetifyProfile, SteamExtras, SteamGameStats } from "@/lib/types";

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
  lowConfidence: boolean; // thin data — public band is capped, read is hedged
  factors: SusFactor[];
  metrics: MetricCard[];
  queues: QueueStat[];
  gap: number | null;
  trend: { rating: number[]; outcomes: string[] };
  summary: { wins: number; losses: number; draws: number; total: number };
  scope: { matches: number; hours: number | null };
  hasEnough: boolean;
}

const clamp = (n: number, a = 0, b = 100) => Math.max(a, Math.min(b, n));
const up = (v: number, lo: number, hi: number) =>
  clamp(((v - lo) / (hi - lo)) * 100);
const down = (v: number, benign: number, sus: number) =>
  clamp(((benign - v) / (benign - sus)) * 100);

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
  steamExtras?: SteamExtras | null,
): Suspicion | null {
  // Work from whatever sources exist. Leetify gives the strongest mechanical
  // tells (reaction / crosshair / aim); Steam stats (shot accuracy, HS%, K/D)
  // and FACEIT still let us produce a lower-confidence read for the many players
  // who aren't on Leetify — so the meter shows for every looked-up account that
  // has at least a couple of usable signals.
  if (!leetify && !faceit && !steamStats) return null;
  const s = leetify?.stats;
  const recent = leetify?.recent_matches ?? [];
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

  let gap: number | null = null; // raw rating gap (for display)
  let gapEff = 0; // sample-confidence-shrunk gap (for scoring)
  const faceitQ = queues.find((q) => q.source === "faceit");
  const off = queues.filter((q) => q.source !== "faceit");
  const offN = off.reduce((a, q) => a + q.n, 0);
  if (faceitQ && faceitQ.n >= 3 && offN >= 3) {
    const offAvg = off.reduce((a, q) => a + q.avgRating * q.n, 0) / offN;
    gap = offAvg - faceitQ.avgRating;
    // A difference of two ~n means is mostly noise on thin samples (SE rivals
    // the band), so shrink toward 0 — only sustained gaps from ~10+/side count
    // fully; a 3v3 sample contributes ~12%.
    const conf = Math.min(1, (Math.min(faceitQ.n, offN) - 2) / 8);
    gapEff = gap * conf;
  }

  // K/D: prefer FACEIT's; else Leetify's (from real CS2 matches — cleaner than
  // Steam's lifetime all-mode number, and the one mechanical-ish signal a
  // friends-only Leetify profile still exposes when it redacts aim detail).
  const kd = faceit?.kdRatio ?? leetify?.kd ?? 0;

  // Bans — prefer Steam's typed + dated GetPlayerBans over Leetify's opaque
  // (length-only) array. The floor scales with type + freshness so an old game
  // ban doesn't assert the same "Very High" as a fresh VAC.
  const vacBans = steamExtras?.numberOfVacBans ?? 0;
  const gameBans = steamExtras?.numberOfGameBans ?? 0;
  const daysSinceBan = steamExtras?.daysSinceLastBan ?? 0;
  const steamBanned = (steamExtras?.vacBanned ?? false) || vacBans > 0 || gameBans > 0;
  const leetifyBanCount = leetify?.bans?.length ?? 0;
  const banned = steamBanned || leetifyBanCount > 0;
  const banFresh = daysSinceBan > 0 && daysSinceBan <= 365;
  let banFloor = 0;
  if (vacBans > 0 || (steamExtras?.vacBanned ?? false)) banFloor = banFresh ? 85 : 65;
  else if (gameBans > 0) banFloor = banFresh ? 78 : 52;
  else if (leetifyBanCount > 0) banFloor = 70; // opaque Leetify ban — no type/age

  // Steam App-730 totals are LIFETIME + all-mode (DM/casual/community), so they
  // are kept as a context card only — shot accuracy is shown but not scored.
  const ss = steamStats?.stats;
  const steamFired = ss?.["total_shots_fired"] ?? 0;
  const accuracyPct =
    steamFired > 0 ? ((ss?.["total_shots_hit"] ?? 0) / steamFired) * 100 : 0;

  // Headshot signal: prefer Leetify's head-accuracy (its own scale); else fall
  // back to FACEIT's HS% of kills (a different metric → different threshold).
  // Steam lifetime HS% is NOT used — all-mode noise.
  let sHs: number | null = null;
  let hsValue = 0;
  let hsDisplay = "—";
  let hsLabel = "HS accuracy";
  let hsDetail = "share of hits on the head";
  let hsLo: [string, string] = ["25%", "Typical"];
  let hsHi: [string, string] = ["50%", "Extreme"];
  if (s && s.accuracy_head > 0) {
    hsValue = s.accuracy_head;
    sHs = up(hsValue, 25, 50);
    hsDisplay = `${hsValue.toFixed(0)}%`;
  } else {
    const hsPct = faceit?.hsPct ?? 0;
    if (hsPct > 0) {
      hsValue = hsPct;
      sHs = up(hsValue, 45, 72);
      hsDisplay = `${hsValue.toFixed(0)}%`;
      hsLabel = "Headshot %";
      hsDetail = "share of kills that are headshots";
      hsLo = ["45%", "Typical"];
      hsHi = ["72%", "Extreme"];
    }
  }

  // Calibration reference (recompute if you touch the anchors/weights below).
  // Top-percentile anchors: 430ms reaction · aim 95 · K/D 1.8 · Leetify 3.0.
  //   typical legit (650ms/12°/aim70)            → ~2   very low
  //   strong pro, no gap (480ms/6.5°/aim92)      → ~55  moderate (must NOT reach High)
  //   near-max aim + fast reaction (99/436ms), normal K/D/HS → ~70 High
  //   blatant aimbot, no gap (380ms/2°/aim99)    → ~86  very high
  //   same aimbot but cross-platform-consistent  → ~86  very high (not exonerated)
  //   no mechanical data (K/D + HS% only)        → capped at 39 (Moderate)

  // --- sub-scores (0 = normal, 100 = extreme) ---
  // up()/down() are LINEAR ramps: 0 at the benign anchor, 100 at the "top" anchor
  // (clamped). Top-percentile anchors — the value at/above which the sub-score
  // maxes to 100: 430ms reaction, aim rating 95, K/D 1.8, Leetify rating 3.0.
  // These sit at elite-but-attainable levels, so the meter is intentionally
  // sensitive: a genuinely top-tier legit player WILL register high here (that's
  // what the confidence gating + "signal, not proof" framing exist to caveat).
  const sGap = gap != null ? up(gapEff, 0.2, 1.0) : null;
  const sReaction = s && s.reaction_time_ms > 0 ? down(s.reaction_time_ms, 560, 430) : null;
  const sPreaim = s && s.preaim > 0 ? down(s.preaim, 9, 3) : null;
  const sAim = leetify && leetify.rating.aim > 0 ? up(leetify.rating.aim, 85, 95) : null;
  // Steam lifetime accuracy is all-mode (DM/casual inflate it) — shown as a
  // context card but NOT fed into the score.
  const sAccuracy = accuracyPct > 0 ? up(accuracyPct, 24, 40) : null;
  const sKd = kd > 0 ? up(kd, 1.0, 1.8) : null;
  // Overall Leetify rating (composite; ranks.leetify is on the ×100 scale, so a
  // strong player sits ~1.5–3). 3.0+ = top percentile. Lighter, skill-linked
  // support like K/D — NOT a direct aim tell, so it stays out of `core`.
  const leetifyRating = leetify?.ranks?.leetify ?? 0;
  const sLeetifyRating = leetifyRating > 0 ? up(leetifyRating, 1.5, 3) : null;

  // Mechanical-anomaly composite — reaction, crosshair placement and aim are the
  // most direct aimbot/triggerbot tells; HS% and K/D are lighter, skill-linked
  // support. Steam lifetime accuracy is deliberately NOT scored (all-mode noise).
  // Weights renormalise over whatever signals are actually present.
  const mechParts: [number, number][] = (
    [
      [sReaction, 0.24],
      [sPreaim, 0.22],
      [sAim, 0.18],
      [sHs, 0.1],
      [sKd, 0.12],
      [sLeetifyRating, 0.1],
    ] as [number | null, number][]
  ).filter((p): p is [number, number] => p[0] != null);
  const mw = mechParts.reduce((a, p) => a + p[1], 0);
  const mean = mw ? mechParts.reduce((a, p) => a + p[0] * p[1], 0) / mw : 0;

  // The direct aimbot/triggerbot tells. Two superhuman ones (e.g. 99 aim + an
  // inhuman reaction) should drive the score up on their own — a plain weighted
  // mean lets ordinary skill-linked stats (K/D, HS%) average them back down, so
  // blend the breadth (mean) with the PEAK of the strongest core tells.
  const core = [sReaction, sPreaim, sAim]
    .filter((v): v is number => v != null)
    .sort((a, b) => b - a);
  const peak = core.length === 0 ? 0 : core.length === 1 ? core[0] : (core[0] + core[1]) / 2;
  // Need ≥2 mechanical tells before the peak can lift the score (one hot stat
  // can't pin it). The stretched endpoints already keep pro-level tells modest
  // (~45), so a 0.6 peak weight only fires High when TWO tells are genuinely
  // extreme (e.g. a near-max 99 aim + a fast reaction), not for strong pros.
  const mech = core.length >= 2 ? Math.max(mean, 0.4 * mean + 0.6 * peak) : mean;

  // Score: mechanics drive it. The cross-platform gap (Leetify only) works BOTH
  // ways — a big gap amplifies + adds on top; a near-zero gap is exculpatory. No
  // gap to cross-check → mechanics mostly stand. A ban floors the score high.
  let score: number;
  if (sGap != null) {
    // A big cross-platform gap amplifies; a near-zero gap nudges down only
    // slightly. gap=0 must equal the no-gap baseline (mech*0.9) so having FACEIT
    // data can never LOWER a score — the old 0.6 floor exonerated cross-platform-
    // consistent cheaters (a uniform aimbot dropped from ~90 to ~60).
    score = mech * (0.9 + 0.1 * (sGap / 100)) + sGap * 0.25;
  } else {
    score = mech * 0.9;
  }
  // No mechanical (Leetify) tells → only skill-linked stats; cap below High so a
  // FACEIT/Steam-only K/D + HS% read can't publicly assert High/Very High.
  if (core.length === 0) score = Math.min(score, 39);
  // Friends-only Leetify profiles redact the direct aimbot tells (reaction +
  // crosshair placement). With those hidden and no cross-platform gap to cross-
  // check, aim + K/D are skill-linked and can't confidently assert High — cap at
  // Moderate. (A gap survives redaction, so if present it's allowed to drive the
  // score higher.)
  const noMechTells = sReaction == null && sPreaim == null;
  const redactedThin = noMechTells && sGap == null;
  if (redactedThin) score = Math.min(score, 50);
  // Floor scales with ban type + freshness (fresh VAC 85 → old game ban 52);
  // opaque Leetify-only bans floor at 70.
  if (banFloor > 0) score = Math.max(score, banFloor);
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
  add("reaction", "bolt", "Reaction time", s ? `${s.reaction_time_ms.toFixed(0)} ms` : "—", "time to damage in duels", sReaction);
  add("preaim", "cross", "Crosshair placement", s ? `${s.preaim.toFixed(1)}°` : "—", "lower = unnaturally precise", sPreaim);
  add("accuracy", "target", "Shot accuracy", accuracyPct > 0 ? `${accuracyPct.toFixed(0)}%` : "—", "shots hit vs fired", sAccuracy);
  add("hs", "target", hsLabel, hsDisplay, hsDetail, sHs);
  add("aim", "cross", "Aim rating", leetify ? leetify.rating.aim.toFixed(1) : "—", "aim quality (Leetify)", sAim);
  add("leetify", "chart", "Leetify rating", leetifyRating > 0 ? leetifyRating.toFixed(2) : "—", "overall performance (Leetify)", sLeetifyRating);
  add("kd", "target", "K/D ratio", kd > 0 ? kd.toFixed(2) : "—", "kills per death", sKd);
  if (leetify || steamExtras) {
    const banDisplay =
      vacBans > 0 ? `${vacBans} VAC` : gameBans > 0 ? `${gameBans} game` : leetifyBanCount > 0 ? `${leetifyBanCount}` : "Clean";
    const banDetail = steamBanned
      ? daysSinceBan > 0
        ? `last ban ${daysSinceBan}d ago`
        : "ban on record (Steam)"
      : leetifyBanCount > 0
        ? "bans on record (Leetify)"
        : "no bans on record";
    F.push({
      key: "bans",
      icon: "shield",
      label: "Ban / VAC history",
      display: banDisplay,
      detail: banDetail,
      score: banned ? 100 : 0,
      band: band5(banned ? 100 : 0),
    });
  }

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

  if (s && s.reaction_time_ms > 0)
    card("reaction", "bolt", "Reaction time", `${s.reaction_time_ms.toFixed(0)}ms`, down(s.reaction_time_ms, 560, 430), "560ms", "Human", "430ms", "Top");
  if (s && s.preaim > 0)
    card("preaim", "cross", "Crosshair placement", `${s.preaim.toFixed(1)}°`, down(s.preaim, 9, 3), "9°", "Typical", "3°", "Inhuman");
  if (leetify && leetify.rating.aim > 0)
    card("aim", "cross", "Aim rating", leetify.rating.aim.toFixed(1), up(leetify.rating.aim, 85, 95), "85", "High", "95", "Top");
  if (sLeetifyRating != null)
    card("leetify", "chart", "Leetify rating", leetifyRating.toFixed(2), up(leetifyRating, 1.5, 3), "1.5", "Strong", "3.0", "Top");
  if (sAccuracy != null)
    card("accuracy", "target", "Shot accuracy", `${accuracyPct.toFixed(0)}%`, up(accuracyPct, 24, 40), "24%", "Typical", "40%", "Inhuman");
  if (sKd != null)
    card("kd", "target", "K/D ratio", kd.toFixed(2), up(kd, 1.0, 1.8), "1.0", "Avg", "1.8", "Top");
  if (sHs != null)
    card("hs", "target", hsLabel, hsDisplay, sHs, hsLo[0], hsLo[1], hsHi[0], hsHi[1]);

  // --- recent W/L/D donut + consistency trend ---
  const wins = last.filter((m) => m.outcome === "win").length;
  const losses = last.filter((m) => m.outcome === "loss").length;
  const draws = last.length - wins - losses;

  const chrono = [...last].reverse();
  const trend = {
    rating: chrono.map((m) => m.leetify_rating),
    outcomes: chrono.map((m) => m.outcome),
  };

  // --- confidence: how much real data backs the read ---
  // Leetify is the strongest source, so a Steam/FACEIT-only read starts lower
  // and stays honestly less confident.
  let confidence = clamp(
    (leetify ? 45 : 30) +
      Math.min(recent.length, 30) +
      (faceit ? 8 : 0) +
      (steamStats ? 6 : 0) +
      Math.min(F.length, 9),
    30,
    97,
  );
  // A redacted (friends-only) profile is missing the tells that matter, so the
  // match count mustn't inflate confidence — keep it honestly low (caps the band
  // at Moderate and shows the "limited data" caveat).
  if (redactedThin) confidence = Math.min(confidence, 39);

  // Confidence gates the PUBLIC band: thin data (no Leetify / few matches) can't
  // assert a high-risk label. The raw score still drives the gauge needle, but
  // the band/verdict are capped so a low-confidence read never publicly claims
  // "High"/"Very High" on a player page.
  const BAND_ORDER: Band[] = ["verylow", "low", "moderate", "high", "veryhigh"];
  const capBand = (b: Band, max: Band): Band =>
    BAND_ORDER.indexOf(b) > BAND_ORDER.indexOf(max) ? max : b;
  let displayBand = band;
  if (confidence < 40) displayBand = capBand(displayBand, "moderate");
  else if (confidence < 55) displayBand = capBand(displayBand, "high");
  const lowConfidence = confidence < 55;

  const subtitle: string = lowConfidence
    ? "Limited data — low-confidence read"
    : {
        verylow: "No unusual patterns detected",
        low: "Mostly normal, a couple of points above average",
        moderate: "Some stats sit above the expected range",
        high: "Highly suspicious behaviour detected",
        veryhigh: "Multiple strong anomalies detected",
      }[displayBand];
  const verdict: string = lowConfidence
    ? "Not enough public data for a confident read — treat this as indicative only."
    : {
        verylow: "Stats are consistent with legit play across the board.",
        low: "A stat or two runs hot, but nothing a skilled player wouldn't show.",
        moderate: "A few indicators sit outside the norm — worth a glance.",
        high: "Multiple behavioural indicators are above the expected range of legit players.",
        veryhigh: "Several indicators are significantly outside the expected range of legit players.",
      }[displayBand];

  return {
    score,
    band: displayBand,
    subtitle,
    verdict,
    confidence,
    lowConfidence,
    factors: F,
    metrics,
    queues,
    gap,
    trend,
    summary: { wins, losses, draws, total: last.length },
    scope: {
      matches: leetify?.total_matches || faceit?.matches || recent.length,
      hours: steamStats?.stats?.["total_time_played"]
        ? steamStats.stats["total_time_played"] / 3600
        : null,
    },
    // Show whenever there are at least two real signals (the ever-present "bans"
    // row doesn't count), so Steam/FACEIT-only players still get a read.
    hasEnough: F.filter((f) => f.key !== "bans").length >= 2,
  };
}
