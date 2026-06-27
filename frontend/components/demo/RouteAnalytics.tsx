"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import { analyzeRoutes, type PlayerPath, type RouteCluster, type Side } from "@/lib/demo/routes";
import { radarImage } from "@/lib/maps/calibration";
import { buildProjection } from "@/lib/demo/projection";
import { loadZones, classifyPosition, ZONE_COLOR, type Zone } from "@/lib/maps/zones";
import { KIND_COLOR } from "@/components/demo/RadarMap";
import { weaponLabel } from "@/lib/demo/insights";
import type { DemoView } from "@/components/demo/MatchToolbar";

const CT = "#5b9dff";
const T = "#e7b53c";
const CT_SOFT = "#9cc1ff";
const T_SOFT = "#f0cd78";
const winColor = (wr: number, alpha = 1) => `hsla(${Math.round(wr * 120)}, 70%, 55%, ${alpha})`;
const sideHex = (s: Side | "") => (s === "T" ? T : CT);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.max(0, Math.round(t % 60))).padStart(2, "0")}`;

interface Props { meta: ReplayMeta; rounds: ReplayRound[]; view: DemoView; }
type ViewMode = "common" | "individual";

function reasonLabel(reason: string, winner: string): string {
  const k = (reason || "").toLowerCase();
  if (k.includes("defus")) return "Bomb defused";
  if (k.includes("bomb") || k.includes("detonat")) return "Bomb detonated";
  if (k.includes("time") || k.includes("saved") || k.includes("expir")) return "Time expired";
  if (k.includes("surrender")) return "Surrender";
  if (k.includes("elim") || k.includes("won") || k.includes("win") || k.includes("kill"))
    return `${winner === "CT" ? "CTs" : "Terrorists"} eliminated`;
  return reason ? reason.replace(/_/g, " ") : "Round ended";
}

export default function RouteAnalytics({ meta, rounds, view }: Props) {
  const [mode, setMode] = useState<ViewMode>("common");
  const [selected, setSelected] = useState<string | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: 50, y: 50 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const proj = useMemo(() => buildProjection(meta.map, rounds), [meta, rounds]);
  const calibrated = proj.calibrated;
  const analysis = useMemo(() => analyzeRoutes(meta, rounds), [meta, rounds]);

  const sideFilter = view.side;
  const playerFilter: number | "all" = view.focusPlayer ?? "all";
  const scopedRound =
    view.scopeRound != null && view.scopeRound >= 0 && view.scopeRound < rounds.length
      ? rounds[view.scopeRound]
      : null;
  const roundFilter: number | "all" = scopedRound ? scopedRound.n : "all";

  useEffect(() => {
    setZones(loadZones(meta.map));
  }, [meta.map]);

  useEffect(() => {
    setSelected(null);
  }, [view.side, view.focusPlayer, view.scopeRound, mode]);

  // native non-passive wheel zoom (so the page doesn't scroll while zooming)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => clamp(+(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)).toFixed(3), 1, 6));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const clampCenter = (c: { x: number; y: number }, z: number) => {
    const half = 50 / z;
    return { x: clamp(c.x, half, 100 - half), y: clamp(c.y, half, 100 - half) };
  };
  const onDown = (e: React.MouseEvent) => {
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onMove = (e: React.MouseEvent) => {
    if (!drag.current || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const span = 100 / zoom;
    const dx = ((e.clientX - drag.current.x) / rect.width) * span;
    const dy = ((e.clientY - drag.current.y) / rect.height) * span;
    drag.current = { x: e.clientX, y: e.clientY };
    setCenter((c) => clampCenter({ x: c.x - dx, y: c.y - dy }, zoom));
  };
  const onUp = () => {
    drag.current = null;
  };
  const resetView = () => {
    setZoom(1);
    setCenter({ x: 50, y: 50 });
  };

  const pt = (x: number, y: number) => {
    const r = proj.project(x, y);
    return r ? { x: r.x * 100, y: r.y * 100 } : null;
  };
  const matchPath = (p: PlayerPath) =>
    (sideFilter === "all" || p.side === sideFilter) &&
    (playerFilter === "all" || p.playerIndex === playerFilter) &&
    (roundFilter === "all" || p.round === roundFilter);

  const clusters = useMemo(() => analysis.clusters
    .map((c) => ({ ...c, paths: c.paths.filter(matchPath) }))
    .filter((c) => c.paths.length > 0).map(recomputeCluster)
    .sort((a, b) => b.usage - a.usage),
    [analysis.clusters, sideFilter, playerFilter, roundFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const individualPaths = useMemo(() => analysis.paths.filter(matchPath),
    [analysis.paths, sideFilter, playerFilter, roundFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCluster = mode === "common" ? clusters.find((c) => c.id === selected) ?? null : null;

  const drawnPaths = useMemo(() => {
    if (mode === "individual")
      return individualPaths.map((p) => ({ path: p, winRate: p.won ? 1 : 0, emphasis: false }));
    const source = selectedCluster ? [selectedCluster] : clusters;
    return source.flatMap((c) => c.paths.map((p) => ({ path: p, winRate: c.winRate, emphasis: !!selectedCluster })));
  }, [mode, individualPaths, clusters, selectedCluster]);

  // map markers: a scoped round shows its kills/deaths/util/bomb; otherwise a
  // drilled-in cluster shows its kills/deaths.
  const killMarks = scopedRound
    ? (scopedRound.kills ?? []).filter((k) => k.k >= 0).map((k) => ({ x: k.kx, y: k.ky }))
    : selectedCluster?.killPositions ?? [];
  const deathMarks = scopedRound
    ? (scopedRound.kills ?? []).map((k) => ({ x: k.vx, y: k.vy }))
    : selectedCluster?.deathPositions ?? [];
  const nadeMarks = scopedRound ? scopedRound.nades ?? [] : [];
  const bombMark = scopedRound ? (scopedRound.bomb ?? []).find((b) => b.k === "plant") ?? null : null;

  const summary = useMemo(() => {
    const ps = individualPaths;
    const wins = ps.filter((p) => p.won).length;
    return {
      paths: ps.length, winRate: ps.length ? wins / ps.length : 0,
      kills: ps.reduce((s, p) => s + p.kills.length, 0),
      deaths: ps.filter((p) => p.died).length,
      avgLife: ps.length ? ps.reduce((s, p) => s + p.lifetime, 0) / ps.length : 0,
    };
  }, [individualPaths]);

  const score = useMemo(() => {
    if (view.scopeRound == null) return null;
    let ct = 0, t = 0;
    for (let i = 0; i <= view.scopeRound && i < rounds.length; i++) {
      if (rounds[i].winner === "CT") ct++;
      else if (rounds[i].winner === "T") t++;
    }
    return { ct, t };
  }, [rounds, view.scopeRound]);

  if (!analysis.paths.length)
    return <div className="card px-5 py-6 text-sm text-muted">No movement data in this match to derive routes.</div>;

  const half = 50 / zoom;
  const cc = clampCenter(center, zoom);
  const viewBox = `${cc.x - half} ${cc.y - half} ${2 * half} ${2 * half}`;
  const s = 1 / zoom; // keep marker sizes visually constant while zoomed

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={mode} onChange={(v) => { setMode(v); setSelected(null); }}
          options={[{ key: "common", label: "Common routes" }, { key: "individual", label: "All paths" }]} />
        <span className="text-[11px] text-faint">
          Pick a player, round &amp; side in the toolbar. Choose a round to see its full breakdown.
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-3">
          <div
            ref={wrapRef}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
            className={`relative aspect-square w-full max-w-200 overflow-hidden rounded-xl border border-line bg-panel2 ${
              zoom > 1 ? "cursor-grab active:cursor-grabbing" : ""
            }`}
          >
            <svg viewBox={viewBox} preserveAspectRatio="none" className="absolute inset-0 h-full w-full select-none">
              {calibrated ? (
                <image href={radarImage(meta.map)} x={0} y={0} width={100} height={100} preserveAspectRatio="none" opacity={0.9} />
              ) : (
                <g stroke="rgba(56,214,255,0.07)" strokeWidth={s * 0.3}>
                  {Array.from({ length: 17 }, (_, i) => (
                    <g key={i}>
                      <line x1={(i * 100) / 16} y1={0} x2={(i * 100) / 16} y2={100} />
                      <line x1={0} y1={(i * 100) / 16} x2={100} y2={(i * 100) / 16} />
                    </g>
                  ))}
                </g>
              )}

              {/* call-out zones */}
              {calibrated && zones.map((z) => {
                if (z.points.length < 3) return null;
                const d = z.points.map((p, i) => `${i ? "L" : "M"} ${p.x * 100} ${p.y * 100}`).join(" ") + " Z";
                return <path key={z.id} d={d} fill={(ZONE_COLOR[z.kind] ?? "#8a7dff") + "14"} stroke={(ZONE_COLOR[z.kind] ?? "#8a7dff") + "55"} strokeWidth={s * 0.3} />;
              })}

              {/* routes */}
              {drawnPaths.map(({ path, winRate, emphasis }) => {
                const d = pathD(path, pt); if (!d) return null;
                return (
                  <g key={path.key}>
                    <path d={d} fill="none" stroke={winColor(winRate, emphasis ? 0.9 : 0.4)}
                      strokeWidth={(emphasis ? 0.8 : 0.32) * s} strokeLinecap="round" strokeLinejoin="round" />
                    <StartEnd path={path} winRate={winRate} pt={pt} scale={s} />
                  </g>
                );
              })}

              {/* kills (X) + deaths (ring) */}
              {killMarks.map((k, i) => { const c = pt(k.x, k.y); if (!c) return null;
                return <g key={`k${i}`} stroke="#46d369" strokeWidth={0.5 * s}>
                  <line x1={c.x - s} y1={c.y - s} x2={c.x + s} y2={c.y + s} />
                  <line x1={c.x + s} y1={c.y - s} x2={c.x - s} y2={c.y + s} /></g>; })}
              {deathMarks.map((dp, i) => { const c = pt(dp.x, dp.y); if (!c) return null;
                return <circle key={`d${i}`} cx={c.x} cy={c.y} r={0.9 * s} fill="none" stroke="#f5694a" strokeWidth={0.4 * s} />; })}

              {/* util landings (scoped round) */}
              {nadeMarks.map((n, i) => { const c = pt(n.x, n.y); if (!c) return null;
                return <circle key={`n${i}`} cx={c.x} cy={c.y} r={1 * s} fill={(KIND_COLOR[n.k] ?? "#8a7dff") + "cc"} stroke="#04060e" strokeWidth={0.2 * s} />; })}

              {/* bomb plant */}
              {bombMark && (() => { const c = pt(bombMark.x, bombMark.y); if (!c) return null;
                return <g key="bomb"><circle cx={c.x} cy={c.y} r={1.4 * s} fill="#f5694a" /><text x={c.x} y={c.y - 2 * s} fill="#fff" fontSize={2.6 * s} textAnchor="middle" fontWeight="bold">C4</text></g>; })()}
            </svg>

            {/* zoom controls */}
            <div className="absolute right-2 top-2 flex flex-col gap-1">
              <button type="button" onClick={() => setZoom((z) => clamp(+(z * 1.4).toFixed(3), 1, 6))} className="grid h-7 w-7 place-items-center rounded-md border border-line bg-bg/80 text-sm font-bold backdrop-blur hover:text-brand">+</button>
              <button type="button" onClick={() => setZoom((z) => clamp(+(z / 1.4).toFixed(3), 1, 6))} className="grid h-7 w-7 place-items-center rounded-md border border-line bg-bg/80 text-sm font-bold backdrop-blur hover:text-brand">−</button>
              {zoom > 1 && (
                <button type="button" onClick={resetView} title="Reset zoom" className="grid h-7 w-7 place-items-center rounded-md border border-line bg-bg/80 text-[10px] backdrop-blur hover:text-brand">⤢</button>
              )}
            </div>
            {zoom > 1 && (
              <div className="pointer-events-none absolute left-2 top-2 rounded-full bg-bg/70 px-2 py-0.5 text-[10px] text-muted backdrop-blur">
                {zoom.toFixed(1)}× · drag to pan
              </div>
            )}
            {!calibrated && <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-mid/15 px-2 py-0.5 text-[10px] text-mid">{meta.map} uncalibrated — auto-scaled</div>}
          </div>

          {/* legend */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[10px] text-faint">
            <Legend swatch="#46d369" label="kill" shape="x" />
            <Legend swatch="#f5694a" label="death" shape="o" />
            <Legend swatch={KIND_COLOR.smoke} label="smoke" />
            <Legend swatch={KIND_COLOR.flash} label="flash" />
            <Legend swatch={KIND_COLOR.he} label="HE" />
            <Legend swatch={KIND_COLOR.molotov} label="molly" />
            {scopedRound && <span className="ml-auto">scroll / +/− to zoom</span>}
          </div>

          {!scopedRound && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              <Stat label="Paths" value={String(summary.paths)} />
              <Stat label="Win rate" value={`${Math.round(summary.winRate * 100)}%`} color={winColor(summary.winRate)} />
              <Stat label="Kills" value={String(summary.kills)} />
              <Stat label="Deaths" value={String(summary.deaths)} />
              <Stat label="Avg life" value={`${summary.avgLife.toFixed(1)}s`} />
            </div>
          )}
        </div>

        {/* right panel: round breakdown when a round is scoped, else routes */}
        {scopedRound ? (
          <RoundDetail meta={meta} round={scopedRound} zones={zones} score={score} />
        ) : (
          <div className="card flex max-h-200 flex-col px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="stat-label">{mode === "common" ? `${clusters.length} common routes` : `${individualPaths.length} player paths`}</span>
              {selectedCluster && <button type="button" onClick={() => setSelected(null)} className="text-[10px] text-faint hover:text-ink">✕ clear</button>}
            </div>
            <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
              {(mode === "common" ? clusters.length : individualPaths.length) === 0 ? (
                <div className="grid h-full min-h-24 place-items-center px-4 text-center text-xs text-muted">
                  No routes match the current player / round / side filter — clear it in the toolbar above.
                </div>
              ) : mode === "common" ? (
                clusters.map((c) => <RouteRow key={c.id} cluster={c} active={c.id === selected} onClick={() => setSelected(c.id === selected ? null : c.id)} />)
              ) : (
                individualPaths.slice().sort((a, b) => a.round - b.round).map((p) => <PathRow key={p.key} path={p} />)
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- round breakdown --------------------------------------------------------

function RoundDetail({
  meta,
  round,
  zones,
  score,
}: {
  meta: ReplayMeta;
  round: ReplayRound;
  zones: Zone[];
  score: { ct: number; t: number } | null;
}) {
  const winHex = round.winner === "T" ? T : round.winner === "CT" ? CT : "#8a7dff";
  const kills = [...(round.kills ?? [])].sort((a, b) => a.t - b.t);
  const nades = [...(round.nades ?? [])].sort((a, b) => a.t - b.t);
  const name = (i: number) => meta.players[i]?.name ?? `P${i + 1}`;
  const zoneOf = (x: number, y: number) => classifyPosition(meta.map, x, y, zones)?.name ?? null;

  const status = (i: number) => {
    const death = kills.find((k) => k.v === i);
    const ks = kills.filter((k) => k.k === i).length;
    return { died: !!death, deathT: death?.t ?? null, kills: ks };
  };
  const roster = (ids: number[] | undefined, side: Side) =>
    (ids ?? []).map((i) => ({ i, side, ...status(i) }));
  const ct = roster(round.ct, "CT");
  const t = roster(round.t, "T");

  return (
    <div className="card flex max-h-200 flex-col overflow-hidden p-0">
      {/* winner banner */}
      <div
        className="flex items-center justify-between gap-2 px-4 py-3"
        style={{ background: `linear-gradient(90deg, ${winHex}26, transparent)` }}
      >
        <div>
          <div className="text-xs text-muted">Round {round.n}</div>
          <div className="text-lg font-extrabold" style={{ color: winHex }}>
            {round.winner ? `${round.winner} win` : "—"}
          </div>
          <div className="text-xs text-muted">{reasonLabel(round.reason, round.winner)}</div>
        </div>
        {score && (
          <div className="text-right text-sm font-bold tabular-nums">
            <span style={{ color: CT }}>{score.ct}</span>
            <span className="text-faint"> : </span>
            <span style={{ color: T }}>{score.t}</span>
            <div className="text-[10px] font-normal text-faint">score after</div>
          </div>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {/* rosters */}
        <div className="grid grid-cols-2 gap-3">
          {[{ side: "CT" as Side, list: ct, hex: CT, soft: CT_SOFT }, { side: "T" as Side, list: t, hex: T, soft: T_SOFT }].map((col) => (
            <div key={col.side}>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold" style={{ color: col.soft }}>
                <span className="h-2 w-2 rounded-full" style={{ background: col.hex }} /> {col.side}
                <span className="ml-auto text-[10px] text-faint">
                  {col.list.filter((p) => !p.died).length}/{col.list.length} alive
                </span>
              </div>
              <div className="space-y-0.5">
                {col.list.map((p) => (
                  <div key={p.i} className={`flex items-center gap-1.5 text-xs ${p.died ? "text-muted" : "text-ink"}`}>
                    <span className="w-3 text-center">{p.died ? <span className="text-bad">✕</span> : <span className="text-good">✓</span>}</span>
                    <span className="truncate">{name(p.i)}</span>
                    {p.kills > 0 && <span className="ml-auto shrink-0 text-faint">{p.kills}K</span>}
                    {p.died && p.deathT != null && (
                      <span className={`shrink-0 tabular-nums text-faint ${p.kills > 0 ? "ml-1.5" : "ml-auto"}`}>{mmss(p.deathT)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* util timeline */}
        <div>
          <div className="stat-label mb-1.5">Utility ({nades.length})</div>
          {nades.length === 0 ? (
            <div className="text-[11px] text-faint">No utility this round.</div>
          ) : (
            <div className="space-y-0.5">
              {nades.map((n, i) => {
                const zone = zoneOf(n.x, n.y);
                return (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className="w-8 shrink-0 tabular-nums text-faint">{mmss(n.t)}</span>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_COLOR[n.k] ?? "#8a7dff" }} />
                    <span className="capitalize text-muted">{n.k}</span>
                    {n.by >= 0 && <span className="text-faint">· {name(n.by)}</span>}
                    {zone && <span className="ml-auto truncate text-faint">{zone}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* kill feed */}
        <div>
          <div className="stat-label mb-1.5">Kills ({kills.filter((k) => k.k >= 0).length})</div>
          {kills.filter((k) => k.k >= 0).length === 0 ? (
            <div className="text-[11px] text-faint">No kills this round.</div>
          ) : (
            <div className="space-y-0.5">
              {kills.filter((k) => k.k >= 0).map((k, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[11px]">
                  <span className="w-8 shrink-0 tabular-nums text-faint">{mmss(k.t)}</span>
                  <span className="truncate font-medium" style={{ color: sideHex(round.ct?.includes(k.k) ? "CT" : "T") }}>{name(k.k)}</span>
                  <span className="text-faint">{weaponLabel(k.w)}{k.hs ? " ⌖" : ""}</span>
                  <span className="ml-auto truncate text-muted">{name(k.v)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- helpers ----------------------------------------------------------------

function recomputeCluster(c: RouteCluster): RouteCluster {
  const members = c.paths; const wins = members.filter((m) => m.won).length;
  return { ...c, usage: members.length, winRate: members.length ? wins / members.length : 0,
    avgLifetime: members.length ? members.reduce((s, m) => s + m.lifetime, 0) / members.length : 0,
    kills: members.reduce((s, m) => s + m.kills.length, 0), deaths: members.filter((m) => m.died).length,
    killPositions: members.flatMap((m) => m.kills), deathPositions: members.flatMap((m) => (m.death ? [m.death] : [])) };
}

type PtFn = (x: number, y: number) => { x: number; y: number } | null;
function pathD(p: PlayerPath, pt: PtFn): string | null {
  const pts = p.points.map((s) => pt(s.x, s.y)).filter(Boolean) as { x: number; y: number }[];
  if (pts.length < 2) return null;
  return pts.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`).join(" ");
}
function StartEnd({ path, winRate, pt, scale }: { path: PlayerPath; winRate: number; pt: PtFn; scale: number }) {
  const a = path.points[0]; const b = path.points[path.points.length - 1];
  const start = pt(a.x, a.y); const end = pt(b.x, b.y);
  return <>{start && <circle cx={start.x} cy={start.y} r={0.55 * scale} fill={path.side === "T" ? T : CT} />}
    {end && <circle cx={end.x} cy={end.y} r={0.7 * scale} fill={winColor(winRate)} />}</>;
}
function Legend({ swatch, label, shape }: { swatch: string; label: string; shape?: "x" | "o" }) {
  return (
    <span className="flex items-center gap-1">
      {shape === "x" ? (
        <span style={{ color: swatch }} className="font-bold">✕</span>
      ) : shape === "o" ? (
        <span style={{ color: swatch }}>◯</span>
      ) : (
        <span className="h-2 w-2 rounded-full" style={{ background: swatch }} />
      )}
      {label}
    </span>
  );
}
function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { key: T; label: string }[] }) {
  return <div className="flex rounded-lg border border-line bg-panel p-0.5">{options.map((o) =>
    <button key={o.key} type="button" onClick={() => onChange(o.key)}
      className={`rounded-md px-2.5 py-0.5 text-xs font-medium transition ${value === o.key ? "bg-brand/15 text-brand" : "text-muted hover:text-ink"}`}>{o.label}</button>)}</div>;
}
function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return <div className="rounded-md border border-line bg-panel/60 px-2.5 py-1.5">
    <div className="stat-label">{label}</div>
    <div className="mt-0.5 text-sm font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</div></div>;
}
const sideClass = (s: Side) => (s === "T" ? "text-[#f0cd78]" : "text-[#9cc1ff]");
function RouteRow({ cluster, active, onClick }: { cluster: RouteCluster; active: boolean; onClick: () => void }) {
  const wc = winColor(cluster.winRate);
  return <button type="button" onClick={onClick}
    className={`w-full rounded-lg border px-3 py-2 text-left transition ${active ? "border-brand/50 bg-brand/5" : "border-line hover:bg-panel/50"}`}>
    <div className="flex items-center justify-between gap-2">
      <span className={`text-xs font-bold uppercase tracking-wide ${sideClass(cluster.side)}`}>{cluster.side} · {cluster.label}</span>
      <span className="rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums" style={{ color: wc, background: winColor(cluster.winRate, 0.15) }}>{Math.round(cluster.winRate * 100)}% W</span></div>
    <div className="mt-1 flex items-center gap-3 text-[10px] text-faint">
      <span>{cluster.usage} uses</span><span>{Math.round(cluster.share * 100)}% of side</span>
      <span className="text-good">{cluster.kills} K</span><span className="text-bad">{cluster.deaths} D</span><span>{cluster.avgLifetime.toFixed(1)}s</span></div></button>;
}
function PathRow({ path }: { path: PlayerPath }) {
  return <div className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-1.5">
    <div className="flex items-center gap-2"><span className={`text-xs font-bold ${sideClass(path.side)}`}>{path.side}</span>
      <span className="truncate text-xs text-ink">{path.playerName}</span></div>
    <div className="flex items-center gap-2.5 text-[10px] text-faint"><span>R{path.round}</span>
      <span className="text-good">{path.kills.length}K</span><span className={path.won ? "text-good" : "text-bad"}>{path.won ? "W" : "L"}</span>
      <span>{path.lifetime.toFixed(0)}s</span>{path.died && <span className="text-bad">✕</span>}</div></div>;
}
