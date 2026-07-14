"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { radarImage } from "@/lib/maps/calibration";
import type { Projection } from "@/lib/demo/projection";
import type { UtilThrow } from "@/lib/demo/insights";
import { KIND_COLOR } from "./RadarMap";

// Internal canvas resolution. The map can render ~800+ CSS px wide in the
// viewport-locked pane, so 1024 (the radar source resolution) keeps it crisp.
const SIZE = 1024;

// Effect radius as a fraction of the radar, per grenade kind.
const BLOOM_R: Record<string, number> = {
  smoke: 0.082,
  molotov: 0.062,
  inferno: 0.062,
  he: 0.055,
  flash: 0.05,
  decoy: 0.042,
};

const easeOutQuad = (k: number) => 1 - (1 - k) * (1 - k);
const easeOutCubic = (k: number) => 1 - Math.pow(1 - k, 3);

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

// quadratic bezier point
function bez(
  o: { x: number; y: number },
  c: { x: number; y: number },
  l: { x: number; y: number },
  k: number,
) {
  const u = 1 - k;
  return {
    x: u * u * o.x + 2 * u * k * c.x + k * k * l.x,
    y: u * u * o.y + 2 * u * k * c.y + k * k * l.y,
  };
}

interface Item {
  t: UtilThrow;
  color: string;
  hasOrigin: boolean;
  o: { x: number; y: number };
  l: { x: number; y: number };
  c: { x: number; y: number }; // bezier control (arc apex)
  start: number; // when this throw begins in the loop
  land: number; // when it lands (start + travel, or start if no origin)
}

/**
 * Animated utility map. Every throw shows its arc as a persistent dashed
 * lineup path; a glowing projectile traces the arc and lands with a
 * kind-specific effect — smokes billow and LINGER (so an execute builds up on
 * screen), mollies flicker, flashes burst with rays, HEs shockwave, decoys
 * ping. With a single throw it runs in "solo" mode — slower, with an
 * emphasized path and origin marker — so one exact lineup can be studied.
 * Pause/replay and wheel-zoom/drag-pan are built in.
 */
