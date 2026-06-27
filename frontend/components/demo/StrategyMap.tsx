"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import { hasCalibration, radarImage } from "@/lib/maps/calibration";
import { buildProjection } from "@/lib/demo/projection";
import type { DemoView, SideFilter } from "@/components/demo/MatchToolbar";

const SIZE = 720;
type Layer = "positions" | "kills" | "deaths" | "nades";

const LAYERS: { key: Layer; label: string }[] = [
  { key: "positions", label: "Position density" },
  { key: "kills", label: "Kills" },
  { key: "deaths", label: "Deaths" },
  { key: "nades", label: "Utility" },
];

/**
 * Aggregate heatmap over a match — position density, kills, deaths and utility.
 * Rendered as a tab in the demo viewer (with the shared toolbar driving
 * side/round/player) and also on the standalone /map page (where `view` is
 * absent and a local side toggle is shown instead).
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const imgOk = useRef(false);

  // shared selection (from toolbar) takes priority; standalone page uses local
  const side = view?.side ?? localSide;
  const scopeRound = view?.scopeRound ?? null;
  const focusPlayer = view?.focusPlayer ?? null;

  const toPx = useMemo(() => {
    const proj = buildProjection(meta.map, rounds);
    return (x: number, y: number) => {
      const r = proj.project(x, y);
      return r ? { x: r.x * SIZE, y: r.y * SIZE } : { x: 0, y: 0 };
    };
  }, [meta.map, rounds]);

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

  const heat = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      pts: { x: number; y: number }[],
      color: string,
      radius: number,
      alpha: number,
    ) => {
      ctx.globalCompositeOperation = "lighter";
      for (const p of pts) {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
        g.addColorStop(0, color.replace("ALPHA", String(alpha)));
        g.addColorStop(1, color.replace("ALPHA", "0"));
        ctx.fillStyle = g;
        ctx.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
      }
      ctx.globalCompositeOperation = "source-over";
    },
    [],
  );

  const redraw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    if (imgOk.current && imgRef.current) {
      ctx.globalAlpha = 0.55;
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

    if (active.has("positions")) {
      const pts: { x: number; y: number }[] = [];
      for (const rd of scoped) {
        const frames = rd.frames ?? [];
        for (let fi = 0; fi < frames.length; fi += 3) {
          for (const p of frames[fi].p) {
            if (!playerOk(p.i)) continue;
            if (!sideOk(sideOfRound(rd, p.i))) continue;
            pts.push(toPx(p.x, p.y));
          }
        }
      }
      heat(ctx, pts, "rgba(56,214,255,ALPHA)", 26, 0.06);
    }
    if (active.has("kills")) {
      const pts: { x: number; y: number }[] = [];
      for (const rd of scoped)
        for (const k of rd.kills ?? [])
          if (playerOk(k.k) && sideOk(sideOfRound(rd, k.k))) pts.push(toPx(k.kx, k.ky));
      heat(ctx, pts, "rgba(70,211,105,ALPHA)", 22, 0.4);
    }
    if (active.has("deaths")) {
      const pts: { x: number; y: number }[] = [];
      for (const rd of scoped)
        for (const k of rd.kills ?? [])
          if (playerOk(k.v) && sideOk(sideOfRound(rd, k.v))) pts.push(toPx(k.vx, k.vy));
      heat(ctx, pts, "rgba(245,105,74,ALPHA)", 22, 0.4);
    }
    if (active.has("nades")) {
      const colors: Record<string, string> = {
        smoke: "rgba(210,210,220,ALPHA)",
        molotov: "rgba(255,120,40,ALPHA)",
        flash: "rgba(255,255,255,ALPHA)",
        he: "rgba(255,170,60,ALPHA)",
      };
      for (const rd of scoped)
        for (const n of rd.nades ?? []) {
          if (focusPlayer != null && n.by !== focusPlayer) continue;
          const c = toPx(n.x, n.y);
          heat(ctx, [c], colors[n.k] || "rgba(150,150,150,ALPHA)", 18, 0.45);
        }
    }
  }, [rounds, active, side, scopeRound, focusPlayer, toPx, heat, sideOfRound]);

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

  return (
    <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        className="aspect-square w-full max-w-160 rounded-xl border border-line bg-panel2"
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
