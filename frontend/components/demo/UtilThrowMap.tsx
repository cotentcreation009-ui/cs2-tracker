"use client";

import { useEffect, useRef } from "react";
import { radarImage } from "@/lib/maps/calibration";
import type { Projection } from "@/lib/demo/projection";
import type { UtilThrow } from "@/lib/demo/insights";
import { KIND_COLOR } from "./RadarMap";
import { ZONE_COLOR, type Zone } from "@/lib/maps/zones";

const SIZE = 600;

// Bloom radius as a fraction of the radar, per grenade kind.
const BLOOM_R: Record<string, number> = {
  smoke: 0.09,
  molotov: 0.07,
  he: 0.06,
  flash: 0.05,
  decoy: 0.045,
};

const easeOut = (k: number) => 1 - (1 - k) * (1 - k);

function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
}

function dot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  a: number,
) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = hexA(color, a);
  ctx.fill();
}

/**
 * Animated utility map. Each grenade arcs from the thrower to its landing and
 * blooms, on a loop, using the shared match projection so it aligns with every
 * other lens. With a single throw it runs in "solo" mode — slower, with a
 * persistent dashed trajectory — so you can study one exact lineup. Optional
 * zone polygons (call-outs) are drawn underneath on calibrated maps.
 */
export function UtilThrowMap({
  map,
  proj,
  throws,
  zones = [],
  className = "",
}: {
  map: string;
  proj: Projection;
  throws: UtilThrow[];
  zones?: Zone[];
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const imgOk = useRef(false);
  const rafRef = useRef(0);
  const startRef = useRef(0);

  const calibrated = proj.calibrated;

  useEffect(() => {
    let alive = true;
    imgOk.current = false;
    imgRef.current = null;
    if (!calibrated) return;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      imgRef.current = img;
      imgOk.current = true;
    };
    img.onerror = () => {
      if (alive) imgOk.current = false;
    };
    img.src = radarImage(map);
    return () => {
      alive = false;
    };
  }, [map, calibrated]);

  // stable signature so the animation only restarts when the throws actually
  // change, not on every unrelated parent re-render
  const throwsSig = throws.map((t) => `${t.round}:${t.t}:${t.kind}`).join("|");

  useEffect(() => {
    startRef.current = 0;
    const solo = throws.length === 1;
    const TRAVEL = solo ? 0.95 : 0.55;
    const STAGGER = solo ? 0 : 0.45;
    const BLOOM = solo ? 1.6 : 1.2;
    const HOLD = solo ? 1.2 : 1.8;

    const place = (x: number, y: number) => {
      const r = proj.project(x, y);
      return r ? { x: r.x * SIZE, y: r.y * SIZE } : { x: SIZE / 2, y: SIZE / 2 };
    };

    const total = throws.length
      ? (throws.length - 1) * STAGGER + TRAVEL + BLOOM + HOLD
      : 1;

    const frame = (ts: number) => {
      rafRef.current = requestAnimationFrame(frame);
      const cv = canvasRef.current;
      if (!cv) return;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      if (!startRef.current) startRef.current = ts;
      const elapsed = ((ts - startRef.current) / 1000) % total;

      ctx.clearRect(0, 0, SIZE, SIZE);
      if (imgOk.current && imgRef.current) {
        ctx.globalAlpha = 0.6;
        ctx.drawImage(imgRef.current, 0, 0, SIZE, SIZE);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = "#0a1020";
        ctx.fillRect(0, 0, SIZE, SIZE);
        ctx.strokeStyle = "rgba(56,214,255,0.06)";
        for (let g = 0; g <= SIZE; g += SIZE / 16) {
          ctx.beginPath();
          ctx.moveTo(g, 0); ctx.lineTo(g, SIZE);
          ctx.moveTo(0, g); ctx.lineTo(SIZE, g);
          ctx.stroke();
        }
      }

      // zone call-outs (only meaningful when calibrated — radar-normalized)
      if (calibrated) {
        ctx.font = "10px sans-serif";
        ctx.textAlign = "center";
        for (const z of zones) {
          if (z.points.length < 3) continue;
          ctx.beginPath();
          z.points.forEach((p, i) => {
            const x = p.x * SIZE, y = p.y * SIZE;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.closePath();
          const zc = ZONE_COLOR[z.kind] ?? "#8a7dff";
          ctx.fillStyle = hexA(zc, 0.08);
          ctx.fill();
          ctx.strokeStyle = hexA(zc, 0.35);
          ctx.lineWidth = 1;
          ctx.stroke();
          const cx = (z.points.reduce((s, p) => s + p.x, 0) / z.points.length) * SIZE;
          const cy = (z.points.reduce((s, p) => s + p.y, 0) / z.points.length) * SIZE;
          ctx.fillStyle = "rgba(230,238,248,0.45)";
          ctx.fillText(z.name, cx, cy);
        }
        ctx.textAlign = "left";
      }

      // solo: persistent dashed trajectory so the lineup reads at a glance
      // (only when both ends actually project onto the map)
      if (solo) {
        const t = throws[0];
        // origin === landing means the origin couldn't be resolved (legacy demo)
        // — draw no lineup line rather than a zero-length one.
        const hasOrigin = t.ox !== t.x || t.oy !== t.y;
        const op = hasOrigin ? proj.project(t.ox, t.oy) : null;
        const lp = proj.project(t.x, t.y);
        if (op && lp) {
          const color = KIND_COLOR[t.kind] ?? "#5b9dff";
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = hexA(color, 0.4);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(op.x * SIZE, op.y * SIZE);
          ctx.lineTo(lp.x * SIZE, lp.y * SIZE);
          ctx.stroke();
          ctx.setLineDash([]);
          dot(ctx, op.x * SIZE, op.y * SIZE, 3, color, 0.75);
        }
      }

      throws.forEach((t, i) => {
        const color = KIND_COLOR[t.kind] ?? "#5b9dff";
        const hasOrigin = t.ox !== t.x || t.oy !== t.y;
        const o = place(t.ox, t.oy);
        const land = place(t.x, t.y);
        const local = elapsed - i * STAGGER;
        // no resolved origin → skip the travel arc and bloom at the landing
        const bloomStart = hasOrigin ? TRAVEL : 0;

        dot(ctx, land.x, land.y, 2.5, color, 0.5);
        if (local < 0) return;

        if (hasOrigin && local < TRAVEL) {
          const k = local / TRAVEL;
          const px = o.x + (land.x - o.x) * k;
          const py = o.y + (land.y - o.y) * k - Math.sin(Math.PI * k) * 48;
          dot(ctx, px, py, solo ? 4.5 : 3.5, color, 0.95);
        } else if (local < bloomStart + BLOOM) {
          const k = (local - bloomStart) / BLOOM;
          const R = (BLOOM_R[t.kind] ?? 0.05) * SIZE * easeOut(k);
          const a = t.kind === "flash" ? 1 - k : 0.5 * (1 - k) + 0.18;
          ctx.beginPath();
          ctx.arc(land.x, land.y, R, 0, Math.PI * 2);
          ctx.fillStyle = hexA(color, a * 0.45);
          ctx.fill();
          ctx.strokeStyle = hexA(color, a);
          ctx.lineWidth = 2;
          ctx.stroke();
          dot(ctx, land.x, land.y, 3, color, 1);
        }
      });
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proj, throwsSig, zones, calibrated, map]);

  return (
    <div className={`relative ${className}`}>
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        className="aspect-square w-full rounded-xl border border-line bg-panel2"
      />
      {!calibrated && throws.length > 0 && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-mid/15 px-2 py-0.5 text-[10px] text-mid">
          {map} radar uncalibrated — auto-scaled
        </div>
      )}
    </div>
  );
}
