// Route analytics derived from §5 replay data (lib/demo/types.ts).
//
// We reconstruct each player's movement path per round from the 1 Hz frames,
// then cluster the paths into "common routes" per side using a coarse spatial
// signature. Each player path runs from round start until the player dies
// (health hits 0 and they vanish from later frames) or the round ends.
//
// All coordinates stay in raw world space here; the component converts them to
// radar fractions with worldToRadar at render time.

import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";

export type Side = "CT" | "T";

export interface RoutePoint { x: number; y: number; z?: number; t: number; }

export interface PlayerPath {
  key: string; round: number; roundIdx: number; playerIndex: number;
  playerName: string; side: Side; points: RoutePoint[]; died: boolean;
  lifetime: number; won: boolean;
  kills: { x: number; y: number; z?: number }[];
  death: { x: number; y: number; z?: number } | null; signature: string;
}

export interface RouteCluster {
  id: string; side: Side; label: string; paths: PlayerPath[]; usage: number;
  share: number; winRate: number; avgLifetime: number; kills: number; deaths: number;
  centroid: RoutePoint[];
  killPositions: { x: number; y: number; z?: number }[];
  deathPositions: { x: number; y: number; z?: number }[];
  /** catch-all bucket of one-off paths, rendered last — not a real route */
  uncommon?: boolean;
}

export interface RouteAnalysis {
  paths: PlayerPath[]; clusters: RouteCluster[];
  players: { index: number; name: string }[]; rounds: number;
}

const sideOf = (round: ReplayRound, i: number, meta: ReplayMeta): Side => {
  if (round.ct?.includes(i)) return "CT";
  if (round.t?.includes(i)) return "T";
  return meta.players[i]?.team === "T" ? "T" : "CT";
};

function buildPaths(meta: ReplayMeta, rounds: ReplayRound[]): PlayerPath[] {
  const out: PlayerPath[] = [];
  rounds.forEach((round, roundIdx) => {
    if (!round.frames?.length) return;
    const samples = new Map<number, RoutePoint[]>();
    const lastHealth = new Map<number, number>();
    for (const f of round.frames) {
      for (const p of f.p) {
        let arr = samples.get(p.i);
        if (!arr) { arr = []; samples.set(p.i, arr); }
        if (p.h <= 0) { lastHealth.set(p.i, 0); continue; }
        if (lastHealth.get(p.i) === 0) continue;
        arr.push({ x: p.x, y: p.y, t: f.t });
        lastHealth.set(p.i, p.h);
      }
    }
    for (const [i, points] of samples) {
      if (points.length < 3) continue;
      const side = sideOf(round, i, meta);
      const player = meta.players[i];
      if (!player) continue;
      const death = (round.kills ?? []).find((k) => k.v === i) ?? null;
      const kills = (round.kills ?? []).filter((k) => k.k === i).map((k) => ({ x: k.kx, y: k.ky }));
      out.push({
        key: `${round.n}-${i}`, round: round.n, roundIdx, playerIndex: i,
        playerName: player.name || `Player ${i}`, side, points,
        died: !!death, lifetime: points[points.length - 1].t - points[0].t,
        won: round.winner === side, kills,
        death: death ? { x: death.vx, y: death.vy } : null, signature: "",
      });
    }
  });
  const bounds = coordBounds(out);
  for (const p of out) p.signature = signaturize(p.points, bounds);
  return out;
}

interface Bounds { minX: number; minY: number; spanX: number; spanY: number; }
function coordBounds(paths: PlayerPath[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of paths) for (const pt of p.points) {
    if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, spanX: 1, spanY: 1 };
  return { minX, minY, spanX: maxX - minX || 1, spanY: maxY - minY || 1 };
}

const GRID = 8; const WAYPOINTS = 5;
function cell(x: number, y: number, b: Bounds): string {
  const gx = Math.min(GRID - 1, Math.max(0, Math.floor(((x - b.minX) / b.spanX) * GRID)));
  const gy = Math.min(GRID - 1, Math.max(0, Math.floor(((y - b.minY) / b.spanY) * GRID)));
  return `${gx},${gy}`;
}
function resample(points: RoutePoint[], n: number): RoutePoint[] {
  if (points.length <= n) return points.slice();
  const out: RoutePoint[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i / (n - 1)) * (points.length - 1));
    out.push(points[idx]);
  }
  return out;
}
function signaturize(points: RoutePoint[], b: Bounds): string {
  return resample(points, WAYPOINTS).map((p) => cell(p.x, p.y, b)).join("|");
}

// exported: RouteAnalytics re-averages after player/side filtering so labels,
// "reaches" times and timing ticks describe the paths actually shown
export function averagePath(paths: PlayerPath[]): RoutePoint[] {
  const resampled = paths.map((p) => resample(p.points, WAYPOINTS));
  const n = Math.max(...resampled.map((r) => r.length));
  const out: RoutePoint[] = [];
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0, st = 0, c = 0;
    for (const r of resampled) {
      const pt = r[Math.min(i, r.length - 1)];
      sx += pt.x; sy += pt.y; st += pt.t; c++;
    }
    out.push({ x: sx / c, y: sy / c, t: st / c });
  }
  return out;
}

