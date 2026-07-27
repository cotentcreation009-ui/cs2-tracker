// Aim consistency over rounds — the toggle signature. A legit player's aim
// quality wanders around a personal mean all match; the classic cheat pattern
// is a STEP: ordinary numbers, then a sharp sustained improvement mid-match
// (often right after going down big). We already store the per-round aim
// aggregates (ReplayPlayerStat), so the case file can draw the curves and
// flag the strongest step-change instead of leaving it to the reviewer's eye.
//
// Detection is a plain two-sample split scan: for every split point with at
// least MIN_SIDE samples per side, compare the means normalized by the pooled
// standard deviation (a t-like score). Only aim-IMPROVEMENT directions count
// (reaction/pre-aim dropping, accuracy rising) — getting worse is tilt, not a
// toggle. This is a "look here" heuristic, never proof, and it does NOT feed
// the CheatMeter score.

import type { ReplayRound } from "./types";

export interface SeriesPoint {
  round: number; // 1-based round number
  v: number;
}

export interface StepChange {
  metric: "reaction" | "preaim" | "accuracy";
  atRound: number; // first round of the "after" regime
  before: number; // mean before
  after: number; // mean after
  score: number; // separation in pooled-σ units (higher = sharper step)
}

export interface AimConsistency {
  reaction: SeriesPoint[]; // ms, rounds with aim samples
  preaim: SeriesPoint[]; // degrees
  accuracy: SeriesPoint[]; // %, rounds with ≥5 shots
  step: StepChange | null; // strongest suspicious step, if any
}

const MIN_SIDE = 3; // samples required on each side of a split
const MIN_SCORE = 1.6; // pooled-σ separation to flag
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const std = (xs: number[], m: number) =>
  Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / Math.max(1, xs.length - 1));

// strongest improvement step in one series; `improveSign` = sign of a
// suspicious change (-1: dropping is better, +1: rising is better)
function bestStep(points: SeriesPoint[], improveSign: 1 | -1): Omit<StepChange, "metric"> | null {
  if (points.length < MIN_SIDE * 2) return null;
  const vs = points.map((p) => p.v);
  let best: Omit<StepChange, "metric"> | null = null;
  for (let k = MIN_SIDE; k <= vs.length - MIN_SIDE; k++) {
    const a = vs.slice(0, k);
    const b = vs.slice(k);
    const ma = mean(a);
    const mb = mean(b);
    const pooled = Math.sqrt(
      ((a.length - 1) * std(a, ma) ** 2 + (b.length - 1) * std(b, mb) ** 2) /
        Math.max(1, a.length + b.length - 2),
    );
    if (pooled < 1e-6) continue; // flat series — no meaningful step
    const diff = (mb - ma) * improveSign;
    if (diff <= 0) continue; // only improvements are suspicious
    const score = diff / pooled;
    if (score >= MIN_SCORE && (!best || score > best.score)) {
      best = { atRound: points[k].round, before: ma, after: mb, score };
    }
  }
  return best;
}

export function aimConsistency(rounds: ReplayRound[], playerIdx: number): AimConsistency {
  const reaction: SeriesPoint[] = [];
  const preaim: SeriesPoint[] = [];
  const accuracy: SeriesPoint[] = [];
  for (const r of rounds) {
    const st = (r.stats ?? []).find((s) => s.i === playerIdx);
    if (!st) continue;
    if ((st.aimN ?? 0) > 0) {
      reaction.push({ round: r.n, v: (st.rctMs ?? 0) / (st.aimN ?? 1) });
      preaim.push({ round: r.n, v: (st.preaim ?? 0) / (st.aimN ?? 1) });
    }
    if ((st.shots ?? 0) >= 5) {
      accuracy.push({ round: r.n, v: ((st.hits ?? 0) / (st.shots ?? 1)) * 100 });
    }
  }

  const candidates: (StepChange | null)[] = [
    (() => {
      const s = bestStep(reaction, -1);
      return s ? { metric: "reaction" as const, ...s } : null;
    })(),
    (() => {
      const s = bestStep(preaim, -1);
      return s ? { metric: "preaim" as const, ...s } : null;
    })(),
    (() => {
      const s = bestStep(accuracy, 1);
      return s ? { metric: "accuracy" as const, ...s } : null;
    })(),
  ];
  const step = candidates
    .filter((c): c is StepChange => c != null)
    .sort((a, b) => b.score - a.score)[0] ?? null;

  return { reaction, preaim, accuracy, step };
}
