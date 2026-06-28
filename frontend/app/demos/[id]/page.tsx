"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getMatch } from "@/lib/demo/store";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import { hasCalibration, radarImage } from "@/lib/maps/calibration";
import { buildProjection } from "@/lib/demo/projection";
import { mapLabel } from "@/lib/format";
import RouteAnalytics from "@/components/demo/RouteAnalytics";
import WeaponInsights from "@/components/demo/WeaponInsights";
import PlayerInsights from "@/components/demo/PlayerInsights";
import MatchVerdict from "@/components/demo/MatchVerdict";
import { StrategyMap } from "@/components/demo/StrategyMap";
import { MatchToolbar, type DemoView, type SideFilter } from "@/components/demo/MatchToolbar";
import { KIND_COLOR } from "@/components/demo/RadarMap";
import { weaponLabel, throwOrigin } from "@/lib/demo/insights";
import { PlayerRoundCard } from "@/components/demo/PlayerRoundCard";
import { loadZones, classifyPosition, type Zone } from "@/lib/maps/zones";

const TABS = [
  { k: "replay", label: "Replay" },
  { k: "routes", label: "Routes" },
  { k: "weapons", label: "Weapons" },
  { k: "insights", label: "Insights" },
  { k: "map", label: "Heatmap" },
  { k: "verdict", label: "Cheat / AI" },
] as const;
type Tab = (typeof TABS)[number]["k"];

const SIZE = 720; // canvas internal resolution
const CT = "#5b9dff";
const T = "#e7b53c";
const SPEEDS = [1, 2, 4, 8];

// #rrggbb -> rgba() with alpha, for gradients/translucent fills.
function colA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

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

// approximate on-map lifetime per grenade kind (seconds) for the "active now" feed
const UTIL_LIFE: Record<string, number> = {
  smoke: 17,
  molotov: 7,
  inferno: 7,
  incgrenade: 7,
  flash: 1.6,
  he: 1,
  decoy: 15,
};
const mmss = (t: number) =>
  `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, "0")}`;

function reasonLabel(reason: string, winner: string): string {
  const k = (reason || "").toLowerCase();
  if (k.includes("defus")) return "Bomb defused";
  if (k.includes("bomb") || k.includes("detonat")) return "Bomb detonated";
  if (k.includes("time") || k.includes("saved") || k.includes("expir")) return "Time expired";
  if (k.includes("elim") || k.includes("won") || k.includes("win") || k.includes("kill"))
    return `${winner === "CT" ? "CTs" : "Terrorists"} eliminated`;
  return reason ? reason.replace(/_/g, " ") : "Round ended";
}

