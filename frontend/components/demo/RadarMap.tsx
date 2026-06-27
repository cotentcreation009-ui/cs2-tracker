"use client";

import { useMemo } from "react";
import { hasCalibration, radarImage, worldToRadar } from "@/lib/maps/calibration";

export interface MapDot {
  x: number;
  y: number;
  z?: number;
  kind?: string;
  round?: number;
}

// Shared colours for grenade kinds, reused by the legend.
export const KIND_COLOR: Record<string, string> = {
  smoke: "#cfd6e4",
  flash: "#ffd54a",
  he: "#f5694a",
  molotov: "#ff8a3d",
  decoy: "#7c8aa5",
};

export const KIND_LABEL: Record<string, string> = {
  smoke: "Smoke",
  flash: "Flash",
  he: "HE",
  molotov: "Molotov",
  decoy: "Decoy",
};

/**
 * Plots world-space points over a map's radar image. Calibrated maps use the
 * real transform; uncalibrated maps fall back to auto-scaling the points to
 * their own bounding box so the shape of a setup is still visible.
 */
export function RadarMap({
  map,
  dots,
  className = "",
}: {
  map: string;
  dots: MapDot[];
  className?: string;
}) {
  const calibrated = hasCalibration(map);

  const placed = useMemo(() => {
    if (calibrated) {
      return dots
        .map((d) => ({ d, p: worldToRadar(map, d.x, d.y, d.z) }))
        .filter((x): x is { d: MapDot; p: { x: number; y: number } } => x.p != null);
    }
    if (!dots.length) return [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const d of dots) {
      minX = Math.min(minX, d.x); maxX = Math.max(maxX, d.x);
      minY = Math.min(minY, d.y); maxY = Math.max(maxY, d.y);
    }
    const sx = maxX - minX || 1;
    const sy = maxY - minY || 1;
    const pad = 0.08;
    return dots.map((d) => ({
      d,
      p: {
        x: pad + ((d.x - minX) / sx) * (1 - 2 * pad),
        y: pad + ((maxY - d.y) / sy) * (1 - 2 * pad),
      },
    }));
  }, [map, dots, calibrated]);

  return (
    <div
      className={`relative aspect-square overflow-hidden rounded-xl border border-line bg-panel2 ${className}`}
    >
      {calibrated && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={radarImage(map)}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-70"
        />
      )}
      <div className="absolute inset-0">
        {placed.map(({ d, p }, i) => (
          <span
            key={i}
            title={d.round ? `${KIND_LABEL[d.kind ?? ""] ?? d.kind ?? ""} · round ${d.round}` : d.kind}
            className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/40"
            style={{
              left: `${p.x * 100}%`,
              top: `${p.y * 100}%`,
              background: KIND_COLOR[d.kind ?? ""] ?? "#5b9dff",
              boxShadow: "0 0 6px rgba(0,0,0,.45)",
              opacity: 0.85,
            }}
          />
        ))}
      </div>
      {placed.length === 0 && (
        <div className="absolute inset-0 grid place-items-center text-sm text-faint">
          No positions
        </div>
      )}
      {!calibrated && placed.length > 0 && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-mid/15 px-2 py-0.5 text-[10px] text-mid">
          {map} radar uncalibrated — auto-scaled
        </div>
      )}
    </div>
  );
}
