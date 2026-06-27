// Per-player, single-match anomaly score for a parsed demo ("CheatMeter, this
// match"). Built only from what a demo actually gives us per player —
// performance signals (HS%, K/D, ADR, kills/round, opening-duel success,
// multi-kill frequency). It is NOT account data (Smurf/Boosted/Bought need
// profile lookups) and NOT per-tick aim telemetry (reaction / crosshair before
// visibility need tick-rate data we don't capture). So it's a "this game looked
// unusual" flag — high-skill legit players score high too — never an accusation.

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
  factors: DemoCheatFactor[]; // sorted, strongest tell first
}

// Score one player from their in-match insight stats.
export function demoCheat(p: PlayerInsight): DemoCheat {
  const rounds = Math.max(1, p.roundsPlayed);
  const sHs = p.kills >= 5 ? up(p.hsPct, 50, 80) : null; // need a sample of kills
  const sAdr = up(p.adr, 85, 130);
  const sKd = up(p.kd, 1.3, 2.5);
  const sKpr = up(p.kpr, 0.75, 1.15);
  const sOpen = p.openingAttempts >= 4 ? up(p.openingWinPct, 55, 85) : null;
  const sMulti = up((p.multiKillRounds / rounds) * 100, 18, 45);
  // strongest tells — only when the demo captured aim data (newer parses)
  const enough = p.aimSamples >= 5;
  const sReact = enough ? down(p.reactionMs, 500, 150) : null; // ms after visible
  const sPreaim = enough ? down(p.preaimDeg, 20, 3) : null; // crosshair offset °

  const parts: [string, string, string, number | null, number][] = [
    ["react", "Reaction", `${p.reactionMs.toFixed(0)}ms`, sReact, 0.24],
    ["preaim", "Pre-aim", `${p.preaimDeg.toFixed(1)}°`, sPreaim, 0.22],
    ["hs", "Headshot %", `${p.hsPct.toFixed(0)}%`, sHs, 0.16],
    ["adr", "ADR", p.adr.toFixed(0), sAdr, 0.12],
    ["kd", "K/D", p.kd.toFixed(2), sKd, 0.1],
    ["kpr", "Kills / round", p.kpr.toFixed(2), sKpr, 0.08],
    ["open", "Opening duels", `${p.openingWinPct.toFixed(0)}%`, sOpen, 0.05],
    ["multi", "Multi-kill rounds", `${p.multiKillRounds}`, sMulti, 0.03],
  ];
  const present = parts.filter(
    (x): x is [string, string, string, number, number] => x[3] != null,
  );
  const mw = present.reduce((a, x) => a + x[4], 0) || 1;
  const mean = present.reduce((a, x) => a + x[3] * x[4], 0) / mw;

  // one or two superhuman tells shouldn't be averaged away — blend the mean with
  // the peak of the most direct signals (aim tells first, then HS / ADR).
  const core = present
    .filter((x) => ["react", "preaim", "hs", "adr"].includes(x[0]))
    .map((x) => x[3])
    .sort((a, b) => b - a);
  const peak = core.length === 0 ? 0 : core.length === 1 ? core[0] : (core[0] + core[1]) / 2;
  const mech = core.length ? Math.max(mean, 0.4 * mean + 0.6 * peak) : mean;

  // with real aim telemetry we can be more confident; without, stay conservative
  const score = clamp(mech * (enough ? 0.95 : 0.85));

  const factors: DemoCheatFactor[] = present
    .map(([key, label, display, sub]) => ({ key, label, display, score: sub, band: band5(sub) }))
    .sort((a, b) => b.score - a.score);

  return { score, band: band5(score), factors };
}
