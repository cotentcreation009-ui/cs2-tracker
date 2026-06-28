"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import { hasCalibration, radarImage } from "@/lib/maps/calibration";
import { buildProjection } from "@/lib/demo/projection";
import { throwOrigin } from "@/lib/demo/insights";
import { loadZones, classifyPosition } from "@/lib/maps/zones";
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
const HEAT_CSS =
  "linear-gradient(90deg, rgb(36,64,200), rgb(0,200,224), rgb(36,210,96), rgb(244,222,52), rgb(240,58,40))";

// 256-entry RGB lookup built once from the gradient (simpleheat-style palette).
let GRAD: Uint8ClampedArray | null = null;
function heatGradient(): Uint8ClampedArray {
  if (GRAD) return GRAD;
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0, "#1736b4");
  g.addColorStop(0.45, "#2440c8");
  g.addColorStop(0.6, "#00c8e0");
  g.addColorStop(0.72, "#24d260");
  g.addColorStop(0.85, "#f4de34");
  g.addColorStop(1.0, "#f03a28");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1, 256);
  GRAD = ctx.getImageData(0, 0, 1, 256).data;
  return GRAD;
}

// soft circular brush (grayscale, blurred via shadow) — cached per (radius,blur).
const BRUSHES = new Map<string, HTMLCanvasElement>();
function heatBrush(r: number, blur: number): HTMLCanvasElement {
  const key = `${r}:${blur}`;
  const hit = BRUSHES.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  const r2 = r + blur;
  c.width = c.height = r2 * 2;
  const ctx = c.getContext("2d")!;
  ctx.shadowOffsetX = ctx.shadowOffsetY = r2 * 2;
  ctx.shadowBlur = blur;
  ctx.shadowColor = "black";
  ctx.beginPath();
  ctx.arc(-r2, -r2, r, 0, Math.PI * 2, true);
  ctx.closePath();
  ctx.fill();
  BRUSHES.set(key, c);
  return c;
}

type HeatPt = { x: number; y: number; w?: number };

