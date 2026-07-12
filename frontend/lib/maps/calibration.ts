// Per-map radar calibration — the proven transform + constants from the prior
// working build (csgomap), reconciled with each map's meta.json5. Converts demo
// world coords to a 0..1 fraction of the 1024px radar image.
//
//   gameX = worldX + offset_x ;  pixelX = gameX / resolution ;  left% = pixelX/1024*100
//   y is flipped to top-origin; Nuke/Vertigo apply a z-based split offset.
//
// Radar images live at /maps/<map>/radar.png (1024x1024), copied from the
// reference project.

export interface MapConfig {
  offset_x: number;
  offset_y: number;
  resolution: number;
  splits?: { bounds: { top: number; bottom: number }; offset: { x: number; y: number } }[];
  advisoryPosition?: { x: number; y: number };
}

export const MAP_CONFIGS: Record<string, MapConfig> = {
  de_ancient: { offset_x: 2590, offset_y: 2520, resolution: 4.26, advisoryPosition: { x: 7, y: 12 } },
  de_anubis: { offset_x: 2830, offset_y: 2030, resolution: 5.25, advisoryPosition: { x: 76, y: 12 } },
  de_cache: { offset_x: 2020, offset_y: 2390, resolution: 5.54, advisoryPosition: { x: 72, y: 69 } },
  de_dust2: { offset_x: 2470, offset_y: 1255, resolution: 4.4, advisoryPosition: { x: 76.6, y: 17 } },
  de_inferno: { offset_x: 2090, offset_y: 1150, resolution: 4.91, advisoryPosition: { x: 16, y: 56 } },
  de_mirage: { offset_x: 3240, offset_y: 3410, resolution: 5.02, advisoryPosition: { x: 10, y: 39.5 } },
  de_nuke: {
    offset_x: 3290,
    offset_y: 5990,
    resolution: 6.98,
    splits: [{ bounds: { top: -482, bottom: -2500 }, offset: { x: 0, y: -46 } }],
    advisoryPosition: { x: 20, y: 30 },
  },
  de_overpass: { offset_x: 4830, offset_y: 3540, resolution: 5.18, advisoryPosition: { x: 72, y: 84 } },
  de_train: { offset_x: 2730, offset_y: 2360, resolution: 4.74, advisoryPosition: { x: 10, y: 56 } },
  de_vertigo: {
    offset_x: 3890,
    offset_y: 3800,
    resolution: 4.96,
    splits: [{ bounds: { top: 11680, bottom: 0 }, offset: { x: 0.2, y: -42.6 } }],
    advisoryPosition: { x: 68, y: 84 },
  },
};

export function normalizeMapName(mapName: string): string {
  if (!mapName) return "";
  const n = mapName.toLowerCase();
  if (n.startsWith("de_")) return n;
  const shorthand: Record<string, string> = {
    ancient: "de_ancient",
    anubis: "de_anubis",
    cache: "de_cache",
    dust2: "de_dust2",
    inferno: "de_inferno",
    mirage: "de_mirage",
    nuke: "de_nuke",
    overpass: "de_overpass",
    train: "de_train",
    vertigo: "de_vertigo",
  };
  return shorthand[n] || `de_${n}`;
}

// The current CS2 Premier active-duty map pool (normalized de_ keys). The map
// win-rate radar is locked to these so retired/community maps (Overpass,
// Vertigo, Train, workshop maps, …) don't appear as vertices or skew a player's
// Premier map profile.
export const PREMIER_ACTIVE_MAPS: ReadonlySet<string> = new Set([
  "de_ancient",
  "de_anubis",
  "de_cache",
  "de_dust2",
  "de_inferno",
  "de_mirage",
  "de_nuke",
]);

export function isActivePremierMap(map: string): boolean {
  return PREMIER_ACTIVE_MAPS.has(normalizeMapName(map));
}

export function hasCalibration(map: string): boolean {
  return normalizeMapName(map) in MAP_CONFIGS;
}

export function mapConfig(map: string): MapConfig | null {
  return MAP_CONFIGS[normalizeMapName(map)] ?? null;
}

/** world (x,y[,z]) -> 0..1 fraction of the radar image (top-left origin), or
 *  null for an unsupported map (caller should disable the radar / auto-scale). */
export function worldToRadar(
  map: string,
  x: number,
  y: number,
  z?: number,
): { x: number; y: number } | null {
  const c = MAP_CONFIGS[normalizeMapName(map)];
  if (!c) return null;
  let left = ((x + c.offset_x) / c.resolution / 1024) * 100;
  let bottom = ((y + c.offset_y) / c.resolution / 1024) * 100;
  if (c.splits && z != null) {
    for (const s of c.splits) {
      if (z >= s.bounds.bottom && z <= s.bounds.top) {
        left += s.offset.x;
        bottom += s.offset.y;
        break;
      }
    }
  }
  return { x: left / 100, y: (100 - bottom) / 100 };
}

/** Radar image URL for a map (1024x1024 PNG). */
export function radarImage(map: string): string {
  return `/maps/${normalizeMapName(map)}/radar.png`;
}
