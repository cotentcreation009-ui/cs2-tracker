"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getMatch, renameMatch } from "@/lib/demo/store";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import { hasCalibration, radarImage } from "@/lib/maps/calibration";
import { buildProjection } from "@/lib/demo/projection";
import { mapLabel } from "@/lib/format";
import RouteAnalytics from "@/components/demo/RouteAnalytics";
import WeaponInsights from "@/components/demo/WeaponInsights";
import UtilityBreakdown from "@/components/demo/UtilityBreakdown";
import TendencyScout from "@/components/demo/TendencyScout";
import MatchVerdict from "@/components/demo/MatchVerdict";
import { StrategyMap } from "@/components/demo/StrategyMap";
import { MatchToolbar, type DemoView, type SideFilter } from "@/components/demo/MatchToolbar";
import { ZoneEditor } from "@/components/demo/ZoneEditor";
import { KIND_COLOR } from "@/components/demo/RadarMap";
import { weaponLabel, throwOrigin } from "@/lib/demo/insights";
import { killContext, TRADE_WINDOW } from "@/lib/demo/killContext";
import { PlayerRoundCard } from "@/components/demo/PlayerRoundCard";
import { MatchScoreboard } from "@/components/demo/MatchScoreboard";
import { loadZones, classifyPosition, type Zone } from "@/lib/maps/zones";
import { teamScore } from "@/lib/demo/score";

const TABS = [
  { k: "replay", label: "Replay" },
  { k: "scoreboard", label: "Scoreboard" },
  { k: "routes", label: "Routes" },
  { k: "weapons", label: "Weapons" },
  { k: "insights", label: "Utility" },
  { k: "scout", label: "Tendencies" },
  { k: "map", label: "Heatmap" },
  { k: "zones", label: "Zones" },
  { k: "verdict", label: "Cheat / AI" },
] as const;
type Tab = (typeof TABS)[number]["k"];

const SIZE = 720; // canvas internal resolution
const CT = "#5b9dff";
const T = "#e7b53c";
const SPEEDS = [1, 2, 4, 8];

// One small glyph per lens for the tab nav. viewBox 24, currentColor.
const TAB_ICON: Record<Tab, string> = {
  replay: "M8 5v14l11-7z",
  scoreboard: "M3 5h18v14H3zM3 10h18M9 10v9M15 10v9", // stats table

  routes: "M4 18h5a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3h5M17 3l3 3-3 3M4 15l-3 3 3 3", // rough path
  weapons: "M12 2v4M12 18v4M2 12h4M18 12h4M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", // crosshair
  insights: "M12 3c4 4.5 6.5 7.5 6.5 11a6.5 6.5 0 1 1-13 0C5.5 10.5 8 7.5 12 3zM10 5.5L7 2.5M14 5.5l3-3", // grenade bloom

  scout: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", // eye
  map: "M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6zM9 3v15M15 6v15", // folded map
  zones: "M12 2l9 5v10l-9 5-9-5V7l9-5zM12 2v20M3 7l9 5 9-5", // hexagon
  verdict: "M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-4zM9 12l2 2 4-4", // shield-check
};