// simpleheat-style KDE: stamp a soft brush per point with alpha = value/max
// (accumulating via source-over), then colorize the accumulated alpha through
// the gradient. `max` is a fixed density target, so colour reflects how MUCH a
// spot is occupied — not merely whether anyone passed through it. Areas with
// little density stay translucent, which is what gives the map readable contrast.
function drawHeat(
  ctx: CanvasRenderingContext2D,
  off: HTMLCanvasElement,
  pts: HeatPt[],
  opts: { radius: number; blur: number; max: number; minOpacity?: number },
) {
  if (!pts.length) return;
  const octx = off.getContext("2d", { willReadFrequently: true });
  if (!octx) return;
  octx.clearRect(0, 0, SIZE, SIZE);
  octx.globalCompositeOperation = "source-over";
  const brush = heatBrush(opts.radius, opts.blur);
  const r2 = opts.radius + opts.blur;
  const minO = opts.minOpacity ?? 0.05;
  for (const p of pts) {
    octx.globalAlpha = Math.min(Math.max((p.w ?? 1) / opts.max, minO), 1);
    octx.drawImage(brush, p.x - r2, p.y - r2);
  }
  octx.globalAlpha = 1;

  const img = octx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  const grad = heatGradient();
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]; // accumulated alpha 0..255 = density
    if (a === 0) continue;
    const j = a * 4;
    d[i] = grad[j];
    d[i + 1] = grad[j + 1];
    d[i + 2] = grad[j + 2];
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

  const zones = useMemo(() => loadZones(meta.map), [meta.map]);

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
      // Where players HOLD position — only stationary samples count, so transit
      // corridors drop out entirely and held angles stand out. Buy-phase spawn
      // camping is excluded so it doesn't dominate. Density (overlap across
      // rounds/players), normalized to a fixed target, drives the colour.
      const pts: HeatPt[] = [];
      for (const rd of scoped) {
        const frames = rd.frames ?? [];
        const freezeEnd = rd.freezeEnd ?? 15; // skip buy time (older parses: ~15s)
        const fullBuy = new Set<number>();
        for (const s of rd.stats ?? []) if (s.buy === "full") fullBuy.add(s.i);
        const prev = new Map<number, { x: number; y: number; t: number }>();
        for (const f of frames) {
          if (f.t < freezeEnd) continue;
          for (const p of f.p) {
            if (!playerOk(p.i) || p.h <= 0) continue;
            const pr = prev.get(p.i);
            prev.set(p.i, { x: p.x, y: p.y, t: f.t });
            if (!pr || !sideOk(sideOfRound(rd, p.i))) continue;
            const dt = f.t - pr.t;
            if (dt <= 0 || dt > 3) continue; // gap (respawn / round seam)
            const speed = Math.hypot(p.x - pr.x, p.y - pr.y) / dt; // u/s
            if (speed > 110) continue; // running through — not a hold
            const still = speed < 35 ? 2 : 1; // planted vs slow-walking
            const w = still * (fullBuy.has(p.i) ? 1.6 : 1);
            const c = toPx(p.x, p.y);
            pts.push({ x: c.x, y: c.y, w });
          }
        }
      }
      // fixed density target (simpleheat-style): solo needs less overlap to go
      // red than a whole team; scale gently with how many rounds are in scope.
      const base = focusPlayer != null ? 4.5 : 14;
      const max = base * Math.max(0.3, Math.min(1.4, scoped.length / 20));
      drawHeat(ctx, off, pts, {
        radius: Math.round(9 * spreadMult),
        blur: Math.round(7 * spreadMult),
        max,
        minOpacity: 0.08,
      });
    }
    if (active.has("kills")) {
      const pts: HeatPt[] = [];
      for (const rd of scoped)
        for (const k of rd.kills ?? [])
          if (k.k >= 0 && playerOk(k.k) && sideOk(sideOfRound(rd, k.k))) pts.push(toPx(k.kx, k.ky));
      drawHeat(ctx, off, pts, {
        radius: Math.round(11 * spreadMult),
        blur: Math.round(8 * spreadMult),
        max: (focusPlayer != null ? 2 : 5) * Math.max(0.4, Math.min(1.3, scoped.length / 20)),
        minOpacity: 0.1,
      });
    }
    if (active.has("deaths")) {
      const pts: HeatPt[] = [];
      for (const rd of scoped)
        for (const k of rd.kills ?? [])
          if (k.v >= 0 && playerOk(k.v) && sideOk(sideOfRound(rd, k.v))) pts.push(toPx(k.vx, k.vy));
      drawHeat(ctx, off, pts, {
        radius: Math.round(11 * spreadMult),
        blur: Math.round(8 * spreadMult),
        max: (focusPlayer != null ? 2 : 5) * Math.max(0.4, Math.min(1.3, scoped.length / 20)),
        minOpacity: 0.1,
      });
    }
    if (active.has("nades")) {
      for (const rd of scoped)
        for (const n of rd.nades ?? []) {
          if (focusPlayer != null && n.by !== focusPlayer) continue;
          const c = toPx(n.x, n.y);
          const col = KIND_COLOR[n.k] ?? "#8a7dff";
          const o = throwOrigin(rd, n);
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

  // per-call-out breakdown — where players hold + where kills/deaths land,
  // honouring the side/round/player scope. Turns the heat blob into named info.
  const zoneStats = useMemo(() => {
    if (!zones.length) return [];
    const sideOk = (s: SideFilter) => side === "all" || s === side;
    const playerOk = (i: number) => focusPlayer == null || i === focusPlayer;
    const scoped = scopeRound != null && rounds[scopeRound] ? [rounds[scopeRound]] : rounds;
    const m = new Map<string, { name: string; hold: number; kills: number; deaths: number }>();
    const z = (name: string) => {
      let v = m.get(name);
      if (!v) {
        v = { name, hold: 0, kills: 0, deaths: 0 };
        m.set(name, v);
      }
      return v;
    };
    for (const rd of scoped) {
      const freezeEnd = rd.freezeEnd ?? 15;
      for (const f of rd.frames ?? []) {
        if (f.t < freezeEnd) continue;
        for (const p of f.p) {
          if (p.h <= 0 || !playerOk(p.i) || !sideOk(sideOfRound(rd, p.i))) continue;
          const c = classifyPosition(meta.map, p.x, p.y, zones);
          if (c) z(c.name).hold++;
        }
      }
      for (const k of rd.kills ?? []) {
        if (k.k >= 0 && playerOk(k.k) && sideOk(sideOfRound(rd, k.k))) {
          const c = classifyPosition(meta.map, k.kx, k.ky, zones);
          if (c) z(c.name).kills++;
        }
        if (k.v >= 0 && playerOk(k.v) && sideOk(sideOfRound(rd, k.v))) {
          const c = classifyPosition(meta.map, k.vx, k.vy, zones);
          if (c) z(c.name).deaths++;
        }
      }
    }
    const arr = [...m.values()];
    const maxHold = Math.max(1, ...arr.map((v) => v.hold));
    return arr.map((v) => ({ ...v, holdPct: v.hold / maxHold })).sort((a, b) => b.hold - a.hold);
  }, [zones, rounds, scopeRound, side, focusPlayer, meta.map, sideOfRound]);

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
    <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr] 2xl:grid-cols-[1.9fr_1fr]">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">
            Heat map <span className="font-normal text-faint">· {[...active].join(" · ") || "—"}</span>
          </h3>
          {focusName && <span className="pill bg-panel text-xs text-ink">{focusName}</span>}
        </div>
        <canvas
          ref={canvasRef}
          width={SIZE}
          height={SIZE}
          className="aspect-square w-full rounded-xl border border-line bg-panel2"
        />
      </div>

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

        {zoneStats.length > 0 && (
          <div className="card px-4 py-3">
            <div className="stat-label mb-2">
              Zone breakdown <span className="font-normal lowercase text-faint">· hold · K/D in zone</span>
            </div>
            <div className="space-y-1.5">
              {zoneStats.slice(0, 9).map((z) => (
                <div key={z.name} className="flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0 truncate text-muted" title={z.name}>{z.name}</span>
                  <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-panel">
                    <span
                      className="bar-grow absolute inset-y-0 left-0 rounded-full bg-brand"
                      style={{ width: `${Math.max(3, z.holdPct * 100)}%` }}
                    />
                  </span>
                  <span className="w-12 shrink-0 text-right tabular-nums">
                    <span className="text-good">{z.kills}</span>
                    <span className="text-faint">/</span>
                    <span className="text-bad">{z.deaths}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[10px] text-faint">
              bar = time held · <span className="text-good">kills</span> / <span className="text-bad">deaths</span> in that call-out
            </div>
          </div>
        )}

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
          {active.has("positions") && (
            <div className="mt-1">
              Shows where players <span className="font-semibold text-ink">hold position</span> —
              only stationary time counts, so run-through corridors and buy-phase spawns drop out.
              Brightest = most-held.
            </div>
          )}
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
