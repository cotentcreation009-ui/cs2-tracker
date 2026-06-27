// One world→radar projection shared by every demo lens (replay, routes,
// heatmap, insights, util). Using a single transform means a world point lands
// on the same pixel in every view — the core of making the lenses feel like one
// map. Calibrated maps use the real radar calibration; uncalibrated maps
// auto-scale to the whole match's bounds (square aspect, matching the radar).

import { hasCalibration, worldToRadar } from "@/lib/maps/calibration";
import type { ReplayRound } from "./types";

export interface Projection {
  calibrated: boolean;
  /** world (x,y) → fraction {x,y} in 0..1, or null if it can't be placed. */
  project: (x: number, y: number) => { x: number; y: number } | null;
}

export function buildProjection(map: string, rounds: ReplayRound[]): Projection {
  if (hasCalibration(map)) {
    return { calibrated: true, project: (x, y) => worldToRadar(map, x, y) };
  }

  // No calibration — derive a square bounding box from every world point in the
  // match so all lenses share one auto-scale.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ext = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const r of rounds) {
    for (const f of r.frames ?? []) for (const p of f.p) ext(p.x, p.y);
    for (const k of r.kills ?? []) {
      ext(k.vx, k.vy);
      if (k.k >= 0) ext(k.kx, k.ky);
    }
    for (const n of r.nades ?? []) ext(n.x, n.y);
    for (const b of r.bomb ?? []) ext(b.x, b.y);
  }
  if (!Number.isFinite(minX)) {
    return { calibrated: false, project: () => ({ x: 0.5, y: 0.5 }) };
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const pad = 0.06;
  return {
    calibrated: false,
    project: (x, y) => ({
      x: pad + ((x - minX) / span) * (1 - 2 * pad),
      y: pad + ((maxY - y) / span) * (1 - 2 * pad),
    }),
  };
}
