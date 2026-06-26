"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getMatch } from "@/lib/demo/store";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import { hasCalibration, radarImage, worldToRadar } from "@/lib/maps/calibration";
import { mapLabel } from "@/lib/format";

const SIZE = 720;
type Side = "all" | "CT" | "T";
type Layer = "positions" | "kills" | "deaths" | "nades";

const LAYERS: { key: Layer; label: string }[] = [
  { key: "positions", label: "Position density" },
  { key: "kills", label: "Kills" },
  { key: "deaths", label: "Deaths" },
  { key: "nades", label: "Utility" },
];

export default function StrategyMapPage() {
  const { id } = useParams<{ id: string }>();
  const [meta, setMeta] = useState<ReplayMeta | null>(null);
  const [rounds, setRounds] = useState<ReplayRound[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Set<Layer>>(new Set(["positions"]));
  const [side, setSide] = useState<Side>("all");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const imgOk = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const m = await getMatch(id);
        if (!alive || !m) return;
        setMeta(m.summary.meta);
        setRounds(m.rounds);
        setName(m.summary.name);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const toPx = useMemo(() => {
    if (!meta) return (x: number, y: number) => ({ x, y });
    if (hasCalibration(meta.map)) {
      return (x: number, y: number) => {
        const r = worldToRadar(meta.map, x, y);
        return r ? { x: r.x * SIZE, y: r.y * SIZE } : { x: 0, y: 0 };
      };
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const rd of rounds)
      for (const f of rd.frames)
        for (const p of f.p) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
    const span = Math.max(maxX - minX, maxY - minY) || 1;
    const pad = 0.06;
    return (x: number, y: number) => ({
      x: (pad + ((x - minX) / span) * (1 - 2 * pad)) * SIZE,
      y: (pad + ((maxY - y) / span) * (1 - 2 * pad)) * SIZE,
    });
  }, [meta, rounds]);

  useEffect(() => {
    imgOk.current = false;
    if (!meta) return;
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      imgOk.current = true;
      redraw();
    };
    img.onerror = () => {
      imgOk.current = false;
    };
    img.src = radarImage(meta.map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  const sideOfRound = useCallback((rd: ReplayRound, i: number): Side => {
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
    if (!cv || !meta) return;
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

    const sideOk = (s: Side) => side === "all" || s === side;

    if (active.has("positions")) {
      const pts: { x: number; y: number }[] = [];
      for (const rd of rounds) {
        for (let fi = 0; fi < rd.frames.length; fi += 3) {
          for (const p of rd.frames[fi].p) {
            if (!sideOk(sideOfRound(rd, p.i))) continue;
            pts.push(toPx(p.x, p.y));
          }
        }
      }
      heat(ctx, pts, "rgba(56,214,255,ALPHA)", 26, 0.06);
    }
    if (active.has("kills")) {
      const pts: { x: number; y: number }[] = [];
      for (const rd of rounds)
        for (const k of rd.kills)
          if (sideOk(sideOfRound(rd, k.k))) pts.push(toPx(k.kx, k.ky));
      heat(ctx, pts, "rgba(70,211,105,ALPHA)", 22, 0.4);
    }
    if (active.has("deaths")) {
      const pts: { x: number; y: number }[] = [];
      for (const rd of rounds)
        for (const k of rd.kills)
          if (sideOk(sideOfRound(rd, k.v))) pts.push(toPx(k.vx, k.vy));
      heat(ctx, pts, "rgba(245,105,74,ALPHA)", 22, 0.4);
    }
    if (active.has("nades")) {
      const colors: Record<string, string> = {
        smoke: "rgba(210,210,220,ALPHA)",
        molotov: "rgba(255,120,40,ALPHA)",
        flash: "rgba(255,255,255,ALPHA)",
        he: "rgba(255,170,60,ALPHA)",
      };
      for (const rd of rounds)
        for (const n of rd.nades) {
          const c = toPx(n.x, n.y);
          heat(ctx, [c], colors[n.k] || "rgba(150,150,150,ALPHA)", 18, 0.45);
        }
    }
  }, [meta, rounds, active, side, toPx, heat, sideOfRound]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const toggle = (l: Layer) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(l)) next.delete(l);
      else next.add(l);
      return next;
    });
  };

  const exportPng = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const a = document.createElement("a");
    a.download = `${name || "match"}-${meta?.map}-heatmap.png`;
    a.href = cv.toDataURL("image/png");
    a.click();
  };

  if (loading) return <div className="card px-5 py-6 text-sm text-muted">Loading…</div>;
  if (!meta)
    return (
      <div className="card px-5 py-6 text-sm text-muted">
        Match not found.{" "}
        <Link href="/demos" className="text-brand hover:underline">
          Back to demos
        </Link>
      </div>
    );

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/demos/${id}`} className="text-xs text-muted hover:text-ink">
          ← Replay
        </Link>
        <h1 className="text-xl font-extrabold tracking-tight">
          Strategy map{" "}
          <span className="pill bg-panel capitalize text-muted">
            {mapLabel(meta.map)}
          </span>
        </h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
        <canvas
          ref={canvasRef}
          width={SIZE}
          height={SIZE}
          className="aspect-square w-full max-w-[640px] rounded-xl border border-line bg-panel2"
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
            <div className="stat-label mb-2 mt-3">Side</div>
            <div className="flex rounded-lg border border-line bg-panel p-0.5">
              {(["all", "CT", "T"] as Side[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSide(s)}
                  className={`rounded-md px-2.5 py-0.5 text-xs font-medium uppercase transition ${
                    side === s ? "bg-brand/15 text-brand" : "text-muted hover:text-ink"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <button type="button" onClick={exportPng} className="btn btn-ghost mt-3 w-full text-xs">
              Export PNG
            </button>
          </div>
          <div className="card px-4 py-3 text-xs text-muted">
            Aggregated over <span className="font-semibold text-ink">{rounds.length}</span> rounds.
            {!hasCalibration(meta.map) && (
              <div className="mt-1 text-mid">
                {meta.map} radar uncalibrated — positions auto-scaled.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
