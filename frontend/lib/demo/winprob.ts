// Round win-probability — a deliberately simple, hand-tuned estimate of
// P(CT wins this round) over time, recomputed at every state change (kill,
// plant, defuse) and sampled per second for time decay. It exists to make two
// things readable: the round's momentum curve under the replay scrubber, and
// each kill's swing (Δ win probability) in the kill feed — the "impact" read.
//
// This is NOT a trained model. It is a logistic over the states that decide
// CS2 rounds — man count, bomb state, the two clocks, and a small equipment
// term — with coefficients tuned by hand against real MM demos for sane
// behavior (5v5 ≈ even, man advantage dominates, a plant flips the round
// toward T and tightens as the C4 runs down, a quiet clock leans CT). Always
// label it "estimate" in the UI.

import type { ReplayMeta, ReplayRound } from "./types";

export const ROUND_TIME = 115; // mp_roundtime 1:55 (competitive default)
export const C4_TIME = 40;

export interface WinProbPoint {
  t: number; // seconds since round start
  p: number; // P(CT wins the round), 0..1
}

export interface KillSwing {
  killIndex: number; // index into round.kills
  delta: number; // p(after) − p(before), CT perspective (−1..1)
}

export interface RoundWinProb {
  points: WinProbPoint[]; // per-second samples + event steps, ascending t
  swings: KillSwing[];
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

interface State {
  aliveCT: number;
  aliveT: number;
  planted: boolean;
  plantT: number;
  defused: boolean;
  exploded: boolean;
  equipCT: number;
  equipT: number;
}

function probOf(s: State, t: number, freezeEnd: number): number {
  // decided states first
  if (s.defused) return 1;
  if (s.exploded) return 0;
  if (s.aliveT === 0 && !s.planted) return 1; // Ts eliminated, no bomb down
  if (s.aliveCT === 0 && s.planted) return 0; // nobody left to defuse
  if (s.aliveCT === 0 && s.aliveT === 0) return s.planted ? 0 : 1;

  // man count is the dominant term; log-ratio adds "5v4 matters less than 2v1"
  const d = s.aliveCT - s.aliveT;
  let x = 0.55 * d + 0.9 * Math.log((s.aliveCT + 0.5) / (s.aliveT + 0.5));

  // small equipment lean, per living player (a $2k gap ≈ 0.1σ)
  const eqCT = s.aliveCT > 0 ? s.equipCT / s.aliveCT : 0;
  const eqT = s.aliveT > 0 ? s.equipT / s.aliveT : 0;
  x += (eqCT - eqT) / 20000;

  if (s.planted) {
    // the plant flips the round toward T and tightens as the C4 runs down:
    // CTs must find, clear and defuse inside the remaining window
    const rem = Math.max(0, C4_TIME - (t - s.plantT));
    x += -0.9 - 1.9 * (1 - rem / C4_TIME);
    // a retake needs bodies — being down players post-plant is brutal
    if (d < 0) x += 0.35 * d;
  } else {
    // no plant and the clock draining favors the CTs (Ts must still execute)
    const rem = Math.max(0, ROUND_TIME - (t - freezeEnd));
    x += 0.8 * (1 - rem / ROUND_TIME);
  }

  return sigmoid(x);
}

/**
 * Build the round's win-probability timeline. Events step the state (kills,
 * plant, defuse, explode); between events the clocks decay the probability,
 * sampled once per second so the ribbon bends with the timers.
 */
export function roundWinProb(meta: ReplayMeta, r: ReplayRound): RoundWinProb {
  const freezeEnd = r.freezeEnd ?? 15;
  const sideOf = (i: number): "CT" | "T" | "" =>
    r.ct?.includes(i) ? "CT" : r.t?.includes(i) ? "T" : (meta.players[i]?.team ?? "");

  const s: State = {
    aliveCT: r.ct?.length ?? 5,
    aliveT: r.t?.length ?? 5,
    planted: false,
    plantT: 0,
    defused: false,
    exploded: false,
    equipCT: 0,
    equipT: 0,
  };
  for (const st of r.stats ?? []) {
    const side = sideOf(st.i);
    if (side === "CT") s.equipCT += st.equip ?? 0;
    else if (side === "T") s.equipT += st.equip ?? 0;
  }

  // event stream, time-ordered: kills + bomb events
  type Ev =
    | { t: number; kind: "kill"; killIndex: number; victimSide: "CT" | "T" | "" }
    | { t: number; kind: "plant" | "defuse" | "explode" };
  const evs: Ev[] = [];
  (r.kills ?? []).forEach((k, killIndex) => {
    if (k.v >= 0) evs.push({ t: k.t, kind: "kill", killIndex, victimSide: sideOf(k.v) });
  });
  for (const b of r.bomb ?? []) {
    if (b.k === "plant" || b.k === "defuse" || b.k === "explode") evs.push({ t: b.t, kind: b.k });
  }
  evs.sort((a, b) => a.t - b.t);

  const tEnd = Math.max(
    freezeEnd + 1,
    r.frames?.length ? r.frames[r.frames.length - 1].t : 0,
    evs.length ? evs[evs.length - 1].t + 1 : 0,
  );

  const points: WinProbPoint[] = [];
  const swings: KillSwing[] = [];
  let ei = 0;
  for (let t = freezeEnd; t <= tEnd + 0.5; t += 1) {
    // apply all events up to this second, recording each kill's swing
    while (ei < evs.length && evs[ei].t <= t) {
      const ev = evs[ei];
      const before = probOf(s, ev.t, freezeEnd);
      if (ev.kind === "kill") {
        if (ev.victimSide === "CT") s.aliveCT = Math.max(0, s.aliveCT - 1);
        else if (ev.victimSide === "T") s.aliveT = Math.max(0, s.aliveT - 1);
      } else if (ev.kind === "plant") {
        s.planted = true;
        s.plantT = ev.t;
      } else if (ev.kind === "defuse") {
        s.defused = true;
      } else if (ev.kind === "explode") {
        s.exploded = true;
      }
      const after = probOf(s, ev.t, freezeEnd);
      if (ev.kind === "kill") swings.push({ killIndex: ev.killIndex, delta: after - before });
      // step: both sides of the discontinuity so the ribbon draws a cliff
      points.push({ t: ev.t, p: before }, { t: ev.t, p: after });
      ei++;
    }
    points.push({ t, p: probOf(s, t, freezeEnd) });
  }

  return { points, swings };
}
