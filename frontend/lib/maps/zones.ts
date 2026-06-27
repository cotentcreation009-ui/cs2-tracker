// Call-out zones, per map, in radar-normalized (0..1) space. A zone is either an
// ANCHOR (one point — nearest-anchor / Voronoi classification) or a POLYGON
// (3+ points — precise point-in-polygon). Every map ships a built-in "Default
// callouts" set (lib/maps/callouts.ts, anchors). Users can clone the defaults
// into their own named set and rename / move / redraw, or draw a set from
// scratch; custom sets + the active selection live in localStorage.

import { worldToRadar } from "./calibration";
import { defaultCallouts } from "./callouts";

export type ZoneKind = "A" | "B" | "Mid" | "other";

export interface Zone {
  id: string;
  name: string;
  kind: ZoneKind;
  points: { x: number; y: number }[]; // radar-normalized 0..1 (1 = anchor, 3+ = polygon)
}

export interface ZoneSet {
  id: string;
  name: string;
  zones: Zone[];
}

export const DEFAULT_SET_ID = "default";

const setsKey = (map: string) => `statrun:zonesets:${map}`;
const activeKey = (map: string) => `statrun:zoneset-active:${map}`;
const legacyKey = (map: string) => `statrun:zones:${map}`;

export const ZONE_COLOR: Record<ZoneKind, string> = {
  A: "#f5694a",
  B: "#5b9dff",
  Mid: "#f5b942",
  other: "#8a7dff",
};

export function newZoneId(): string {
  return (
    (globalThis.crypto?.randomUUID?.() as string) ??
    `z_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
  );
}

// ---- default set ----------------------------------------------------------

const toKind = (s: string): ZoneKind => (s === "A" || s === "B" || s === "Mid" ? s : "other");

export function defaultZoneSet(map: string): ZoneSet {
  return {
    id: DEFAULT_SET_ID,
    name: "Default callouts",
    zones: defaultCallouts(map).map((c, i) => ({
      id: `def_${i}`,
      name: c.name,
      kind: toKind(c.site),
      points: [{ x: c.x, y: c.y }],
    })),
  };
}

// ---- custom sets (localStorage) -------------------------------------------

export function loadCustomSets(map: string): ZoneSet[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(setsKey(map));
    if (raw) return JSON.parse(raw) as ZoneSet[];
    // migrate a legacy single zone list into a set so old work isn't lost
    const legacy = localStorage.getItem(legacyKey(map));
    if (legacy) {
      const zones = JSON.parse(legacy) as Zone[];
      if (zones.length) return [{ id: "my", name: "My callouts", zones }];
    }
    return [];
  } catch {
    return [];
  }
}

export function saveCustomSets(map: string, sets: ZoneSet[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(setsKey(map), JSON.stringify(sets));
  } catch {
    /* quota / private mode */
  }
}

export function loadActiveSetId(map: string): string {
  if (typeof localStorage === "undefined") return DEFAULT_SET_ID;
  return localStorage.getItem(activeKey(map)) || DEFAULT_SET_ID;
}

export function saveActiveSetId(map: string, id: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(activeKey(map), id);
  } catch {
    /* ignore */
  }
}

/** Default set first, then the user's custom sets. */
export function allZoneSets(map: string): ZoneSet[] {
  return [defaultZoneSet(map), ...loadCustomSets(map)];
}

/** Zones from the active set for a map — what every consumer should classify against. */
export function getActiveZones(map: string): Zone[] {
  const id = loadActiveSetId(map);
  if (id !== DEFAULT_SET_ID) {
    const set = loadCustomSets(map).find((s) => s.id === id);
    if (set) return set.zones;
  }
  return defaultZoneSet(map).zones;
}

// ---- classification -------------------------------------------------------

export function pointInPolygon(
  pt: { x: number; y: number },
  poly: { x: number; y: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const intersect =
      a.y > pt.y !== b.y > pt.y &&
      pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

function polyArea(poly: { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return Math.abs(a) / 2;
}

/**
 * Classify a world position into a named zone: the most-specific (smallest)
 * polygon that contains it wins; otherwise the nearest anchor; else null.
 */
export function classifyPosition(
  map: string,
  worldX: number,
  worldY: number,
  zones: Zone[],
): Zone | null {
  const r = worldToRadar(map, worldX, worldY);
  if (!r) return null;

  let bestPoly: Zone | null = null;
  let bestArea = Infinity;
  let bestAnchor: Zone | null = null;
  let bestDist = Infinity;
  for (const z of zones) {
    if (z.points.length >= 3) {
      if (pointInPolygon(r, z.points)) {
        const a = polyArea(z.points);
        if (a < bestArea) {
          bestArea = a;
          bestPoly = z;
        }
      }
    } else if (z.points.length === 1) {
      const p = z.points[0];
      const d = (p.x - r.x) * (p.x - r.x) + (p.y - r.y) * (p.y - r.y);
      if (d < bestDist) {
        bestDist = d;
        bestAnchor = z;
      }
    }
  }
  return bestPoly ?? bestAnchor;
}

// ---- legacy shims (kept for the standalone editor / older callers) ---------

export function loadZones(map: string): Zone[] {
  return getActiveZones(map);
}
export function saveZones(map: string, zones: Zone[]): void {
  // persist as a single "My callouts" custom set + make it active
  const sets = loadCustomSets(map).filter((s) => s.id !== "my");
  const next = [...sets, { id: "my", name: "My callouts", zones }];
  saveCustomSets(map, next);
  saveActiveSetId(map, "my");
}
