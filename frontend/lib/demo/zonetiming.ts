// Map-control timing — WHEN each side first reaches each call-out, and WHERE
// everyone typically stands early in the round. Both reads come straight from
// the 1 Hz frames: the first-touch table turns "T is fast to Banana" from a
// feeling into a median, and the early-setup layer draws each player's default
// position at a chosen moment so a team's shape is visible at a glance.

import type { ReplayMeta, ReplayRound } from "./types";
import { classifyPosition, type Zone } from "@/lib/maps/zones";

export type Side = "CT" | "T";

export interface SideTouch {
  median: number | null; // seconds after freeze end, median across rounds
  fastest: number | null;
  n: number; // rounds in which this side touched the zone
}

export interface ZoneTouch {
  zone: string;
  t: SideTouch;
  ct: SideTouch;
  /** both sides arrive within ~3s of each other — an early-fight spot */
  contested: boolean;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const sideOf = (round: ReplayRound, i: number, meta: ReplayMeta): Side => {
  if (round.ct?.includes(i)) return "CT";
  if (round.t?.includes(i)) return "T";
  return meta.players[i]?.team === "T" ? "T" : "CT";
};

/**
 * First-touch timing per call-out. `playerOk` scopes to one player (their own
 * arrival times); rounds are whatever the caller scoped (one round or all).
 */
export function zoneTimings(
  meta: ReplayMeta,
  rounds: ReplayRound[],
  zones: Zone[],
  playerOk: (i: number) => boolean = () => true,
): ZoneTouch[] {
  if (!zones.length) return [];
  const acc = new Map<string, { t: number[]; ct: number[] }>();
  for (const round of rounds) {
    if (!round.frames?.length) continue;
    const freezeEnd = round.freezeEnd ?? 15;
    const seen = new Map<string, { t?: number; ct?: number }>();
    for (const f of round.frames) {
      if (f.t < freezeEnd) continue;
      for (const p of f.p) {
        if (p.h <= 0 || !playerOk(p.i)) continue;
        const z = classifyPosition(meta.map, p.x, p.y, zones, p.z);
        if (!z) continue;
        let s = seen.get(z.name);
        if (!s) {
          s = {};
          seen.set(z.name, s);
        }
        const key = sideOf(round, p.i, meta) === "T" ? "t" : "ct";
        if (s[key] == null) s[key] = f.t - freezeEnd;
      }
    }
    for (const [zone, s] of seen) {
      let a = acc.get(zone);
      if (!a) {
        a = { t: [], ct: [] };
        acc.set(zone, a);
      }
      if (s.t != null) a.t.push(s.t);
      if (s.ct != null) a.ct.push(s.ct);
    }
  }
  const out: ZoneTouch[] = [];
  for (const [zone, a] of acc) {
    const t: SideTouch = { median: median(a.t), fastest: a.t.length ? Math.min(...a.t) : null, n: a.t.length };
    const ct: SideTouch = { median: median(a.ct), fastest: a.ct.length ? Math.min(...a.ct) : null, n: a.ct.length };
    out.push({
      zone,
      t,
      ct,
      contested: t.n >= 2 && ct.n >= 2 && Math.abs((t.median ?? 0) - (ct.median ?? 0)) <= 3,
    });
  }
  // earliest reach first — reads as "how map control unfolds"
  const first = (z: ZoneTouch) => Math.min(z.t.median ?? Infinity, z.ct.median ?? Infinity);
  return out.sort((a, b) => first(a) - first(b));
}

export interface SetupSpot {
  i: number; // player index
  name: string;
  side: Side;
  x: number;
  y: number;
  z?: number;
  dirDeg: number; // typical facing at that spot (circular mean, world degrees)
  n: number; // rounds sampled
  samples: { x: number; y: number; z?: number }[]; // per-round raw spots
}

/**
 * Where each player typically stands `atSec` seconds after freeze end, split
 * by side. The representative spot is the MEDOID round sample (the real
 * position closest to all the others) — a mean of an A-split and a B-split
 * would land in a wall. Facing averages the samples near the medoid only.
 */
export function earlySetups(meta: ReplayMeta, rounds: ReplayRound[], atSec: number): SetupSpot[] {
  const groups = new Map<string, { i: number; side: Side; pts: { x: number; y: number; z?: number; d: number }[] }>();
  for (const round of rounds) {
    if (!round.frames?.length) continue;
    const target = (round.freezeEnd ?? 15) + atSec;
    // nearest frame within ±2s of the target moment
    let best: (typeof round.frames)[number] | null = null;
    for (const f of round.frames) {
      if (Math.abs(f.t - target) > 2) continue;
      if (!best || Math.abs(f.t - target) < Math.abs(best.t - target)) best = f;
    }
    if (!best) continue;
    for (const p of best.p) {
      if (p.h <= 0) continue;
      const side = sideOf(round, p.i, meta);
      const key = `${p.i}:${side}`;
      let g = groups.get(key);
      if (!g) {
        g = { i: p.i, side, pts: [] };
        groups.set(key, g);
      }
      g.pts.push({ x: p.x, y: p.y, z: p.z, d: p.d });
    }
  }
  const out: SetupSpot[] = [];
  for (const g of groups.values()) {
    if (!g.pts.length) continue;
    // medoid: sample minimizing summed distance to the rest
    let mi = 0;
    let msum = Infinity;
    for (let a = 0; a < g.pts.length; a++) {
      let sum = 0;
      for (let b = 0; b < g.pts.length; b++) sum += Math.hypot(g.pts[a].x - g.pts[b].x, g.pts[a].y - g.pts[b].y);
      if (sum < msum) {
        msum = sum;
        mi = a;
      }
    }
    const m = g.pts[mi];
    // facing: circular mean over samples within 300u of the medoid (same spot)
    let sx = 0;
    let sy = 0;
    for (const p of g.pts) {
      if (Math.hypot(p.x - m.x, p.y - m.y) > 300) continue;
      sx += Math.cos((p.d * Math.PI) / 180);
      sy += Math.sin((p.d * Math.PI) / 180);
    }
    const dirDeg = (Math.atan2(sy, sx) * 180) / Math.PI;
    out.push({
      i: g.i,
      name: meta.players[g.i]?.name || `Player ${g.i}`,
      side: g.side,
      x: m.x,
      y: m.y,
      z: m.z,
      dirDeg,
      n: g.pts.length,
      samples: g.pts.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    });
  }
  return out;
}
