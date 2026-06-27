"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import { hasCalibration, radarImage } from "@/lib/maps/calibration";
import { buildProjection } from "@/lib/demo/projection";
import { throwOrigin } from "@/lib/demo/insights";
import { KIND_COLOR } from "@/components/demo/RadarMap";
import type { DemoView, SideFilter } from "@/components/demo/MatchToolbar";

const SIZE = 720;
type Layer = "positions" | "kills" | "deaths" | "nades";
type Spread = "tight" | "normal" | "wide";

const LAYERS: { key: Layer; label: string }[] = [
  { key: "positions", label: "Position density" },
  { key: "kills", label: "Kills" },
  { key: "deaths", label: "Deaths" },
  { key: "nades", label: "Utility" },
];
const SPREADS: { key: Spread; label: string; mult: number }[] = [
  { key: "tight", label: "Tight", mult: 0.66 },
  { key: "normal", label: "Normal", mult: 1 },
  { key: "wide", label: "Wide", mult: 1.6 },
];

// classic heat gradient (low → high): blue → cyan → green → yellow → red
const HEAT_STOPS: [number, number, number, number][] = [
  [0.0, 36, 64, 200],
  [0.3, 0, 200, 224],
  [0.5, 36, 210, 96],
  [0.72, 244, 222, 52],
  [1.0, 240, 58, 40],
];
const HEAT_CSS =
  "linear-gradient(90deg, rgb(36,64,200), rgb(0,200,224), rgb(36,210,96), rgb(244,222,52), rgb(240,58,40))";

function heatColor(t: number): [number, number, number] {
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    if (t <= HEAT_STOPS[i][0]) {
      const [t0, r0, g0, b0] = HEAT_STOPS[i - 1];
      const [t1, r1, g1, b1] = HEAT_STOPS[i];
      const f = (t - t0) / (t1 - t0 || 1);
      return [
        Math.round(r0 + (r1 - r0) * f),
        Math.round(g0 + (g1 - g0) * f),
        Math.round(b0 + (b1 - b0) * f),
      ];
    }
  }
  const l = HEAT_STOPS[HEAT_STOPS.length - 1];
  return [l[1], l[2], l[3]];
}

// Classic normalized heatmap: accumulate intensity on an offscreen canvas, find
// the peak, then colorize each pixel through the gradient and composite.
function classicHeat(
  ctx: CanvasRenderingContext2D,
  off: HTMLCanvasElement,
  pts: { x: number; y: number }[],
  radius: number,
) {
  if (!pts.length) return;
  const octx = off.getContext("2d", { willReadFrequently: true });
  if (!octx) return;
  octx.clearRect(0, 0, SIZE, SIZE);
  octx.globalCompositeOperation = "lighter";
  for (const p of pts) {
    const g = octx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
    g.addColorStop(0, "rgba(255,255,255,0.32)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    octx.fillStyle = g;
    octx.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
  }
  octx.globalCompositeOperation = "source-over";

  const img = octx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  let max = 1;
  for (let i = 0; i < d.length; i += 4) if (d[i] > max) max = d[i];
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i];
    if (v === 0) {
      d[i + 3] = 0;
      continue;
    }
    const t = Math.min(1, v / max);
    const [r, g, b] = heatColor(t);
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = Math.round(Math.min(1, t * 1.15 + 0.05) * 235);
  }
  octx.putImageData(img, 0, 0);
  ctx.drawImage(off, 0, 0);
}

/**
 * Aggregate heatmap over a match — classic blue→red density for positions /
 * kills / deaths, plus utility drawn as throw → landing lines. Driven by the
 * shared toolbar (side / round / player) when present, else a local side toggle.
 */