export function UtilThrowMap({
  map,
  proj,
  throws,
  className = "",
}: {
  map: string;
  proj: Projection;
  throws: UtilThrow[];
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const imgOk = useRef(false);
  const rafRef = useRef(0);
  const elapsedRef = useRef(0);
  const lastTsRef = useRef(0);
  const playingRef = useRef(true);
  const [playing, setPlaying] = useState(true);

  const calibrated = proj.calibrated;

  // zoom/pan viewport in SIZE-space px (screen = world*scale + offset)
  const [vp, setVp] = useState({ scale: 1, ox: 0, oy: 0 });
  const vpRef = useRef(vp);
  const dragRef = useRef<{ cx: number; cy: number; ox: number; oy: number } | null>(null);
  const setViewport = useCallback((v: { scale: number; ox: number; oy: number }) => {
    vpRef.current = v;
    setVp(v);
  }, []);
  const clampVp = useCallback((scale: number, ox: number, oy: number) => {
    const s = Math.max(1, Math.min(6, scale));
    const min = SIZE * (1 - s);
    return { scale: s, ox: Math.max(min, Math.min(0, ox)), oy: Math.max(min, Math.min(0, oy)) };
  }, []);
  const zoomBy = (factor: number) => {
    const cur = vpRef.current;
    const ns = Math.max(1, Math.min(6, cur.scale * factor));
    if (ns === cur.scale) return;
    const k = ns / cur.scale;
    const c = SIZE / 2;
    setViewport(clampVp(ns, c - (c - cur.ox) * k, c - (c - cur.oy) * k));
  };
  const onDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const v = vpRef.current;
    dragRef.current = { cx: e.clientX, cy: e.clientY, ox: v.ox, oy: v.oy };
  };
  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    const cv = canvasRef.current;
    if (!d || !cv) return;
    const rect = cv.getBoundingClientRect();
    const dx = ((e.clientX - d.cx) / rect.width) * SIZE;
    const dy = ((e.clientY - d.cy) / rect.height) * SIZE;
    setViewport(clampVp(vpRef.current.scale, d.ox + dx, d.oy + dy));
  };
  const onUp = () => {
    dragRef.current = null;
  };

  // reset zoom when the map changes
  useEffect(() => {
    setViewport({ scale: 1, ox: 0, oy: 0 });
  }, [map, setViewport]);

  // wheel-zoom toward the cursor (non-passive so the page doesn't scroll)
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * SIZE;
      const my = ((e.clientY - rect.top) / rect.height) * SIZE;
      const cur = vpRef.current;
      const ns = Math.max(1, Math.min(6, cur.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      if (ns === cur.scale) return;
      const k = ns / cur.scale;
      setViewport(clampVp(ns, mx - (mx - cur.ox) * k, my - (my - cur.oy) * k));
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  }, [clampVp, setViewport]);

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

  const togglePlay = () => {
    playingRef.current = !playingRef.current;
    setPlaying(playingRef.current);
  };
  const restart = () => {
    elapsedRef.current = 0;
    if (!playingRef.current) {
      playingRef.current = true;
      setPlaying(true);
    }
  };

  // stable signature so the animation only restarts when the throws actually
  // change, not on every unrelated parent re-render
  const throwsSig = throws.map((t) => `${t.round}:${t.t}:${t.kind}`).join("|");

  useEffect(() => {
    elapsedRef.current = 0;
    lastTsRef.current = 0;
    const solo = throws.length === 1;
    const TRAVEL = solo ? 1.0 : 0.6;
    const STAGGER = solo ? 0 : throws.length > 12 ? 0.28 : 0.5;
    const TAIL = solo ? 2.2 : 2.8; // watch time after the last landing
    const FADE = 0.5; // global fade-out before the loop restarts

    const place = (x: number, y: number) => {
      const r = proj.project(x, y);
      return r ? { x: r.x * SIZE, y: r.y * SIZE } : { x: SIZE / 2, y: SIZE / 2 };
    };

    // precompute per-throw geometry + timing
    const items: Item[] = throws.map((t, i) => {
      // origin === landing means the origin couldn't be resolved (legacy demo)
      const hasOrigin = t.ox !== t.x || t.oy !== t.y;
      const o = place(t.ox, t.oy);
      const l = place(t.x, t.y);
      const dist = Math.hypot(l.x - o.x, l.y - o.y);
      const c = {
        x: (o.x + l.x) / 2,
        y: (o.y + l.y) / 2 - Math.min(110, 30 + dist * 0.28), // arc apex height
      };
      const start = i * STAGGER;
      return {
        t,
        color: KIND_COLOR[t.kind] ?? "#5b9dff",
        hasOrigin,
        o,
        l,
        c,
        start,
        land: start + (hasOrigin ? TRAVEL : 0),
      };
    });

    const lastLand = items.length ? Math.max(...items.map((it) => it.land)) : 0;
    const total = Math.max(1, lastLand + TAIL);

    const traceBez = (ctx: CanvasRenderingContext2D, it: Item, from: number, to: number) => {
      ctx.beginPath();
      const steps = 24;
      for (let s = 0; s <= steps; s++) {
        const k = from + ((to - from) * s) / steps;
        const p = bez(it.o, it.c, it.l, k);
        if (s === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    };

    // ---- kind-specific landing effects --------------------------------------
    const drawSmoke = (ctx: CanvasRenderingContext2D, it: Item, e: number, a: number) => {
      const R = BLOOM_R.smoke * SIZE * easeOutCubic(Math.min(1, e / 1.1));
      const pulse = 0.93 + 0.07 * Math.sin(e * 1.6 + it.start * 7);
      const ramp = Math.min(1, e / 0.3);
      for (let j = 0; j < 6; j++) {
        const ang = (j / 6) * Math.PI * 2 + it.start; // stable, per-throw offsets
        const bx = it.l.x + Math.cos(ang) * R * 0.42 * pulse;
        const by = it.l.y + Math.sin(ang) * R * 0.42 * pulse;
        const br = R * 0.55;
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        g.addColorStop(0, hexA(it.color, 0.34 * ramp * a));
        g.addColorStop(1, hexA(it.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();
      }
      // soft edge ring so the covered area reads precisely
      ctx.beginPath();
      ctx.arc(it.l.x, it.l.y, R * pulse, 0, Math.PI * 2);
      ctx.strokeStyle = hexA(it.color, 0.4 * ramp * a);
      ctx.lineWidth = 2;
      ctx.stroke();
    };

    const drawFire = (ctx: CanvasRenderingContext2D, it: Item, e: number, a: number) => {
      const R = BLOOM_R.molotov * SIZE * easeOutCubic(Math.min(1, e / 0.8));
      // burning pool
      const g = ctx.createRadialGradient(it.l.x, it.l.y, 0, it.l.x, it.l.y, R);
      g.addColorStop(0, hexA("#ffb347", 0.32 * a));
      g.addColorStop(0.7, hexA(it.color, 0.22 * a));
      g.addColorStop(1, hexA(it.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(it.l.x, it.l.y, R, 0, Math.PI * 2);
      ctx.fill();
      // flickering flame blobs (deterministic — no Math.random in the loop)
      for (let j = 0; j < 7; j++) {
        const ang = j * 0.9 + it.start * 3;
        const rr = R * (0.25 + 0.3 * ((j * 37) % 10) / 10);
        const fx = it.l.x + Math.cos(ang) * rr;
        const fy = it.l.y + Math.sin(ang) * rr;
        const flick = 0.75 + 0.25 * Math.sin(e * 11 + j * 2.1);
        dot(ctx, fx, fy, R * 0.16 * flick, "#ffd166", 0.5 * flick * a);
        dot(ctx, fx, fy, R * 0.09 * flick, "#fff3c4", 0.55 * flick * a);
      }
    };

    const drawFlash = (ctx: CanvasRenderingContext2D, it: Item, e: number, a: number) => {
      const D = 0.5; // burst duration
      if (e < D) {
        const k = e / D;
        const R = BLOOM_R.flash * SIZE * (0.5 + 0.9 * easeOutCubic(k));
        // rays
        ctx.strokeStyle = hexA("#ffffff", (1 - k) * 0.85 * a);
        ctx.lineWidth = 2.5;
        for (let j = 0; j < 8; j++) {
          const ang = (j / 8) * Math.PI * 2 + 0.4;
          ctx.beginPath();
          ctx.moveTo(it.l.x + Math.cos(ang) * R * 0.35, it.l.y + Math.sin(ang) * R * 0.35);
          ctx.lineTo(it.l.x + Math.cos(ang) * R, it.l.y + Math.sin(ang) * R);
          ctx.stroke();
        }
        // white core
        const g = ctx.createRadialGradient(it.l.x, it.l.y, 0, it.l.x, it.l.y, R * 0.6);
        g.addColorStop(0, hexA("#ffffff", (1 - k * 0.6) * 0.9 * a));
        g.addColorStop(1, hexA(it.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(it.l.x, it.l.y, R * 0.6, 0, Math.PI * 2);
        ctx.fill();
      } else if (e < 1.4) {
        // fading pop ring
        const k = (e - D) / (1.4 - D);
        ctx.beginPath();
        ctx.arc(it.l.x, it.l.y, BLOOM_R.flash * SIZE * 0.8, 0, Math.PI * 2);
        ctx.strokeStyle = hexA(it.color, (1 - k) * 0.4 * a);
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    };

    const drawHE = (ctx: CanvasRenderingContext2D, it: Item, e: number, a: number) => {
      const D = 0.55;
      if (e < D) {
        const k = e / D;
        const R = BLOOM_R.he * SIZE * easeOutCubic(k);
        // shockwave ring
        ctx.beginPath();
        ctx.arc(it.l.x, it.l.y, R, 0, Math.PI * 2);
        ctx.strokeStyle = hexA(it.color, (1 - k) * 0.9 * a);
        ctx.lineWidth = 5 * (1 - k) + 1.5;
        ctx.stroke();
        // core flash
        if (k < 0.35) {
          dot(ctx, it.l.x, it.l.y, BLOOM_R.he * SIZE * 0.3 * (1 - k / 0.35), "#ffe08a", 0.9 * a);
        }
      } else if (e < 1.2) {
        const k = (e - D) / (1.2 - D);
        dot(ctx, it.l.x, it.l.y, 6, it.color, (1 - k) * 0.35 * a);
      }
    };

    const drawDecoy = (ctx: CanvasRenderingContext2D, it: Item, e: number, a: number) => {
      // repeating radar pings
      const p = (e % 0.9) / 0.9;
      ctx.beginPath();
      ctx.arc(it.l.x, it.l.y, BLOOM_R.decoy * SIZE * p, 0, Math.PI * 2);
      ctx.strokeStyle = hexA(it.color, (1 - p) * 0.55 * a);
      ctx.lineWidth = 2;
      ctx.stroke();
      dot(ctx, it.l.x, it.l.y, 4, it.color, (0.5 + 0.4 * Math.sin(e * 9)) * a);
    };

    const frame = (ts: number) => {
      rafRef.current = requestAnimationFrame(frame);
      const cv = canvasRef.current;
      if (!cv) return;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = Math.min(0.1, (ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;
      if (playingRef.current) elapsedRef.current = (elapsedRef.current + dt) % total;
      const elapsed = elapsedRef.current;
      // soft loop: dynamic layers fade out just before the restart
      const fade = Math.min(1, (total - elapsed) / FADE);

      ctx.clearRect(0, 0, SIZE, SIZE);
      // everything draws inside the zoom/pan transform (radar + lineups scale
      // together); cleared above in screen space first.
      const vpc = vpRef.current;
      ctx.save();
      ctx.translate(vpc.ox, vpc.oy);
      ctx.scale(vpc.scale, vpc.scale);
      if (imgOk.current && imgRef.current) {
        ctx.globalAlpha = 0.62;
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

      // ---- static lineup layer: every throw's arc, origin and landing ------
      for (const it of items) {
        if (it.hasOrigin) {
          ctx.setLineDash([7, 7]);
          ctx.strokeStyle = hexA(it.color, solo ? 0.5 : 0.16);
          ctx.lineWidth = solo ? 2.5 : 1.5;
          traceBez(ctx, it, 0, 1);
          ctx.setLineDash([]);
          // origin (throw-from) marker
          dot(ctx, it.o.x, it.o.y, solo ? 5 : 3.5, it.color, solo ? 0.9 : 0.35);
          if (solo) {
            ctx.beginPath();
            ctx.arc(it.o.x, it.o.y, 11, 0, Math.PI * 2);
            ctx.strokeStyle = hexA(it.color, 0.7);
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }
        // landing anchor
        dot(ctx, it.l.x, it.l.y, 3.5, it.color, 0.55);
      }

      // ---- dynamic layer: projectiles + landing effects --------------------
      for (const it of items) {
        const local = elapsed - it.start;
        if (local < 0) continue;

        if (it.hasOrigin && local < TRAVEL) {
          // in flight: brighten the traversed arc + comet head with a trail
          const k = easeOutQuad(local / TRAVEL);
          ctx.strokeStyle = hexA(it.color, 0.75 * fade);
          ctx.lineWidth = 2.5;
          traceBez(ctx, it, Math.max(0, k - 0.22), k);
          const p = bez(it.o, it.c, it.l, k);
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 14);
          g.addColorStop(0, hexA("#ffffff", 0.9 * fade));
          g.addColorStop(0.35, hexA(it.color, 0.8 * fade));
          g.addColorStop(1, hexA(it.color, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
          ctx.fill();
          dot(ctx, p.x, p.y, solo ? 5.5 : 4.5, "#ffffff", 0.95 * fade);
          continue;
        }

        const e = local - (it.hasOrigin ? TRAVEL : 0);
        if (e < 0) continue;
        const kind = it.t.kind;
        if (kind === "smoke") drawSmoke(ctx, it, e, fade);
        else if (kind === "molotov" || kind === "inferno" || kind === "incgrenade") drawFire(ctx, it, e, fade);
        else if (kind === "flash") drawFlash(ctx, it, e, fade);
        else if (kind === "he") drawHE(ctx, it, e, fade);
        else if (kind === "decoy") drawDecoy(ctx, it, e, fade);
        else drawHE(ctx, it, e, fade);
      }
      ctx.restore();
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proj, throwsSig, calibrated, map]);

  return (
    <div className={`relative ${className}`}>
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        className={`aspect-square w-full select-none rounded-xl border border-line bg-panel2 ${
          vp.scale > 1 ? "cursor-grab active:cursor-grabbing" : ""
        }`}
      />
      <div className="absolute right-2 top-2 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => zoomBy(1.3)}
          title="Zoom in (scroll on the map)"
          aria-label="Zoom in"
          className="grid h-6 w-6 place-items-center rounded-md border border-line2 bg-bg/80 text-sm font-bold backdrop-blur transition hover:text-brand"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.3)}
          title="Zoom out"
          aria-label="Zoom out"
          className="grid h-6 w-6 place-items-center rounded-md border border-line2 bg-bg/80 text-sm font-bold backdrop-blur transition hover:text-brand"
        >
          −
        </button>
        {vp.scale > 1 && (
          <button
            type="button"
            onClick={() => setViewport({ scale: 1, ox: 0, oy: 0 })}
            title="Reset zoom"
            aria-label="Reset zoom"
            className="grid h-6 w-6 place-items-center rounded-md border border-line2 bg-bg/80 text-[10px] backdrop-blur transition hover:text-brand"
          >
            ⤢
          </button>
        )}
      </div>
      {/* playback: pause the loop to study a moment, or replay from the top */}
      <div className="absolute left-2 top-2 flex flex-col gap-1">
        <button
          type="button"
          onClick={togglePlay}
          title={playing ? "Pause animation" : "Resume animation"}
          aria-label={playing ? "Pause animation" : "Resume animation"}
          className="grid h-6 w-6 place-items-center rounded-md border border-line2 bg-bg/80 text-[10px] backdrop-blur transition hover:text-brand"
        >
          {playing ? "⏸" : "▶"}
        </button>
        <button
          type="button"
          onClick={restart}
          title="Replay from the start"
          aria-label="Replay from the start"
          className="grid h-6 w-6 place-items-center rounded-md border border-line2 bg-bg/80 text-[10px] backdrop-blur transition hover:text-brand"
        >
          ↺
        </button>
      </div>
      {/* top-anchored so bottom-edge overlays (e.g. the Utility tab's step
          controls) can never cover it */}
      {!calibrated && throws.length > 0 && (
        <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-mid/15 px-2 py-0.5 text-[10px] text-mid">
          {map} radar uncalibrated — auto-scaled
        </div>
      )}
    </div>
  );
}
