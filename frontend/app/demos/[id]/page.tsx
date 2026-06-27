"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getMatch } from "@/lib/demo/store";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import { hasCalibration, radarImage, worldToRadar } from "@/lib/maps/calibration";
import { mapLabel } from "@/lib/format";
import RouteAnalytics from "@/components/demo/RouteAnalytics";
import WeaponInsights from "@/components/demo/WeaponInsights";
import PlayerInsights from "@/components/demo/PlayerInsights";
import { StrategyMap } from "@/components/demo/StrategyMap";

const TABS = [
  { k: "replay", label: "Replay" },
  { k: "routes", label: "Routes" },
  { k: "weapons", label: "Weapons" },
  { k: "insights", label: "Insights" },
  { k: "map", label: "Heatmap" },
] as const;
type Tab = (typeof TABS)[number]["k"];

const SIZE = 720; // canvas internal resolution
const CT = "#5b9dff";
const T = "#e7b53c";
const SPEEDS = [1, 2, 4, 8];

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
function lerpAngle(a: number, b: number, k: number): number {
  let d = ((b - a + 540) % 360) - 180;
  return a + d * k;
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface Blip {
  i: number;
  x: number;
  y: number;
  d: number;
  h: number;
  bomb?: boolean;
}

export default function ReplayPage() {
  const { id } = useParams<{ id: string }>();
  const [meta, setMeta] = useState<ReplayMeta | null>(null);
  const [rounds, setRounds] = useState<ReplayRound[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [roundIdx, setRoundIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [time, setTime] = useState(0);
  const [banner, setBanner] = useState("");
  const [tab, setTab] = useState<Tab>("replay");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const imgOk = useRef(false);
  const tRef = useRef(0);
  const playRef = useRef(false);
  const speedRef = useRef(2);
  const roundRef = useRef(0);
  const rafRef = useRef(0);
  const lastTs = useRef(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const m = await getMatch(id);
        if (!alive) return;
        if (m) {
          setMeta(m.summary.meta);
          setRounds(m.rounds);
          setName(m.summary.name);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const round = rounds[roundIdx];
  const duration = useMemo(() => {
    if (!round?.frames.length) return 0;
    return round.frames[round.frames.length - 1].t;
  }, [round]);

  // world -> canvas px (calibrated, else normalize to data bounds)
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

  const sideOf = useCallback(
    (i: number): "CT" | "T" => {
      if (round?.ct?.includes(i)) return "CT";
      if (round?.t?.includes(i)) return "T";
      return meta?.players[i]?.team === "T" ? "T" : "CT";
    },
    [round, meta],
  );

  // load the map radar image (graceful fallback to a grid)
  useEffect(() => {
    imgOk.current = false;
    imgRef.current = null;
    if (!meta) return;
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      imgOk.current = true;
    };
    img.onerror = () => {
      imgOk.current = false;
    };
    img.src = radarImage(meta.map);
  }, [meta]);

  const posAt = useCallback((rd: ReplayRound, t: number): Blip[] => {
    const f = rd.frames;
    if (!f.length) return [];
    let lo = 0, hi = f.length - 1, idx = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (f[mid].t <= t) {
        idx = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    const a = f[idx];
    const b = f[Math.min(idx + 1, f.length - 1)];
    const k = clamp((t - a.t) / ((b.t - a.t) || 1), 0, 1);
    const aMap = new Map(a.p.map((p) => [p.i, p]));
    return b.p.map((pb) => {
      const pa = aMap.get(pb.i);
      if (!pa) return { i: pb.i, x: pb.x, y: pb.y, d: pb.d, h: pb.h, bomb: pb.b };
      return {
        i: pb.i,
        x: lerp(pa.x, pb.x, k),
        y: lerp(pa.y, pb.y, k),
        d: lerpAngle(pa.d, pb.d, k),
        h: pb.h,
        bomb: pb.b,
      };
    });
  }, []);

  const draw = useCallback(
    (t: number) => {
      const cv = canvasRef.current;
      if (!cv || !round) return;
      const ctx = cv.getContext("2d");
      if (!ctx) return;

      // background
      ctx.clearRect(0, 0, SIZE, SIZE);
      if (imgOk.current && imgRef.current) {
        ctx.globalAlpha = 0.9;
        ctx.drawImage(imgRef.current, 0, 0, SIZE, SIZE);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = "#0a1020";
        ctx.fillRect(0, 0, SIZE, SIZE);
        ctx.strokeStyle = "rgba(56,214,255,0.07)";
        ctx.lineWidth = 1;
        for (let g = 0; g <= SIZE; g += SIZE / 16) {
          ctx.beginPath();
          ctx.moveTo(g, 0);
          ctx.lineTo(g, SIZE);
          ctx.moveTo(0, g);
          ctx.lineTo(SIZE, g);
          ctx.stroke();
        }
      }

      // grenades active at t
      for (const n of round.nades) {
        const dur = n.dur || 0.8;
        if (t < n.t || t > n.t + dur) continue;
        const c = toPx(n.x, n.y);
        const age = (t - n.t) / dur;
        if (n.k === "smoke") {
          ctx.fillStyle = "rgba(210,210,220,0.34)";
          ctx.beginPath();
          ctx.arc(c.x, c.y, 26, 0, 7);
          ctx.fill();
        } else if (n.k === "molotov") {
          ctx.fillStyle = `rgba(255,120,40,${0.35 * (1 - age)})`;
          ctx.beginPath();
          ctx.arc(c.x, c.y, 22, 0, 7);
          ctx.fill();
        } else if (n.k === "flash") {
          ctx.fillStyle = `rgba(255,255,255,${0.6 * (1 - age)})`;
          ctx.beginPath();
          ctx.arc(c.x, c.y, 16 + age * 14, 0, 7);
          ctx.fill();
        } else if (n.k === "he") {
          ctx.fillStyle = `rgba(255,170,60,${0.6 * (1 - age)})`;
          ctx.beginPath();
          ctx.arc(c.x, c.y, 10 + age * 18, 0, 7);
          ctx.fill();
        }
      }

      // bomb marker (after plant, until defuse/explode)
      const plant = round.bomb.find((b) => b.k === "plant" && b.t <= t);
      const ended = round.bomb.find(
        (b) => (b.k === "defuse" || b.k === "explode") && b.t <= t,
      );
      if (plant && !ended) {
        const c = toPx(plant.x, plant.y);
        ctx.fillStyle = "#f5694a";
        ctx.beginPath();
        ctx.arc(c.x, c.y, 5, 0, 7);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 9px sans-serif";
        ctx.fillText("C4", c.x - 8, c.y - 8);
      }

      // recent kills: X on victim for 4s, killer line for 1.5s
      for (const ki of round.kills) {
        if (ki.t > t || t - ki.t > 4) continue;
        const v = toPx(ki.vx, ki.vy);
        ctx.strokeStyle = "#f5694a";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(v.x - 5, v.y - 5);
        ctx.lineTo(v.x + 5, v.y + 5);
        ctx.moveTo(v.x + 5, v.y - 5);
        ctx.lineTo(v.x - 5, v.y + 5);
        ctx.stroke();
        if (t - ki.t < 1.5 && ki.k >= 0) {
          const a = toPx(ki.kx, ki.ky);
          ctx.strokeStyle = "rgba(245,105,74,0.5)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(v.x, v.y);
          ctx.stroke();
        }
      }

      // players
      const blips = posAt(round, t);
      let aliveCT = 0,
        aliveT = 0;
      for (const p of blips) {
        const side = sideOf(p.i);
        if (side === "CT") aliveCT++;
        else aliveT++;
        const c = toPx(p.x, p.y);
        const col = side === "CT" ? CT : T;
        // look direction
        const rad = (-p.d * Math.PI) / 180;
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(c.x + Math.cos(rad) * 13, c.y + Math.sin(rad) * 13);
        ctx.stroke();
        // body
        ctx.beginPath();
        ctx.arc(c.x, c.y, 6, 0, 7);
        ctx.fillStyle = col;
        ctx.fill();
        if (p.bomb) {
          ctx.strokeStyle = "#f5694a";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(c.x, c.y, 9, 0, 7);
          ctx.stroke();
        }
        ctx.fillStyle = "#04060e";
        ctx.font = "bold 8px sans-serif";
        const label = (meta?.players[p.i]?.name || "?").slice(0, 1).toUpperCase();
        ctx.fillText(label, c.x - 2.5, c.y + 3);
      }

      // advisory banner
      let b = "";
      if (t >= duration && round.winner) {
        b = `${round.winner} win · ${round.reason.replace(/_/g, " ")}`;
      } else if (round.bomb.some((x) => x.k === "defuse_start" && Math.abs(x.t - t) < 3)) {
        b = "Defusing…";
      } else if (plant && !ended) {
        b = "Bomb planted";
      } else if ((aliveCT === 1 && aliveT > 1) || (aliveT === 1 && aliveCT > 1)) {
        b = `${aliveCT === 1 ? "CT" : "T"} 1v${aliveCT === 1 ? aliveT : aliveCT} clutch`;
      }
      setBanner((prev) => (prev === b ? prev : b));
    },
    [round, duration, toPx, posAt, sideOf, meta],
  );

  // animation loop
  useEffect(() => {
    if (!round) return;
    const tick = (ts: number) => {
      const dt = lastTs.current ? (ts - lastTs.current) / 1000 : 0;
      lastTs.current = ts;
      if (playRef.current) {
        tRef.current = Math.min(tRef.current + dt * speedRef.current, duration);
        if (tRef.current >= duration) {
          playRef.current = false;
          setPlaying(false);
        }
        setTime((prev) => (Math.abs(prev - tRef.current) > 0.04 ? tRef.current : prev));
      }
      draw(tRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [round, duration, draw]);

  const seek = (t: number) => {
    tRef.current = clamp(t, 0, duration);
    setTime(tRef.current);
  };
  const selectRound = (i: number) => {
    setRoundIdx(i);
    roundRef.current = i;
    seek(0);
    playRef.current = false;
    setPlaying(false);
  };

  if (loading) return <div className="card px-5 py-6 text-sm text-muted">Loading replay…</div>;
  if (!meta || !round)
    return (
      <div className="card px-5 py-6 text-sm text-muted">
        Match not found in this browser.{" "}
        <Link href="/demos" className="text-brand hover:underline">
          Back to demos
        </Link>
      </div>
    );

  return (
    <div className="space-y-4">
      <Link href="/demos" className="text-xs text-muted hover:text-ink">
        ← Demos
      </Link>

      {/* header */}
      <section className="card-2 relative overflow-hidden">
        <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center">
          {hasCalibration(meta.map) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={radarImage(meta.map)}
              alt={mapLabel(meta.map)}
              className="h-16 w-16 shrink-0 rounded-lg border border-line object-cover"
            />
          ) : (
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-lg border border-line bg-panel2 text-2xl text-faint">
              ◎
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-extrabold tracking-tight">
              {name}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
              <span className="pill bg-panel capitalize text-ink">
                {mapLabel(meta.map)}
              </span>
              <span className="tabular-nums">{rounds.length} rounds</span>
              <span className="tabular-nums">{meta.players.length} players</span>
              <span className="inline-flex items-center gap-1">
                <span className="font-bold tabular-nums text-[#5b9dff]">
                  {rounds.filter((r) => r.winner === "CT").length}
                </span>
                <span className="text-faint">CT</span>
                <span className="text-faint">·</span>
                <span className="font-bold tabular-nums text-[#e7b53c]">
                  {rounds.filter((r) => r.winner === "T").length}
                </span>
                <span className="text-faint">T</span>
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setTab("map")}
            className="btn btn-ghost shrink-0 text-xs"
          >
            Heatmap →
          </button>
        </div>
      </section>

      {/* analysis tabs */}
      <div className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((tb) => (
          <button
            key={tb.k}
            type="button"
            onClick={() => setTab(tb.k)}
            className={`-mb-px border-b-2 px-3.5 py-2 text-sm font-semibold transition ${
              tab === tb.k
                ? "border-brand text-ink"
                : "border-transparent text-muted hover:border-line hover:text-ink"
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === "routes" && <RouteAnalytics meta={meta} rounds={rounds} />}
      {tab === "weapons" && <WeaponInsights meta={meta} rounds={rounds} />}
      {tab === "insights" && <PlayerInsights meta={meta} rounds={rounds} />}
      {tab === "map" && <StrategyMap meta={meta} rounds={rounds} name={name} />}

      {tab === "replay" && (
        <>
      {/* round strip */}
      <div className="flex flex-wrap gap-1">
        {rounds.map((r, i) => (
          <button
            key={i}
            type="button"
            onClick={() => selectRound(i)}
            title={`Round ${r.n} · ${r.winner || "?"}`}
            className={`h-7 w-7 rounded text-[11px] font-bold tabular-nums transition ${
              i === roundIdx
                ? "ring-2 ring-brand"
                : ""
            } ${r.winner === "CT" ? "bg-[#5b9dff]/25 text-[#9cc1ff]" : r.winner === "T" ? "bg-[#e7b53c]/25 text-[#f0cd78]" : "bg-panel text-muted"}`}
          >
            {r.n}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
        {/* radar */}
        <div className="relative">
          <canvas
            ref={canvasRef}
            width={SIZE}
            height={SIZE}
            className="aspect-square w-full max-w-[640px] rounded-xl border border-line bg-panel2"
          />
          {banner && (
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-line2 bg-bg/80 px-3 py-1 text-xs font-semibold backdrop-blur">
              {banner}
            </div>
          )}
          {!hasCalibration(meta.map) && (
            <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-mid/15 px-2 py-0.5 text-[10px] text-mid">
              {meta.map} radar uncalibrated — positions auto-scaled
            </div>
          )}
        </div>

        {/* controls + round info */}
        <div className="space-y-3">
          <div className="card px-4 py-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (tRef.current >= duration) seek(0);
                  const np = !playRef.current;
                  playRef.current = np;
                  setPlaying(np);
                }}
                className="btn btn-primary px-4"
              >
                {playing ? "Pause" : "Play"}
              </button>
              <div className="flex rounded-lg border border-line bg-panel p-0.5">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      speedRef.current = s;
                      setSpeed(s);
                    }}
                    className={`rounded-md px-2 py-0.5 text-xs font-medium tabular-nums transition ${
                      speed === s ? "bg-brand/15 text-brand" : "text-muted hover:text-ink"
                    }`}
                  >
                    {s}×
                  </button>
                ))}
              </div>
              <span className="ml-auto text-xs tabular-nums text-muted">
                {time.toFixed(1)}s / {duration.toFixed(0)}s
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(duration, 0.1)}
              step={0.1}
              value={time}
              onChange={(e) => {
                playRef.current = false;
                setPlaying(false);
                seek(parseFloat(e.target.value));
              }}
              className="mt-3 w-full accent-[var(--color-brand)]"
            />
          </div>

          <div className="card px-4 py-3 text-sm">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="stat-label">Round {round.n}</span>
              {round.winner && (
                <span
                  className="pill font-bold"
                  style={
                    round.winner === "CT"
                      ? { background: "rgba(91,157,255,0.18)", color: "#9cc1ff" }
                      : { background: "rgba(231,181,60,0.18)", color: "#f0cd78" }
                  }
                >
                  {round.winner} win
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#9cc1ff]">
                  <span className="h-2 w-2 rounded-full bg-[#5b9dff]" /> CT
                </div>
                <div className="space-y-0.5">
                  {round.ct?.map((i) => (
                    <div key={i} className="truncate text-xs text-muted">
                      {meta.players[i]?.name}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#f0cd78]">
                  <span className="h-2 w-2 rounded-full bg-[#e7b53c]" /> T
                </div>
                <div className="space-y-0.5">
                  {round.t?.map((i) => (
                    <div key={i} className="truncate text-xs text-muted">
                      {meta.players[i]?.name}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-3 border-t border-line pt-2 text-xs text-faint">
              {round.kills.length} kills · {round.nades.length} nades
            </div>
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
}