export function StrategyMap({
  meta,
  rounds,
  name = "match",
  view,
}: {
  meta: ReplayMeta;
  rounds: ReplayRound[];
  name?: string;
  view?: DemoView;
}) {
  const [active, setActive] = useState<Set<Layer>>(new Set(["positions"]));
  const [localSide, setLocalSide] = useState<SideFilter>("all");
  const [spread, setSpread] = useState<Spread>("normal");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const imgOk = useRef(false);

  const side = view?.side ?? localSide;
  const scopeRound = view?.scopeRound ?? null;
  const focusPlayer = view?.focusPlayer ?? null;
  const spreadMult = SPREADS.find((s) => s.key === spread)?.mult ?? 1;

  const toPx = useMemo(() => {
    const proj = buildProjection(meta.map, rounds);
    return (x: number, y: number) => {
      const r = proj.project(x, y);
      return r ? { x: r.x * SIZE, y: r.y * SIZE } : { x: 0, y: 0 };
    };
  }, [meta.map, rounds]);

  const getOff = () => {
    if (!offRef.current) {
      const c = document.createElement("canvas");
      c.width = SIZE;
      c.height = SIZE;
      offRef.current = c;
    }
    return offRef.current;
  };

  useEffect(() => {
    let alive = true;
    imgOk.current = false;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      imgRef.current = img;
      imgOk.current = true;
      redraw();
    };
    img.onerror = () => {
      if (alive) imgOk.current = false;
    };
    img.src = radarImage(meta.map);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  const sideOfRound = useCallback((rd: ReplayRound, i: number): SideFilter => {
    if (rd.ct?.includes(i)) return "CT";
    if (rd.t?.includes(i)) return "T";
    return "all";
  }, []);

  const redraw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    if (imgOk.current && imgRef.current) {
      ctx.globalAlpha = 0.5;
      ctx.drawImage(imgRef.current, 0, 0, SIZE, SIZE);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = "#0a1020";
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.strokeStyle = "rgba(56,214,255,0.07)";
      for (let g = 0; g <= SIZE; g += SIZE / 16) {
        ctx.beginPath();
        ctx.moveTo(g, 0);
        ctx.lineTo(g, SIZE);
        ctx.moveTo(0, g);
        ctx.lineTo(SIZE, g);
        ctx.stroke();
      }
    }

    const scoped =
      scopeRound != null && rounds[scopeRound] ? [rounds[scopeRound]] : rounds;
    const sideOk = (s: SideFilter) => side === "all" || s === side;
    const playerOk = (i: number) => focusPlayer == null || i === focusPlayer;
    const off = getOff();

    if (active.has("positions")) {
      const pts: { x: number; y: number }[] = [];
      for (const rd of scoped) {
        const frames = rd.frames ?? [];
        for (let fi = 0; fi < frames.length; fi += 2) {
          for (const p of frames[fi].p) {
            if (!playerOk(p.i)) continue;
            if (!sideOk(sideOfRound(rd, p.i))) continue;
            pts.push(toPx(p.x, p.y));
          }
        }
      }
      classicHeat(ctx, off, pts, 34 * spreadMult);
    }
    if (active.has("kills")) {
      const pts: { x: number; y: number }[] = [];
      for (const rd of scoped)
        for (const k of rd.kills ?? [])
          if (k.k >= 0 && playerOk(k.k) && sideOk(sideOfRound(rd, k.k))) pts.push(toPx(k.kx, k.ky));
      classicHeat(ctx, off, pts, 26 * spreadMult);
    }
    if (active.has("deaths")) {
      const pts: { x: number; y: number }[] = [];
      for (const rd of scoped)
        for (const k of rd.kills ?? [])
          if (k.v >= 0 && playerOk(k.v) && sideOk(sideOfRound(rd, k.v))) pts.push(toPx(k.vx, k.vy));
      classicHeat(ctx, off, pts, 26 * spreadMult);
    }
    if (active.has("nades")) {
      for (const rd of scoped)
        for (const n of rd.nades ?? []) {
          if (focusPlayer != null && n.by !== focusPlayer) continue;
          const c = toPx(n.x, n.y);
          const col = KIND_COLOR[n.k] ?? "#8a7dff";
          const o = n.by >= 0 ? throwOrigin(rd, n.by, n.t) : null;
          if (o) {
            const oc = toPx(o.x, o.y);
            ctx.globalAlpha = 0.6;
            ctx.strokeStyle = col;
            ctx.lineWidth = 1.4;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            ctx.moveTo(oc.x, oc.y);
            ctx.lineTo(c.x, c.y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
          }
          ctx.beginPath();
          ctx.arc(c.x, c.y, 4.5, 0, 7);
          ctx.fillStyle = col;
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = "#04060e";
          ctx.stroke();
        }
    }
  }, [rounds, active, side, scopeRound, focusPlayer, spreadMult, toPx, sideOfRound]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const toggle = (l: Layer) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(l)) next.delete(l);
      else next.add(l);
      return next;
    });

  const exportPng = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const a = document.createElement("a");
    a.download = `${name}-${meta.map}-heatmap.png`;
    a.href = cv.toDataURL("image/png");
    a.click();
  };

  const focusName = focusPlayer != null ? meta.players[focusPlayer]?.name : null;
  const heatOn = active.has("positions") || active.has("kills") || active.has("deaths");

  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        className="aspect-square w-full max-w-200 rounded-xl border border-line bg-panel2"
      />

      <div className="space-y-3">
        <div className="card px-4 py-3">
          <div className="stat-label mb-2">Overlays</div>
          <div className="flex flex-wrap gap-1.5">
            {LAYERS.map((l) => (
              <button
                key={l.key}
                type="button"
                onClick={() => toggle(l.key)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                  active.has(l.key)
                    ? "border-brand/50 bg-brand/15 text-brand"
                    : "border-line text-muted hover:text-ink"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>

          {heatOn && (
            <>
              <div className="stat-label mb-1.5 mt-3">Spread</div>
              <div className="flex rounded-lg border border-line bg-panel p-0.5">
                {SPREADS.map((sp) => (
                  <button
                    key={sp.key}
                    type="button"
                    onClick={() => setSpread(sp.key)}
                    className={`flex-1 rounded-md px-2 py-0.5 text-xs font-medium transition ${
                      spread === sp.key ? "bg-brand/15 text-brand" : "text-muted hover:text-ink"
                    }`}
                  >
                    {sp.label}
                  </button>
                ))}
              </div>
              <div className="mt-2">
                <div className="h-2 w-full rounded-full" style={{ background: HEAT_CSS }} />
                <div className="mt-0.5 flex justify-between text-[10px] text-faint">
                  <span>low</span>
                  <span>high</span>
                </div>
              </div>
            </>
          )}

          {/* local side toggle only when there is no shared toolbar */}
          {!view && (
            <>
              <div className="stat-label mb-2 mt-3">Side</div>
              <div className="flex rounded-lg border border-line bg-panel p-0.5">
                {(["all", "CT", "T"] as SideFilter[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setLocalSide(s)}
                    className={`rounded-md px-2.5 py-0.5 text-xs font-medium uppercase transition ${
                      side === s ? "bg-brand/15 text-brand" : "text-muted hover:text-ink"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </>
          )}

          <button
            type="button"
            onClick={exportPng}
            className="btn btn-ghost mt-3 w-full text-xs"
          >
            Export PNG
          </button>
        </div>
        <div className="card px-4 py-3 text-xs text-muted">
          {scopeRound != null && rounds[scopeRound] ? (
            <>
              Showing <span className="font-semibold text-ink">round {rounds[scopeRound].n}</span>.
            </>
          ) : (
            <>
              Aggregated over{" "}
              <span className="font-semibold text-ink">{rounds.length}</span> rounds.
            </>
          )}
          {focusName && (
            <div className="mt-1">
              Focused on <span className="font-semibold text-ink">{focusName}</span>.
            </div>
          )}
          {side !== "all" && <div className="mt-1">{side} side only.</div>}
          {active.has("nades") && (
            <div className="mt-1">Utility shown as throw → landing lines.</div>
          )}
          {!hasCalibration(meta.map) && (
            <div className="mt-1 text-mid">
              {meta.map} radar uncalibrated — positions auto-scaled.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