function TabIcon({ k, className }: { k: Tab; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={TAB_ICON[k]} />
    </svg>
  );
}

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
  onSeek,
}: {
  round: ReplayRound;
  time: number;
  meta: ReplayMeta;
  zones: Zone[];
  onSeek: (t: number) => void;
}) {
  const name = (i: number) => meta.players[i]?.name ?? `P${i + 1}`;
  const sideOf = (i: number) => (round.ct?.includes(i) ? "CT" : round.t?.includes(i) ? "T" : "");
  const lifeOf = (n: { k: string; dur: number }) => Math.max(n.dur || 0, UTIL_LIFE[n.k] ?? 1);
  const zoneOf = (x: number, y: number) => classifyPosition(meta.map, x, y, zones)?.name ?? null;

  // FIRST/TRADE tags — shared definition, so the pills agree with every other
  // feed. Indexed by position in round.kills, so keep original indices around.
  const ctx = useMemo(() => killContext(round), [round]);

  const active = (round.nades ?? [])
    .filter((n) => time >= n.t && time <= n.t + lifeOf(n))
    .map((n) => ({ n, rem: n.t + lifeOf(n) - time }))
    .sort((a, b) => a.rem - b.rem);
  const kills = (round.kills ?? [])
    .map((k, idx) => ({ k, idx }))
    .filter(({ k }) => k.k >= 0 && k.t <= time)
    .sort((a, b) => b.k.t - a.k.t);

  const plant = (round.bomb ?? []).find((b) => b.k === "plant" && b.t <= time);
  const ended = (round.bomb ?? []).find((b) => (b.k === "defuse" || b.k === "explode") && b.t <= time);
  const defusing = (round.bomb ?? []).some((b) => b.k === "defuse_start" && b.t <= time) && !ended;

  const dead = new Set<number>();
  for (const k of round.kills ?? []) if (k.v >= 0 && k.t <= time) dead.add(k.v);
  const ctAlive = (round.ct ?? []).filter((i) => !dead.has(i)).length;
  const tAlive = (round.t ?? []).filter((i) => !dead.has(i)).length;

  return (
    // At lg+ the feed flexes to fill the rail and the kill log scrolls inside
    // it (min-h keeps it readable when a player card takes the rail's space).
    <div className="card px-4 py-3 lg:flex lg:min-h-56 lg:flex-1 lg:flex-col lg:overflow-hidden">
      <div className="mb-2 flex items-center justify-between">
        <span className="stat-label">Live feed</span>
        <span className="text-xs tabular-nums text-faint">{mmss(time)}</span>
      </div>

      {/* alive bar: counts + one life dot per player (dim = dead). The dots are
          decorative duplication of the counts (aria-hidden) and only render for
          normal-size rosters — a 10v10 casual demo degrades to counts-only
          rather than overflowing the rail card. */}
      <div className="mb-2 flex items-center justify-center gap-3 rounded-md bg-panel/50 py-1.5 text-base font-extrabold tabular-nums">
        <span className="flex items-center gap-1.5">
          <span style={{ color: CT }}>CT {ctAlive}</span>
          {(round.ct?.length ?? 0) <= 6 && (
            <span className="flex gap-0.5" aria-hidden>
              {(round.ct ?? []).map((i) => (
                <span
                  key={i}
                  title={`${name(i)}${dead.has(i) ? " · dead" : ""}`}
                  className="h-1.5 w-1.5 shrink-0 rounded-full transition-opacity"
                  style={{ background: CT, opacity: dead.has(i) ? 0.22 : 1 }}
                />
              ))}
            </span>
          )}
        </span>
        <span className="text-xs font-normal text-faint">alive</span>
        <span className="flex items-center gap-1.5">
          {(round.t?.length ?? 0) <= 6 && (
            <span className="flex gap-0.5" aria-hidden>
              {(round.t ?? []).map((i) => (
                <span
                  key={i}
                  title={`${name(i)}${dead.has(i) ? " · dead" : ""}`}
                  className="h-1.5 w-1.5 shrink-0 rounded-full transition-opacity"
                  style={{ background: T, opacity: dead.has(i) ? 0.22 : 1 }}
                />
              ))}
            </span>
          )}
          <span style={{ color: T }}>{tAlive} T</span>
        </span>
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

      <div className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-faint">Kills ({kills.length})</div>
        {kills.length === 0 ? (
          <div className="text-xs text-faint">No kills yet.</div>
        ) : (
          <div className="scroll-slim max-h-44 space-y-0.5 overflow-y-auto pr-1 lg:max-h-none lg:min-h-0 lg:flex-1">
            {kills.map(({ k, idx }) => {
              const recent = time - k.t < 4;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onSeek(k.t)}
                  title={`Jump the replay to ${mmss(k.t)}`}
                  className={`-mx-1 flex w-[calc(100%+0.5rem)] cursor-pointer items-center gap-1.5 rounded px-1 py-px text-left text-xs transition hover:bg-panel/70 ${recent ? "" : "opacity-55"}`}
                >
                  <span className="w-8 shrink-0 tabular-nums text-faint">{mmss(k.t)}</span>
                  <span className="truncate font-medium" style={{ color: sideOf(k.k) === "T" ? T : CT }}>{name(k.k)}</span>
                  {(k.a ?? 0) > 0 && (
                    <span className="truncate text-[10px] text-faint" title={`Assist: ${name((k.a ?? 1) - 1)}`}>
                      + {name((k.a ?? 1) - 1)}
                    </span>
                  )}
                  {idx === ctx.firstIdx && (
                    <span
                      className="shrink-0 rounded-full bg-brand/15 px-1.5 text-[9px] font-bold tracking-wide text-brand"
                      title="Opening kill of the round"
                    >
                      FIRST
                    </span>
                  )}
                  {ctx.tradeIdxs.has(idx) && (
                    <span
                      className="shrink-0 rounded-full bg-good/15 px-1.5 text-[9px] font-bold tracking-wide text-good"
                      title={`Trade — avenged a teammate killed within ${TRADE_WINDOW}s`}
                    >
                      TRADE
                    </span>
                  )}
                  <span className="shrink-0 text-faint">{weaponLabel(k.w)}{k.hs ? " ⌖" : ""}</span>
                  <span className="ml-auto truncate text-muted">{name(k.v)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Custom scrubber: rounded track + played fill + event ticks (kills coloured by
// the killer's side, bomb plant in white, util dimmed along the bottom edge).
// Renders every frame during playback, so all tick geometry is memoized per
// round; only the fill width / thumb position / hover tooltip change per frame.
function ScrubBar({
  round,
  duration,
  time,
  sideOf,
  onScrub,
}: {
  round: ReplayRound;
  duration: number;
  time: number;
  sideOf: (i: number) => "CT" | "T";
  onScrub: (t: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [hover, setHover] = useState<number | null>(null); // fraction 0..1

  // tick geometry — per round, not per frame
  const ticks = useMemo(() => {
    if (!(duration > 0)) return { kills: [], nades: [], plants: [] } as {
      kills: { left: number; hex: string; label: string }[];
      nades: { left: number; hex: string; label: string }[];
      plants: { left: number; label: string }[];
    };
    return {
      kills: (round.kills ?? [])
        .filter((k) => k.k >= 0)
        .map((k) => ({
          left: (k.t / duration) * 100,
          hex: sideOf(k.k) === "T" ? T : CT,
          label: `Kill · ${mmss(k.t)}`,
        })),
      nades: (round.nades ?? []).map((n) => ({
        left: (n.t / duration) * 100,
        hex: KIND_COLOR[n.k] ?? "#8a7dff",
        label: `${n.k} · ${mmss(n.t)}`,
      })),
      plants: (round.bomb ?? [])
        .filter((b) => b.k === "plant")
        .map((b) => ({ left: (b.t / duration) * 100, label: `Bomb plant · ${mmss(b.t)}` })),
    };
  }, [round, duration, sideOf]);

  const fracAt = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1);
  };
  const pct = duration > 0 ? clamp(time / duration, 0, 1) * 100 : 0;

  const onKeyDown = (e: React.KeyboardEvent) => {
    let d = 0;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") d = e.shiftKey ? -5 : -1;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") d = e.shiftKey ? 5 : 1;
    else if (e.key === "PageDown") d = -10;
    else if (e.key === "PageUp") d = 10;
    else if (e.key === "Home") {
      e.preventDefault();
      onScrub(0);
      return;
    } else if (e.key === "End") {
      e.preventDefault();
      onScrub(duration);
      return;
    } else return;
    e.preventDefault();
    onScrub(clamp(time + d, 0, duration));
  };

  return (
    <div
      ref={barRef}
      role="slider"
      tabIndex={0}
      aria-label="Playback position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration * 10) / 10}
      aria-valuenow={Math.round(time * 10) / 10}
      aria-valuetext={`${mmss(time)} of ${mmss(duration)}`}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        // primary button only — a right/ctrl-click must not seek, and its
        // pointerup can be swallowed by the context menu, sticking the drag
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        onScrub(fracAt(e.clientX) * duration);
      }}
      onPointerMove={(e) => {
        const f = fracAt(e.clientX);
        setHover(f);
        if (dragging.current) onScrub(f * duration);
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      // OS-cancelled touches (edge swipe, notification shade) fire neither
      // pointerup nor leave — clear the drag + tooltip so they can't stick
      onPointerCancel={() => {
        dragging.current = false;
        setHover(null);
      }}
      onLostPointerCapture={() => {
        dragging.current = false;
      }}
      onPointerLeave={() => {
        if (!dragging.current) setHover(null);
      }}
      className="group relative mt-2.5 flex h-5 w-full cursor-pointer touch-none select-none items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-brand/60 lg:mt-1"
    >
      {/* track + played fill */}
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-panel2 ring-1 ring-inset ring-line/70">
        <div className="absolute inset-y-0 left-0 rounded-full bg-brand/60" style={{ width: `${pct}%` }} />
      </div>

      {/* util ticks — dimmed, along the bottom edge */}
      {ticks.nades.map((n, i) => (
        <span
          key={`n${i}`}
          title={n.label}
          className="pointer-events-none absolute bottom-0 h-1 w-0.5 -translate-x-1/2 rounded-full opacity-70"
          style={{ left: `${n.left}%`, background: n.hex }}
        />
      ))}
      {/* kill ticks — CT/T coloured */}
      {ticks.kills.map((k, i) => (
        <span
          key={`k${i}`}
          title={k.label}
          className="pointer-events-none absolute top-1/2 h-2.5 w-0.75 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${k.left}%`, background: k.hex, boxShadow: "0 0 0 1px rgba(4,6,14,0.7)" }}
        />
      ))}
      {/* bomb plant */}
      {ticks.plants.map((b, i) => (
        <span
          key={`b${i}`}
          title={b.label}
          className="pointer-events-none absolute top-0 h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-white"
          style={{ left: `${b.left}%`, boxShadow: "0 0 4px rgba(255,255,255,0.7)" }}
        />
      ))}

      {/* thumb */}
      <span
        className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand shadow-[0_0_6px_rgba(56,214,255,0.8)] transition-transform group-hover:scale-110"
        style={{ left: `${pct}%` }}
      />

      {/* hover time tooltip */}
      {hover != null && duration > 0 && (
        <span
          className="pointer-events-none absolute -top-5.5 -translate-x-1/2 rounded border border-line2 bg-bg/90 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none text-ink"
          style={{ left: `${hover * 100}%` }}
        >
          {mmss(hover * duration)}
        </span>
      )}
    </div>
  );
}

export default function ReplayPage() {
  const { id } = useParams<{ id: string }>();
  const [meta, setMeta] = useState<ReplayMeta | null>(null);
  const [rounds, setRounds] = useState<ReplayRound[]>([]);
  const [name, setName] = useState("");
  // inline demo rename (pencil in the header) — persists to the local library
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
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
  // a "watch this moment" request from another tab (Cheat/AI evidence): switch
  // to the replay, scope the round, then seek to the kill once it's loaded.
  const [jump, setJump] = useState<{ round: number; time: number } | null>(null);

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

  // Lock the document to the viewport on desktop (see body.workspace-lock in
  // globals.css): the workspace — not the page — owns scrolling, so every lens
  // fits on one screen and long lists scroll inside their own panel.
  useEffect(() => {
    document.body.classList.add("workspace-lock");
    return () => document.body.classList.remove("workspace-lock");
  }, []);

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

  // load the map's call-out zones so the live feed can name util landings.
  // Re-read on tab change too: edits made in the Zones tab (same page, no
  // remount) must show up when switching back to the replay.
  useEffect(() => {
    if (meta) setZones(loadZones(meta.map));
  }, [meta, tab]);

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

  // animation loop — only while the Replay tab is showing. Other tabs don't
  // draw the canvas, and letting the rAF run there re-renders the workspace
  // every frame for nothing. Resetting lastTs on (re)start gives the first
  // tick a zero dt, so returning to the tab resumes without a time jump.
  useEffect(() => {
    if (!round || tab !== "replay") return;
    lastTs.current = 0;
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
  }, [round, duration, draw, tab]);

  const seek = (t: number) => {
    tRef.current = clamp(t, 0, duration);
    setTime(tRef.current);
  };

  // Jump-to-replay: called from the Cheat/AI evidence list. Focus the player,
  // scope the round (the sync effect loads it), and record the target time; the
  // effect below seeks once that round is loaded. pendingJumpRound tells the
  // sync effect NOT to reset this round's time to 0 — so the seek isn't
  // stomped even when both effects fire in the same commit (order-independent).
  const pendingJumpRound = useRef<number | null>(null);
  const jumpToReplay = useCallback(
    (roundIndex: number, t: number, player: number | null) => {
      if (player != null) setFocusPlayer(player);
      pendingJumpRound.current = roundIndex;
      setScopeRound(roundIndex);
      setJump({ round: roundIndex, time: t });
      setTab("replay");
    },
    [],
  );

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
    // don't reset the playhead when a jump for this round is pending — the jump
    // effect owns the time and would otherwise be stomped back to 0:00.
    if (pendingJumpRound.current !== scopeRound) {
      tRef.current = 0;
      setTime(0);
    }
    playRef.current = false;
    setPlaying(false);
    setViewport({ scale: 1, ox: 0, oy: 0 }); // each round starts unzoomed
  }, [scopeRound, rounds.length, setViewport]);

  // Consume a pending jump once its round is loaded. Declared AFTER the sync
  // effect above so it runs LAST — the seek always wins over the sync effect's
  // playhead reset even when both fire in the same commit.
  useEffect(() => {
    if (!jump || roundIdx !== jump.round) return;
    tRef.current = clamp(jump.time, 0, duration);
    setTime(tRef.current);
    playRef.current = false;
    setPlaying(false);
    pendingJumpRound.current = null;
    setJump(null);
  }, [jump, roundIdx, duration]);

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

  // Round navigation from the replay transport. Coupling to the workspace-wide
  // round scope is OPT-IN: when the user has scoped a round (toolbar chip /
  // evidence jump) stepping moves that scope too, but plain browsing through a
  // demo must not silently re-scope every other tab — so unscoped stepping
  // drives only the replay's local round.
  const goRound = (i: number) => {
    const n = clamp(i, 0, rounds.length - 1);
    if (scopeRound != null) {
      setScopeRound(n); // scoped mode: the sync effect updates the replay
      return;
    }
    setRoundIdx(n);
    roundRef.current = n;
    tRef.current = 0;
    setTime(0);
    playRef.current = false;
    setPlaying(false);
    setViewport({ scale: 1, ox: 0, oy: 0 });
  };
  const atFirst = roundIdx <= 0;
  const atLast = roundIdx >= rounds.length - 1;
  const finished = duration > 0 && time >= duration - 0.05;
  const winHex = round.winner === "T" ? T : round.winner === "CT" ? CT : "#8a7dff";
  const replay = () => {
    seek(0);
    playRef.current = true;
    setPlaying(true);
  };

  // Match score by TEAM, not by side (sides swap at half, so a raw CT/T count
  // isn't the score). teamA started CT (blue), teamB started T (amber).
  const { a: teamAScore, b: teamBScore } = teamScore(rounds);

  // inline rename: commit trims + persists to the library; empty/unchanged is a no-op
  const startRename = () => {
    setDraftName(name);
    setEditingName(true);
  };
  const commitRename = () => {
    const v = draftName.trim();
    if (v && v !== name) {
      setName(v);
      void renameMatch(String(id), v);
    }
    setEditingName(false);
  };

  return (
    <div className="full-bleed flex flex-col gap-3 px-4 lg:h-full lg:min-h-0 lg:gap-2.5 lg:px-6">
      {/* unified header: identity | centered scoreline | match stats, with the
          lens tabs built in. Balanced three-zone layout (scoreboard style). */}
      <section
        className="card-2 shrink-0 overflow-hidden"
        style={{ boxShadow: "0 0 44px -18px rgba(56,214,255,0.28)" }}
      >
        <div className="flex flex-col gap-3 px-4 pb-3 pt-3.5 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-4 sm:px-5 lg:py-2">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/demos"
              title="Back to demo library"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-panel text-base text-muted transition hover:border-brand/60 hover:text-ink"
            >
              ←
            </Link>
            {hasCalibration(meta.map) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={radarImage(meta.map)}
                alt={mapLabel(meta.map)}
                className="h-12 w-12 shrink-0 rounded-lg border border-line object-cover lg:h-10 lg:w-10"
              />
            ) : (
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-line bg-panel2 text-xl text-faint lg:h-10 lg:w-10">
                ◎
              </div>
            )}
            <div className="min-w-0 flex-1">
              {editingName ? (
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") {
                      // reset the draft first so a stray blur can't commit it
                      setDraftName(name);
                      setEditingName(false);
                    }
                  }}
                  maxLength={80}
                  aria-label="Demo name"
                  className="w-full max-w-72 rounded-lg border border-brand/50 bg-panel px-2 py-0.5 text-lg font-extrabold leading-tight tracking-tight outline-none ring-2 ring-brand/20"
                />
              ) : (
                <div className="group flex min-w-0 items-center gap-1.5">
                  <h1 className="truncate text-lg font-extrabold leading-tight tracking-tight">
                    {name}
                  </h1>
                  <button
                    type="button"
                    onClick={startRename}
                    title="Rename this demo"
                    className="shrink-0 rounded p-0.5 text-faint opacity-60 transition hover:bg-panel hover:text-brand group-hover:opacity-100"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                    </svg>
                  </button>
                </div>
              )}
              <div className="mt-1 text-xs text-muted">
                <span className="font-semibold capitalize text-ink">{mapLabel(meta.map)}</span>
              </div>
            </div>
          </div>

          {/* scoreline — final score by team (winner emphasized with a soft
              glow). Teams are identified by the side they started on; they
              swap at halftime. */}
          <div
            className="flex shrink-0 items-center justify-center gap-4 rounded-xl border border-line bg-panel/50 px-5 py-1.5 lg:py-1"
            title="Final score by team — sides swap at halftime, so each team is named for the side it started on"
          >
            <div className="text-center">
              <div
                className="text-2xl font-extrabold leading-none tabular-nums"
                style={{
                  color: CT,
                  opacity: teamAScore >= teamBScore ? 1 : 0.55,
                  textShadow: teamAScore > teamBScore ? `0 0 16px ${colA(CT, 0.6)}` : "none",
                }}
              >
                {teamAScore}
              </div>
              <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider" style={{ color: CT }}>
                CT start
              </div>
            </div>
            <div className="text-lg font-bold text-faint">:</div>
            <div className="text-center">
              <div
                className="text-2xl font-extrabold leading-none tabular-nums"
                style={{
                  color: T,
                  opacity: teamBScore >= teamAScore ? 1 : 0.55,
                  textShadow: teamBScore > teamAScore ? `0 0 16px ${colA(T, 0.6)}` : "none",
                }}
              >
                {teamBScore}
              </div>
              <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider" style={{ color: T }}>
                T start
              </div>
            </div>
          </div>

          {/* right zone: match stats, balancing the identity block */}
          <div className="flex items-center gap-2 sm:justify-end">
            <div className="rounded-lg border border-line bg-panel/50 px-3 py-1 text-center">
              <div className="text-sm font-bold leading-tight tabular-nums">{rounds.length}</div>
              <div className="text-[9px] uppercase tracking-wider text-faint">Rounds</div>
            </div>
            <div className="rounded-lg border border-line bg-panel/50 px-3 py-1 text-center">
              <div className="text-sm font-bold leading-tight tabular-nums">{meta.players.length}</div>
              <div className="text-[9px] uppercase tracking-wider text-faint">Players</div>
            </div>
          </div>
        </div>

        {/* lens tabs — a segmented icon nav built into the header. The inner
            w-max wrapper centers the group when it fits and still scrolls
            correctly from the left edge when it overflows. */}
        <div className="scroll-slim overflow-x-auto border-t border-line/60 bg-panel/25 px-2 py-1.5 lg:py-1">
          <div className="mx-auto flex w-max gap-1">
          {TABS.map((tb) => {
            const on = tab === tb.k;
            return (
              <button
                key={tb.k}
                type="button"
                onClick={() => setTab(tb.k)}
                aria-current={on ? "page" : undefined}
                className={`relative flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition lg:py-1 ${
                  on
                    ? "bg-brand/15 text-brand shadow-[inset_0_0_0_1px] shadow-brand/30"
                    : "text-muted hover:bg-panel/70 hover:text-ink"
                }`}
              >
                <TabIcon k={tb.k} className={`h-3.5 w-3.5 transition-opacity ${on ? "opacity-100" : "opacity-70"}`} />
                {tb.label}
                {/* underline offset must stay <= the strip's bottom padding at
                    every breakpoint or it clips (py-1.5 sub-lg, lg:py-1) */}
                {on && (
                  <span className="absolute inset-x-3 -bottom-1.25 h-0.5 rounded-full bg-brand/70 lg:-bottom-0.75" aria-hidden />
                )}
              </button>
            );
          })}
          </div>
        </div>
      </section>

      {/* the zones tab is a map-wide editor — player/round filters don't apply */}
      {tab !== "zones" && (
        <MatchToolbar
          meta={meta}
          rounds={rounds}
          view={view}
          showSide={tab !== "replay"}
        />
      )}

      {/* lens pane: at lg+ this is the rest of the viewport — lenses fill it
          and scroll internally; the pane (never the page) absorbs overflow */}
      <div className="scroll-slim lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
      {tab === "scoreboard" && <MatchScoreboard meta={meta} rounds={rounds} view={view} />}
      {tab === "routes" && <RouteAnalytics meta={meta} rounds={rounds} view={view} />}
      {tab === "weapons" && <WeaponInsights meta={meta} rounds={rounds} view={view} />}
      {tab === "insights" && <UtilityBreakdown meta={meta} rounds={rounds} view={view} />}
      {tab === "scout" && <TendencyScout meta={meta} rounds={rounds} view={view} />}
      {tab === "map" && <StrategyMap meta={meta} rounds={rounds} name={name} view={view} />}
      {tab === "zones" && <ZoneEditor map={meta.map} fit />}
      {tab === "verdict" && <MatchVerdict meta={meta} rounds={rounds} view={view} demoId={String(id)} onWatch={jumpToReplay} />}

      {tab === "replay" && (
        <div className="grid gap-4 lg:h-full lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] lg:items-stretch lg:gap-3 2xl:mx-auto 2xl:w-full 2xl:max-w-[1600px] 2xl:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.6fr)_minmax(320px,0.65fr)]">
          {/* player unit. At lg+ it's a size container: the radar square takes
              min(width, height − slim transport) so the WHOLE map stays
              visible — nothing overlays map pixels. Side columns are fr-based
              so they absorb the leftover width beside the square. */}
          <div className="min-w-0 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:items-center lg:justify-center lg:gap-2 lg:@container-size">
        <div className="relative mx-auto w-full max-w-180 lg:mx-0 lg:w-[min(100cqw,calc(100cqh-104px))] lg:max-w-none">
        {/* canvas + its overlays get their own box so overlays anchor to the
            map, not to the wrapper (which sub-lg also contains the transport) */}
        <div className="relative">
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
        </div>

        {/* transport bar — a slim strip BELOW the map spanning the full
            column (theater-mode style): never covers map pixels, and its
            controls row always has room no matter how small the height-bound
            radar gets. The radar math reserves its ~104px. */}
        <div className="card mx-auto mt-3 w-full max-w-180 px-3.5 py-2.5 lg:mt-0 lg:w-full lg:max-w-none lg:px-3 lg:py-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 lg:min-w-0 lg:flex-nowrap">
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => goRound(roundIdx - 1)}
                disabled={atFirst}
                title="Previous round"
                className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-panel text-muted transition hover:text-ink disabled:opacity-40 lg:h-7 lg:w-7"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
                  <path d="M6 5h2v14H6zM20 5v14l-10-7z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (tRef.current >= duration) seek(0);
                  const np = !playRef.current;
                  playRef.current = np;
                  setPlaying(np);
                }}
                title={playing ? "Pause" : "Play"}
                className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-[#06101d] transition hover:brightness-110 lg:h-8 lg:w-8"
              >
                {playing ? (
                  <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="currentColor" aria-hidden>
                    <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="currentColor" aria-hidden>
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                onClick={() => goRound(roundIdx + 1)}
                disabled={atLast}
                title="Next round"
                className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-panel text-muted transition hover:text-ink disabled:opacity-40 lg:h-7 lg:w-7"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
                  <path d="M16 5h2v14h-2zM4 5v14l10-7z" />
                </svg>
              </button>
            </div>

            <span className="text-xs font-semibold tabular-nums lg:min-w-0 lg:truncate">
              Round {round.n}
              {round.winner && (
                <span className="ml-1.5 pill" style={{ background: `${winHex}22`, color: winHex }}>
                  {round.winner}
                </span>
              )}
              <span className="ml-1.5 text-faint">{roundIdx + 1}/{rounds.length}</span>
            </span>

            <div className="flex shrink-0 rounded-lg border border-line bg-panel p-0.5">
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
                className="pill shrink-0 whitespace-nowrap bg-brand/15 text-brand"
              >
                R{round.n} scoped ✕
              </button>
            )}
            <span className="ml-auto shrink-0 text-xs tabular-nums text-muted">
              {mmss(time)} / {mmss(duration)}
            </span>
          </div>
          <ScrubBar
            round={round}
            duration={duration}
            time={time}
            sideOf={sideOf}
            onScrub={(t) => {
              playRef.current = false;
              setPlaying(false);
              seek(t);
            }}
          />
        </div>
          </div>

          {/* right rail: live feed → player detail → teams. At lg+ it fills the
              pane; the feed flexes and its kill log scrolls, the cards keep
              their height and the rail scrolls if a player card overflows.
              At 2xl the rail dissolves (contents) into TWO grid columns —
              live feed | detail stack — so wide screens show everything. */}
          <div className="scroll-slim space-y-3 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:gap-2.5 lg:space-y-0 lg:overflow-y-auto 2xl:contents">
          <div className="lg:flex lg:min-h-56 lg:flex-1 lg:flex-col 2xl:h-full 2xl:min-h-0">
            <EventFeed
              round={round}
              time={time}
              meta={meta}
              zones={zones}
              // pause on jump — reviewing a kill at 4x speed is useless, and
              // every other seek path (scrub, evidence jumps) pauses too
              onSeek={(t) => {
                playRef.current = false;
                setPlaying(false);
                seek(t);
              }}
            />
          </div>

          <div className="scroll-slim space-y-3 lg:contents lg:space-y-0 2xl:flex 2xl:h-full 2xl:min-h-0 2xl:flex-col 2xl:gap-2.5 2xl:overflow-y-auto">
          {focusPlayer != null ? (
            <div className="lg:shrink-0">
              <PlayerRoundCard
                round={round}
                meta={meta}
                i={focusPlayer}
                rounds={rounds}
                zoneOf={(x, y) => classifyPosition(meta.map, x, y, zones)?.name ?? null}
                onClose={() => setFocusPlayer(null)}
              />
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-line px-3 py-2 text-[11px] text-faint lg:shrink-0">
              Tip: scroll to zoom · drag to pan · click a player dot for their round detail.
            </div>
          )}

          <div className="card px-4 py-3 text-sm lg:shrink-0">
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
        </div>
      )}
      </div>
    </div>
  );
}
