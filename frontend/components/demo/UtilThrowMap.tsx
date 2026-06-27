"use client";

import { useEffect, useRef } from "react";
import { hasCalibration, radarImage, worldToRadar } from "@/lib/maps/calibration";
import { KIND_COLOR } from "./RadarMap";
import type { UtilThrow } from "@/lib/demo/insights";

const SIZE = 600;
const TRAVEL = 0.55; // s — arc flight time
const STAGGER = 0.45; // s — gap between successive throws
const BLOOM = 1.2; // s — bloom expand
const HOLD = 1.8; // s — pause before the loop restarts

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
 * Animated utility map: replays each grenade arcing from the thrower to its
 * landing spot and blooming, on a loop. Repeated throws stack on the same spot,
 * so a consistent setup reads instantly. Calibrated maps use the real radar;
 * uncalibrated maps auto-scale to the throws' bounding box.
 */
export function UtilThrowMap({
  map,
  throws,
  className = "",
}: {
  map: string;
  throws: UtilThrow[];
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const imgOk = useRef(false);
  const rafRef = useRef(0);
  const startRef = useRef(0);

  const calibrated = hasCalibration(map);

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

  useEffect(() => {
    startRef.current = 0;

    // bounding box for uncalibrated auto-scale
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    if (!calibrated) {
      for (const t of throws) {
        for (const [x, y] of [
          [t.ox, t.oy],
          [t.x, t.y],
        ]) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      }
    }
    const sx = maxX - minX || 1;
    const sy = maxY - minY || 1;
    const pad = 0.08;
    const place = (x: number, y: number) => {
      if (calibrated) {
        const r = worldToRadar(map, x, y);
        return r ? { x: r.x * SIZE, y: r.y * SIZE } : { x: SIZE / 2, y: SIZE / 2 };
      }
      return {
        x: (pad + ((x - minX) / sx) * (1 - 2 * pad)) * SIZE,
        y: (pad + ((maxY - y) / sy) * (1 - 2 * pad)) * SIZE,
      };
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

      throws.forEach((t, i) => {
        const color = KIND_COLOR[t.kind] ?? "#5b9dff";
        const o = place(t.ox, t.oy);
        const land = place(t.x, t.y);
        const local = elapsed - i * STAGGER;

        // persistent faint landing marker so the cluster is always visible
        dot(ctx, land.x, land.y, 2.5, color, 0.5);
        if (local < 0) return;

        if (local < TRAVEL) {
          const k = local / TRAVEL;
          const px = o.x + (land.x - o.x) * k;
          const py = o.y + (land.y - o.y) * k - Math.sin(Math.PI * k) * 48;
          dot(ctx, px, py, 3.5, color, 0.95);
        } else if (local < TRAVEL + BLOOM) {
          const k = (local - TRAVEL) / BLOOM;
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
  }, [map, throws, calibrated]);

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
