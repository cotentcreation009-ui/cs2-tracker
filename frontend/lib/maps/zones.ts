// Custom callout zones, defined per map in radar-normalized (0..1) space so they
// are independent of display size and reusable across every match on that map.
// Stored in localStorage. point-in-polygon classification maps any world
// position to its named zone (A site / B site / Mid / custom).

import { worldToRadar } from "./calibration";

export type ZoneKind = "A" | "B" | "Mid" | "other";

export interface Zone {
  id: string;
  name: string;
  kind: ZoneKind;
  points: { x: number; y: number }[]; // radar-normalized 0..1
}

const key = (map: string) => `statrun:zones:${map}`;

export function loadZones(map: string): Zone[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(key(map));
    return raw ? (JSON.parse(raw) as Zone[]) : [];
  } catch {
    return [];
  }
}

export function saveZones(map: string, zones: Zone[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key(map), JSON.stringify(zones));
  } catch {
    /* quota / private mode — ignore */
  }
}

export function newZoneId(): string {
  return (
    (globalThis.crypto?.randomUUID?.() as string) ??
    `z_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
  );
}

export const ZONE_COLOR: Record<ZoneKind, string> = {
  A: "#f5694a",
  B: "#5b9dff",
  Mid: "#f5b942",
  other: "#8a7dff",
};

// ray-casting point-in-polygon on normalized points
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

/** Classify a world-space position into a named zone for a map, or null. */
export function classifyPosition(
  map: string,
  worldX: number,
  worldY: number,
  zones: Zone[],
): Zone | null {
  const r = worldToRadar(map, worldX, worldY);
  if (!r) return null;
  for (const z of zones) {
    if (z.points.length >= 3 && pointInPolygon(r, z.points)) return z;
  }
  return null;
}