// Live feed for the replay: utility currently active at the playhead + the kill
// log up to now + bomb status — all synced to the scrubber time.
function EventFeed({
  round,
  time,
  meta,
  zones,
}: {
  round: ReplayRound;
  time: number;
  meta: ReplayMeta;
  zones: Zone[];
}) {
  const name = (i: number) => meta.players[i]?.name ?? `P${i + 1}`;
  const sideOf = (i: number) => (round.ct?.includes(i) ? "CT" : round.t?.includes(i) ? "T" : "");
  const lifeOf = (n: { k: string; dur: number }) => Math.max(n.dur || 0, UTIL_LIFE[n.k] ?? 1);
  const zoneOf = (x: number, y: number) => classifyPosition(meta.map, x, y, zones)?.name ?? null;

  const active = (round.nades ?? [])
    .filter((n) => time >= n.t && time <= n.t + lifeOf(n))
    .map((n) => ({ n, rem: n.t + lifeOf(n) - time }))
    .sort((a, b) => a.rem - b.rem);
  const kills = (round.kills ?? [])
    .filter((k) => k.k >= 0 && k.t <= time)
    .sort((a, b) => b.t - a.t);

  const plant = (round.bomb ?? []).find((b) => b.k === "plant" && b.t <= time);
  const ended = (round.bomb ?? []).find((b) => (b.k === "defuse" || b.k === "explode") && b.t <= time);
  const defusing = (round.bomb ?? []).some((b) => b.k === "defuse_start" && b.t <= time) && !ended;

  const dead = new Set<number>();
  for (const k of round.kills ?? []) if (k.v >= 0 && k.t <= time) dead.add(k.v);
  const ctAlive = (round.ct ?? []).filter((i) => !dead.has(i)).length;
  const tAlive = (round.t ?? []).filter((i) => !dead.has(i)).length;

  return (
    <div className="card px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="stat-label">Live feed</span>
        <span className="text-xs tabular-nums text-faint">{mmss(time)}</span>
      </div>

      <div className="mb-2 flex items-center justify-center gap-3 rounded-md bg-panel/50 py-1.5 text-base font-extrabold tabular-nums">
        <span style={{ color: CT }}>CT {ctAlive}</span>
        <span className="text-xs font-normal text-faint">alive</span>
        <span style={{ color: T }}>{tAlive} T</span>
      </div>

      {plant && !ended && (
        <div className="mb-2 flex items-center gap-2 rounded-md bg-bad/10 px-2 py-1 text-xs text-bad">
          <span className="font-bold">C4</span>
          <span>{defusing ? "Being defused…" : "Bomb planted"}</span>
          <span className="ml-auto tabular-nums">{mmss(time - plant.t)} ago</span>
        </div>
      )}

      <div className="mb-2">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-faint">Active utility</div>
        {active.length === 0 ? (
          <div className="text-xs text-faint">None right now.</div>
        ) : (
          <div className="space-y-0.5">
            {active.map((a, i) => {
              const z = zoneOf(a.n.x, a.n.y);
              return (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_COLOR[a.n.k] ?? "#8a7dff" }} />
                  <span className="capitalize text-ink">{a.n.k}</span>
                  {a.n.by >= 0 && <span className="truncate text-faint">{name(a.n.by)}</span>}
                  {z && <span className="truncate text-faint">· {z}</span>}
                  <span className="ml-auto shrink-0 tabular-nums text-faint">{a.rem.toFixed(0)}s</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wider text-faint">Kills ({kills.length})</div>
        {kills.length === 0 ? (
          <div className="text-xs text-faint">No kills yet.</div>
        ) : (
          <div className="max-h-44 space-y-0.5 overflow-y-auto pr-1">
            {kills.map((k, i) => {
              const recent = time - k.t < 4;
              return (
                <div key={i} className={`flex items-center gap-1.5 text-xs ${recent ? "" : "opacity-55"}`}>
                  <span className="w-8 shrink-0 tabular-nums text-faint">{mmss(k.t)}</span>
                  <span className="truncate font-medium" style={{ color: sideOf(k.k) === "T" ? T : CT }}>{name(k.k)}</span>
                  <span className="shrink-0 text-faint">{weaponLabel(k.w)}{k.hs ? " ⌖" : ""}</span>
                  <span className="ml-auto truncate text-muted">{name(k.v)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
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
  const [focusPlayer, setFocusPlayer] = useState<number | null>(null);
  const [scopeRound, setScopeRound] = useState<number | null>(null);
  const [side, setSide] = useState<SideFilter>("all");
  const [zones, setZones] = useState<Zone[]>([]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const focusRef = useRef<number | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const imgOk = useRef(false);
  const tRef = useRef(0);
  const playRef = useRef(false);
  const speedRef = useRef(2);
  const roundRef = useRef(0);
  const rafRef = useRef(0);
  const lastTs = useRef(0);

  // map zoom/pan viewport, in SIZE-space px: screen = world*scale + offset.
  const [vp, setVp] = useState({ scale: 1, ox: 0, oy: 0 });
  const vpRef = useRef(vp); // mirror so the rAF draw reads it without rebuilding
  const dragRef = useRef<{ cx: number; cy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const movedRef = useRef(false); // true when the last gesture was a pan (suppress the click)

  const clampVp = useCallback((scale: number, ox: number, oy: number) => {
    const s = clamp(scale, 1, 6);
    const min = SIZE * (1 - s);
    return { scale: s, ox: clamp(ox, min, 0), oy: clamp(oy, min, 0) };
  }, []);
  const setViewport = useCallback((v: { scale: number; ox: number; oy: number }) => {
    vpRef.current = v;
    setVp(v);
  }, []);
  // zoom toward an internal-px point (mx,my), keeping that point fixed
  const zoomAt = useCallback(
    (mx: number, my: number, factor: number) => {
      const cur = vpRef.current;
      const ns = clamp(cur.scale * factor, 1, 6);
      if (ns === cur.scale) return;
      const k = ns / cur.scale;
      setViewport(clampVp(ns, mx - (mx - cur.ox) * k, my - (my - cur.oy) * k));
    },
    [clampVp, setViewport],
  );
  // client coords -> internal SIZE-space px (canvas buffer is fixed at SIZE)
  const toInternal = useCallback((clientX: number, clientY: number) => {
    const cv = canvasRef.current;
    if (!cv) return { x: 0, y: 0 };
    const rect = cv.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * SIZE,
      y: ((clientY - rect.top) / rect.height) * SIZE,
    };
  }, []);

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
  // Play to the round's TRUE end. Frame capture stops the instant RoundEnd fires
  // (~1s before the deciding action at 1Hz), but kills/bomb/util are timestamped
  // right up to it — so take the max of all event times + a short tail, else the
  // final kill / bomb explode / defuse gets cut off.
  const duration = useMemo(() => {
    if (!round) return 0;
    let d = round.frames.length ? round.frames[round.frames.length - 1].t : 0;
    for (const k of round.kills ?? []) d = Math.max(d, k.t);
    for (const b of round.bomb ?? []) d = Math.max(d, b.t);
    for (const n of round.nades ?? []) d = Math.max(d, n.t + (n.dur || 0));
    return d + 1.5;
  }, [round]);

  // throw origin per grenade (thrower position at throw time), computed once per
  // round so the draw loop can show origin → landing without re-deriving it.
  const nadeOrigins = useMemo(
    () => (round?.nades ?? []).map((n) => (round ? throwOrigin(round, n) : null)),
    [round],
  );

  // world -> canvas px (calibrated, else normalize to data bounds)
  const toPx = useMemo(() => {
    if (!meta) return (x: number, y: number) => ({ x, y });
    const proj = buildProjection(meta.map, rounds);
    return (x: number, y: number) => {
      const r = proj.project(x, y);
      return r ? { x: r.x * SIZE, y: r.y * SIZE } : { x: 0, y: 0 };
    };
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

  // load the map's call-out zones so the live feed can name util landings
  useEffect(() => {
    if (meta) setZones(loadZones(meta.map));
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

      // background — cleared in screen space; everything else draws inside the
      // zoom/pan transform, with marker sizes divided by the zoom (s) so dots,
      // cones, labels and kill marks stay a constant on-screen size.
      ctx.clearRect(0, 0, SIZE, SIZE);
      const vpc = vpRef.current;
      const z = vpc.scale;
      const s = 1 / z;
      ctx.save();
      ctx.translate(vpc.ox, vpc.oy);
      ctx.scale(z, z);

      if (imgOk.current && imgRef.current) {
        ctx.globalAlpha = 0.9;
        ctx.drawImage(imgRef.current, 0, 0, SIZE, SIZE);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = "#0a1020";
        ctx.fillRect(0, 0, SIZE, SIZE);
        ctx.strokeStyle = "rgba(56,214,255,0.07)";
        ctx.lineWidth = s;
        for (let g = 0; g <= SIZE; g += SIZE / 16) {
          ctx.beginPath();
          ctx.moveTo(g, 0);
          ctx.lineTo(g, SIZE);
          ctx.moveTo(0, g);
          ctx.lineTo(SIZE, g);
          ctx.stroke();
        }
      }

      // grenades active at t — throw origin → landing + a live countdown
      (round.nades ?? []).forEach((n, ni) => {
        const life = Math.max(n.dur || 0, UTIL_LIFE[n.k] ?? 1);
        if (t < n.t || t > n.t + life) return;
        const c = toPx(n.x, n.y);
        const age = (t - n.t) / life;
        const col = KIND_COLOR[n.k] ?? "#8a7dff";

        // throw origin → landing
        const o = nadeOrigins[ni];
        if (o) {
          const oc = toPx(o.x, o.y);
          ctx.globalAlpha = 0.5 * (1 - age) + 0.15;
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.5 * s;
          ctx.setLineDash([5 * s, 4 * s]);
          ctx.beginPath();
          ctx.moveTo(oc.x, oc.y);
          ctx.lineTo(c.x, c.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }

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
        } else {
          ctx.fillStyle = `${col}55`;
          ctx.beginPath();
          ctx.arc(c.x, c.y, 14, 0, 7);
          ctx.fill();
        }

        // countdown in the centre for lingering util (smoke / molotov / decoy)
        if (life >= 4) {
          const rem = Math.max(0, Math.ceil(life - (t - n.t)));
          ctx.font = `bold ${11 * s}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.lineWidth = 3 * s;
          ctx.strokeStyle = "rgba(0,0,0,0.6)";
          ctx.strokeText(`${rem}`, c.x, c.y);
          ctx.fillStyle = "#fff";
          ctx.fillText(`${rem}`, c.x, c.y);
          ctx.textAlign = "left";
          ctx.textBaseline = "alphabetic";
        }
      });

      // bomb marker (after plant, until defuse/explode)
      const plant = (round.bomb ?? []).find((b) => b.k === "plant" && b.t <= t);
      const ended = (round.bomb ?? []).find(
        (b) => (b.k === "defuse" || b.k === "explode") && b.t <= t,
      );
      if (plant && !ended) {
        const c = toPx(plant.x, plant.y);
        ctx.fillStyle = "#f5694a";
        ctx.beginPath();
        ctx.arc(c.x, c.y, 5 * s, 0, 7);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${9 * s}px sans-serif`;
        ctx.fillText("C4", c.x - 8 * s, c.y - 8 * s);
      }

      // recent kills: X on victim for 4s, killer line for 1.5s
      for (const ki of round.kills ?? []) {
        if (ki.t > t || t - ki.t > 4) continue;
        const v = toPx(ki.vx, ki.vy);
        const xr = 5 * s;
        ctx.strokeStyle = "#f5694a";
        ctx.lineWidth = 2 * s;
        ctx.beginPath();
        ctx.moveTo(v.x - xr, v.y - xr);
        ctx.lineTo(v.x + xr, v.y + xr);
        ctx.moveTo(v.x + xr, v.y - xr);
        ctx.lineTo(v.x - xr, v.y + xr);
        ctx.stroke();
        if (t - ki.t < 1.5 && ki.k >= 0) {
          const a = toPx(ki.kx, ki.ky);
          ctx.strokeStyle = "rgba(245,105,74,0.5)";
          ctx.lineWidth = 1 * s;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(v.x, v.y);
          ctx.stroke();
        }
      }

      // players
      const blips = posAt(round, t);
      const focus = focusRef.current;
      let aliveCT = 0,
        aliveT = 0;
      for (const p of blips) {
        const pside = sideOf(p.i);
        if (pside === "CT") aliveCT++;
        else aliveT++;
        const c = toPx(p.x, p.y);
        const col = pside === "CT" ? CT : T;
        const dim = focus != null && p.i !== focus;
        ctx.globalAlpha = dim ? 0.4 : 1;
        const rad = (-p.d * Math.PI) / 180;
        const r = 7.5 * s;

        // view wedge — a filled cone showing where the player is looking
        const coneLen = 26 * s;
        const half = (33 * Math.PI) / 180; // 33° half-angle (~66° FOV indicator)
        const cone = ctx.createRadialGradient(c.x, c.y, Math.max(0, r - s), c.x, c.y, coneLen);
        cone.addColorStop(0, colA(col, 0.6));
        cone.addColorStop(1, colA(col, 0));
        ctx.fillStyle = cone;
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.arc(c.x, c.y, coneLen, rad - half, rad + half);
        ctx.closePath();
        ctx.fill();

        // body dot: dark contrast ring + bright fill so it pops on any tile
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, 7);
        ctx.fillStyle = col;
        ctx.fill();
        ctx.lineWidth = 2 * s;
        ctx.strokeStyle = "rgba(4,6,14,0.9)";
        ctx.stroke();

        if (p.bomb) {
          ctx.strokeStyle = "#f5694a";
          ctx.lineWidth = 2.5 * s;
          ctx.beginPath();
          ctx.arc(c.x, c.y, r + 3.5 * s, 0, 7);
          ctx.stroke();
        }

        // initial, centered
        ctx.fillStyle = "#04060e";
        ctx.font = `bold ${9 * s}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const label = (meta?.players[p.i]?.name || "?").slice(0, 1).toUpperCase();
        ctx.fillText(label, c.x, c.y + 0.5 * s);
        ctx.textAlign = "start";
        ctx.textBaseline = "alphabetic";
        ctx.globalAlpha = 1;

        if (focus === p.i) {
          ctx.strokeStyle = "#38d6ff";
          ctx.lineWidth = 2.5 * s;
          ctx.beginPath();
          ctx.arc(c.x, c.y, r + 4 * s, 0, 7);
          ctx.stroke();
        }
      }
      ctx.restore();

      // advisory banner (round result is shown as a popup, not here)
      let b = "";
      if ((round.bomb ?? []).some((x) => x.k === "defuse_start" && Math.abs(x.t - t) < 3)) {
        b = "Defusing…";
      } else if (plant && !ended) {
        b = "Bomb planted";
      } else if ((aliveCT === 1 && aliveT > 1) || (aliveT === 1 && aliveCT > 1)) {
        b = `${aliveCT === 1 ? "CT" : "T"} 1v${aliveCT === 1 ? aliveT : aliveCT} clutch`;
      }
      setBanner((prev) => (prev === b ? prev : b));
    },
    [round, duration, toPx, posAt, sideOf, meta, nadeOrigins],
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

  // --- map pan + click-to-select ---
  const onCanvasDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const v = vpRef.current;
    dragRef.current = { cx: e.clientX, cy: e.clientY, ox: v.ox, oy: v.oy, moved: false };
  };
  const onCanvasMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    const cv = canvasRef.current;
    if (!d || !cv) return; // only pans while the button is held (down → up/leave)
    const rect = cv.getBoundingClientRect();
    const dx = ((e.clientX - d.cx) / rect.width) * SIZE;
    const dy = ((e.clientY - d.cy) / rect.height) * SIZE;
    if (Math.abs(e.clientX - d.cx) + Math.abs(e.clientY - d.cy) > 3) d.moved = true;
    setViewport(clampVp(vpRef.current.scale, d.ox + dx, d.oy + dy));
  };
  const onCanvasUp = () => {
    // carry the "was a pan" flag to the click that fires next, then clear drag so
    // a button-less hover never pans.
    movedRef.current = dragRef.current?.moved ?? false;
    dragRef.current = null;
  };
  const onCanvasLeave = () => {
    dragRef.current = null;
  };
  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (movedRef.current) {
      movedRef.current = false;
      return; // that was a pan, not a select
    }
    if (!round) return;
    const { x: mx, y: my } = toInternal(e.clientX, e.clientY);
    const v = vpRef.current;
    const wx = (mx - v.ox) / v.scale; // back to toPx (SIZE) space
    const wy = (my - v.oy) / v.scale;
    let best = -1;
    let bestD = Infinity;
    for (const p of posAt(round, tRef.current)) {
      const c = toPx(p.x, p.y);
      const dd = Math.hypot(c.x - wx, c.y - wy);
      if (dd < bestD) {
        bestD = dd;
        best = p.i;
      }
    }
    // hit radius in SIZE-space (~dot + slop); divide by scale so it's consistent
    if (best >= 0 && bestD <= 16 / v.scale) setFocusPlayer(focusPlayer === best ? null : best);
  };

  // keep the focus highlight live without rebuilding the draw loop
  useEffect(() => {
    focusRef.current = focusPlayer;
  }, [focusPlayer]);

  // the shared round scope drives which round the replay shows
  useEffect(() => {
    if (scopeRound == null || scopeRound < 0 || scopeRound >= rounds.length) return;
    setRoundIdx(scopeRound);
    roundRef.current = scopeRound;
    tRef.current = 0;
    setTime(0);
    playRef.current = false;
    setPlaying(false);
    setViewport({ scale: 1, ox: 0, oy: 0 }); // each round starts unzoomed
  }, [scopeRound, rounds.length, setViewport]);

  // wheel-zoom toward the cursor (non-passive so the page doesn't scroll)
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { x, y } = toInternal(e.clientX, e.clientY);
      zoomAt(x, y, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  }, [toInternal, zoomAt, tab]);

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

  const view: DemoView = {
    focusPlayer,
    scopeRound,
    side,
    setFocusPlayer,
    setScopeRound,
    setSide,
  };

  // round navigation (drives scopeRound → the sync effect updates the replay)
  const goRound = (i: number) => setScopeRound(clamp(i, 0, rounds.length - 1));
  const atFirst = roundIdx <= 0;
  const atLast = roundIdx >= rounds.length - 1;
  const finished = duration > 0 && time >= duration - 0.05;
  const winHex = round.winner === "T" ? T : round.winner === "CT" ? CT : "#8a7dff";
  const replay = () => {
    seek(0);
    playRef.current = true;
    setPlaying(true);
  };

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

      <MatchToolbar
        meta={meta}
        rounds={rounds}
        view={view}
        showSide={tab !== "replay"}
      />

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

      {tab === "routes" && <RouteAnalytics meta={meta} rounds={rounds} view={view} />}
      {tab === "weapons" && <WeaponInsights meta={meta} rounds={rounds} view={view} />}
      {tab === "insights" && <PlayerInsights meta={meta} rounds={rounds} view={view} />}
      {tab === "map" && <StrategyMap meta={meta} rounds={rounds} name={name} view={view} />}
      {tab === "verdict" && <MatchVerdict meta={meta} rounds={rounds} view={view} />}

      {tab === "replay" && (
        <>
      <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
        {/* radar */}
        <div className="relative w-full max-w-160">
          <canvas
            ref={canvasRef}
            width={SIZE}
            height={SIZE}
            onMouseDown={onCanvasDown}
            onMouseMove={onCanvasMove}
            onMouseUp={onCanvasUp}
            onMouseLeave={onCanvasLeave}
            onClick={onCanvasClick}
            className={`aspect-square w-full select-none rounded-xl border border-line bg-panel2 ${
              vp.scale > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
            }`}
          />
          {/* zoom controls */}
          <div className="absolute right-2 top-2 flex flex-col gap-1">
            <button
              type="button"
              onClick={() => zoomAt(SIZE / 2, SIZE / 2, 1.3)}
              title="Zoom in (scroll on the map)"
              className="grid h-7 w-7 place-items-center rounded-md border border-line2 bg-bg/80 text-base font-bold backdrop-blur transition hover:bg-panel"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => zoomAt(SIZE / 2, SIZE / 2, 1 / 1.3)}
              title="Zoom out"
              className="grid h-7 w-7 place-items-center rounded-md border border-line2 bg-bg/80 text-base font-bold backdrop-blur transition hover:bg-panel"
            >
              −
            </button>
            {vp.scale > 1 && (
              <button
                type="button"
                onClick={() => setViewport({ scale: 1, ox: 0, oy: 0 })}
                title="Reset zoom"
                className="grid h-7 w-7 place-items-center rounded-md border border-line2 bg-bg/80 text-xs backdrop-blur transition hover:bg-panel"
              >
                ⟲
              </button>
            )}
          </div>
          {banner && !finished && (
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-line2 bg-bg/80 px-3 py-1 text-xs font-semibold backdrop-blur">
              {banner}
            </div>
          )}
          {finished && round.winner && (
            <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-xl border border-line2 bg-bg/90 px-4 py-2.5 text-center shadow-lg backdrop-blur">
              <div className="text-[10px] uppercase tracking-wider text-faint">
                Round {round.n} over
              </div>
              <div className="text-lg font-extrabold leading-tight" style={{ color: winHex }}>
                {round.winner} win
              </div>
              <div className="text-[11px] text-muted">{reasonLabel(round.reason, round.winner)}</div>
              <div className="mt-2 flex justify-center gap-2">
                <button type="button" onClick={replay} className="btn btn-ghost px-2.5 py-1 text-xs">
                  ↺ Replay
                </button>
                {!atLast && (
                  <button
                    type="button"
                    onClick={() => goRound(roundIdx + 1)}
                    className="btn btn-primary px-2.5 py-1 text-xs"
                  >
                    Next round →
                  </button>
                )}
              </div>
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
            <div className="mb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => goRound(roundIdx - 1)}
                disabled={atFirst}
                className="btn btn-ghost px-2.5 py-1 text-xs disabled:opacity-40"
              >
                ← Prev
              </button>
              <span className="text-xs font-semibold tabular-nums">
                Round {round.n}
                {round.winner && (
                  <span className="ml-1.5 pill" style={{ background: `${winHex}22`, color: winHex }}>
                    {round.winner}
                  </span>
                )}
                <span className="ml-1.5 text-faint">{roundIdx + 1}/{rounds.length}</span>
              </span>
              <button
                type="button"
                onClick={() => goRound(roundIdx + 1)}
                disabled={atLast}
                className="btn btn-ghost px-2.5 py-1 text-xs disabled:opacity-40"
              >
                Next →
              </button>
            </div>
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
              {scopeRound !== null && (
                <button
                  type="button"
                  onClick={() => setScopeRound(null)}
                  title="Unlink this round from the toolbar"
                  className="pill bg-brand/15 text-brand"
                >
                  R{round.n} scoped ✕
                </button>
              )}
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
              className="mt-3 w-full accent-brand"
            />
            {duration > 0 && (
              <div className="relative mt-1 h-2">
                {(round.nades ?? []).map((n, i) => (
                  <span
                    key={`n${i}`}
                    title={`${n.k} · ${mmss(n.t)}`}
                    className="absolute top-0.5 h-1 w-0.5 -translate-x-1/2 rounded-full"
                    style={{ left: `${(n.t / duration) * 100}%`, background: KIND_COLOR[n.k] ?? "#8a7dff" }}
                  />
                ))}
                {(round.kills ?? []).filter((k) => k.k >= 0).map((k, i) => (
                  <button
                    key={`k${i}`}
                    type="button"
                    title={`Kill · ${mmss(k.t)} — jump`}
                    onClick={() => { playRef.current = false; setPlaying(false); seek(k.t); }}
                    className="absolute top-0 h-2 w-1 -translate-x-1/2 rounded-full transition-transform hover:scale-150"
                    style={{ left: `${(k.t / duration) * 100}%`, background: "#f5694a" }}
                  />
                ))}
                {(round.bomb ?? []).filter((b) => b.k === "plant").map((b, i) => (
                  <span
                    key={`b${i}`}
                    title={`Bomb plant · ${mmss(b.t)}`}
                    className="absolute -top-0.5 h-2.5 w-0.5 -translate-x-1/2"
                    style={{ left: `${(b.t / duration) * 100}%`, background: "#fff" }}
                  />
                ))}
              </div>
            )}
          </div>

          {focusPlayer != null ? (
            <PlayerRoundCard
              round={round}
              meta={meta}
              i={focusPlayer}
              onClose={() => setFocusPlayer(null)}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-line px-3 py-2 text-[11px] text-faint">
              Tip: scroll to zoom · drag to pan · click a player dot for their round detail.
            </div>
          )}

          <EventFeed round={round} time={time} meta={meta} zones={zones} />

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
              {(round.kills ?? []).length} kills · {(round.nades ?? []).length} nades
            </div>
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
}
