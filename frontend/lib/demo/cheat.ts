// Per-player, single-match anomaly score for a parsed demo ("CheatMeter, this
// match"). It is built ONLY from aim-quality signals that directly indicate
// mechanically anomalous aim — NOT volume/impact (kills, K/D, ADR, KPR, multi-
// kills, opening duels), because a strong player simply frags a lot and that is
// not cheating. Signals, strongest first:
//   • Snap kills — landed almost instantly despite the crosshair being far off
//     target (a superhuman correction). The key tell, and the one that does NOT
//     punish good angle-holding (a pre-aimed hold has a LOW crosshair offset).
//   • Accuracy & headshot-accuracy (hits / shots) — volume-independent.
//   • Reaction (very low only → trigger-style) and headshot % — minor.
// Aim-tell + accuracy data come from the per-tick parser, so they need a recent
// re-parse; older demos fall back to headshot % only, at low confidence. Always
// an "unusual this game" flag — elite legit players can score moderately — never
// proof; account data (Smurf/Boosted/bans) lives in the separate Account check.

import type { PlayerInsight } from "./insights";
import { band5, BAND_HEX, BAND_LABEL, type Band } from "@/lib/suspicion";

const clamp = (n: number, a = 0, b = 100) => Math.max(a, Math.min(b, n));
const up = (v: number, lo: number, hi: number) => clamp(((v - lo) / (hi - lo)) * 100);
const down = (v: number, benign: number, sus: number) => clamp(((benign - v) / (benign - sus)) * 100);

export { BAND_HEX, BAND_LABEL };
export type { Band };

export interface DemoCheatFactor {
  key: string;
  label: string;
  display: string;
  score: number;
  band: Band;
}

export interface DemoCheat {
  score: number;
  band: Band;
  confidence: number; // 0..1 — how much real aim data backed the score
  factors: DemoCheatFactor[]; // sorted, strongest tell first
}

// Score one player from their in-match aim-quality stats.
export function demoCheat(p: PlayerInsight): DemoCheat {
  const hasAim = p.aimSamples >= 6; // reaction/snap need spotted-kill samples
  const hasShots = p.shots >= 40; // accuracy needs a sample of bullets

  // Primary, volume-independent aim tells.
  const sSnap = hasAim ? up(p.snapRate, 8, 35) : null; // fast kill despite far crosshair
  // accuracy: window kept wide so high-precision-but-legit play (AWP, tappers
  // at 40-60%) doesn't saturate — only genuinely anomalous gun accuracy does.
  const sAcc = hasShots ? up(p.accuracy, 30, 65) : null; // bullets that hit
  const sHsAcc = hasShots ? up(p.hsAccuracy, 10, 28) : null; // bullets that headshot
  // Minor corroborators.
  const sReact = hasAim ? down(p.reactionMs, 220, 80) : null; // only very low (trigger-like)
  const sHs = p.kills >= 8 ? up(p.hsPct, 50, 88) : null; // pros run high too → weak

  const parts: [string, string, string, number | null, number][] = [
    ["snap", "Snap kills", `${p.snapRate.toFixed(0)}%`, sSnap, 0.3],
    ["acc", "Accuracy", `${p.accuracy.toFixed(0)}%`, sAcc, 0.24],
    ["hsacc", "HS accuracy", `${p.hsAccuracy.toFixed(0)}%`, sHsAcc, 0.18],
    ["react", "Reaction", `${p.reactionMs.toFixed(0)}ms`, sReact, 0.1],
    ["hs", "Headshot %", `${p.hsPct.toFixed(0)}%`, sHs, 0.1],
  ];
  const present = parts.filter(
    (x): x is [string, string, string, number, number] => x[3] != null,
  );

  if (present.length === 0) {
    return { score: 0, band: band5(0), confidence: 0, factors: [] };
  }

  const mw = present.reduce((a, x) => a + x[4], 0) || 1;
  const mean = present.reduce((a, x) => a + x[3] * x[4], 0) / mw;

  // One or two superhuman tells shouldn't be averaged away by normal ones — blend
  // the weighted mean with the peak of the most direct tells. Accuracy is left
  // OUT of the peak set so a lone high-accuracy reading (e.g. an AWPer) can't
  // dominate via the peak — it still contributes through the weighted mean.
  const core = present
    .filter((x) => ["snap", "hsacc"].includes(x[0]))
    .map((x) => x[3])
    .sort((a, b) => b - a);
  const peak = core.length === 0 ? 0 : core.length === 1 ? core[0] : (core[0] + core[1]) / 2;
  const mech = core.length ? Math.max(mean, 0.4 * mean + 0.6 * peak) : mean;

  // Confidence scales with how many DIRECT aim tells we actually had. With none
  // (old demo: HS%/reaction only) the score is heavily discounted so a missing
  // re-parse can't read as "clean" OR over-accuse.
  const direct = [sSnap, sAcc, sHsAcc].filter((x) => x != null).length;
  const confidence = direct >= 3 ? 1 : direct === 2 ? 0.9 : direct === 1 ? 0.78 : 0.5;
  const score = clamp(mech * confidence);

  const factors: DemoCheatFactor[] = present
    .map(([key, label, display, sub]) => ({ key, label, display, score: sub, band: band5(sub) }))
    .sort((a, b) => b.score - a.score);

  return { score, band: band5(score), confidence, factors };
}