const parseSig = (sig: string): [number, number][] =>
  sig.split("|").map((c) => c.split(",").map(Number) as [number, number]);

// Two signatures describe "the same route" when they END in the same or an
// adjacent grid cell (the destination is what defines a route) AND either at
// most 1 of the remaining waypoint cells differ OR every waypoint pair sits
// within one grid cell (adjacent centroids). Byte-identical grouping alone
// shatters routes into 1× singletons with degenerate 0%/100% win rates, while
// destination-blind merging would fold an A-site push into a B-site push.
function sigsMergeable(a: [number, number][], b: [number, number][]): boolean {
  const la = a[a.length - 1];
  const lb = b[b.length - 1];
  if (Math.abs(la[0] - lb[0]) > 1 || Math.abs(la[1] - lb[1]) > 1) return false;
  const n = Math.max(a.length, b.length);
  let diff = 0;
  let near = true;
  for (let i = 0; i < n - 1; i++) {
    const pa = a[Math.min(i, a.length - 1)];
    const pb = b[Math.min(i, b.length - 1)];
    if (pa[0] !== pb[0] || pa[1] !== pb[1]) diff++;
    if (Math.abs(pa[0] - pb[0]) > 1 || Math.abs(pa[1] - pb[1]) > 1) near = false;
  }
  return diff <= 1 || near;
}

function makeCluster(
  side: Side, id: string, label: string, members: PlayerPath[], total: number, uncommon = false,
): RouteCluster {
  const wins = members.filter((m) => m.won).length;
  return {
    id, side, label, paths: members, usage: members.length, share: members.length / total,
    winRate: wins / members.length,
    avgLifetime: members.reduce((s, m) => s + m.lifetime, 0) / members.length,
    kills: members.reduce((s, m) => s + m.kills.length, 0),
    deaths: members.filter((m) => m.died).length,
    // an average of unrelated one-offs is meaningless — the bucket gets none
    centroid: uncommon ? [] : averagePath(members),
    killPositions: members.flatMap((m) => m.kills),
    deathPositions: members.flatMap((m) => (m.death ? [m.death] : [])),
    ...(uncommon ? { uncommon: true } : {}),
  };
}

function clusterSide(paths: PlayerPath[], side: Side): RouteCluster[] {
  const sidePaths = paths.filter((p) => p.side === side);
  const total = sidePaths.length || 1;
  const groups = new Map<string, PlayerPath[]>();
  for (const p of sidePaths) {
    const arr = groups.get(p.signature);
    if (arr) arr.push(p); else groups.set(p.signature, [p]);
  }
  // merge near-identical signature groups — biggest first so it anchors
  const merged: { sig: [number, number][]; members: PlayerPath[] }[] = [];
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [sig, members] of ordered) {
    const cells = parseSig(sig);
    const home = merged.find((m) => sigsMergeable(m.sig, cells));
    if (home) home.members.push(...members);
    else merged.push({ sig: cells, members: [...members] });
  }
  const clusters: RouteCluster[] = [];
  const loners: PlayerPath[] = [];
  let idx = 0;
  for (const m of merged) {
    if (m.members.length === 1) { loners.push(...m.members); continue; }
    const sigStr = m.sig.map((c) => c.join(",")).join("|");
    clusters.push(makeCluster(side, `${side}-${idx++}`, routeLabel(side, m.members.length, sigStr), m.members, total));
  }
  clusters.sort((a, b) => b.usage - a.usage);
  if (loners.length)
    clusters.push(makeCluster(side, `${side}-uncommon`, "Uncommon routes", loners, total, true));
  return clusters;
}

function routeLabel(side: Side, usage: number, sig: string): string {
  const cells = sig.split("|");
  const [gx, gy] = cells[cells.length - 1].split(",").map(Number);
  const h = gx < GRID / 3 ? "West" : gx > (2 * GRID) / 3 ? "East" : "Center";
  // world y grows northward, so HIGH gy (near maxY) is North — the old check
  // was inverted relative to the radar
  const v = gy > (2 * GRID) / 3 ? "North" : gy < GRID / 3 ? "South" : "Mid";
  const region = v === "Mid" && h === "Center" ? "Mid" : `${v} ${h}`;
  return `${region} (${usage}×)`;
}

export function analyzeRoutes(meta: ReplayMeta, rounds: ReplayRound[]): RouteAnalysis {
  const paths = buildPaths(meta, rounds);
  const clusters = [...clusterSide(paths, "T"), ...clusterSide(paths, "CT")];
  const seen = new Map<number, string>();
  for (const p of paths) if (!seen.has(p.playerIndex)) seen.set(p.playerIndex, p.playerName);
  const players = [...seen.entries()].map(([index, name]) => ({ index, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { paths, clusters, players, rounds: rounds.length };
}