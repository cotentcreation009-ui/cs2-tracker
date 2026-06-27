"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import { analyzeRoutes, type PlayerPath, type RouteCluster, type Side } from "@/lib/demo/routes";
import { radarImage } from "@/lib/maps/calibration";
import { buildProjection } from "@/lib/demo/projection";
import type { DemoView } from "@/components/demo/MatchToolbar";

const CT = "#5b9dff"; const T = "#e7b53c";
const winColor = (wr: number, alpha = 1) => `hsla(${Math.round(wr * 120)}, 70%, 55%, ${alpha})`;

interface Props { meta: ReplayMeta; rounds: ReplayRound[]; view: DemoView; }
type ViewMode = "common" | "individual";

export default function RouteAnalytics({ meta, rounds, view }: Props) {
  const [mode, setMode] = useState<ViewMode>("common");
  const [selected, setSelected] = useState<string | null>(null);
  const proj = useMemo(() => buildProjection(meta.map, rounds), [meta, rounds]);
  const calibrated = proj.calibrated;
  const analysis = useMemo(() => analyzeRoutes(meta, rounds), [meta, rounds]);

  // shared filters come from the toolbar (player/round/side carry across tabs)
  const sideFilter = view.side;
  const playerFilter: number | "all" = view.focusPlayer ?? "all";
  const roundFilter: number | "all" =
    view.scopeRound != null && view.scopeRound >= 0 && view.scopeRound < rounds.length
      ? rounds[view.scopeRound]?.n ?? "all"
      : "all";

  // drop a drilled-in cluster when the shared filters or mode change
  useEffect(() => {
    setSelected(null);
  }, [view.side, view.focusPlayer, view.scopeRound, mode]);

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

  const killMarkers = selectedCluster?.killPositions ?? [];
  const deathMarkers = selectedCluster?.deathPositions ?? [];

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

  if (!analysis.paths.length)
    return <div className="card px-5 py-6 text-sm text-muted">No movement data in this match to derive routes.</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={mode} onChange={(v) => { setMode(v); setSelected(null); }}
          options={[{ key: "common", label: "Common routes" }, { key: "individual", label: "All paths" }]} />
        <span className="text-[11px] text-faint">Player, round &amp; side filter from the toolbar above.</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
        <div className="space-y-3">
          <div className="relative aspect-square w-full max-w-160 overflow-hidden rounded-xl border border-line bg-panel2">
            {calibrated ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={radarImage(meta.map)} alt={`${meta.map} radar`}
                className="absolute inset-0 h-full w-full object-cover opacity-90" draggable={false} />
            ) : <GridBg />}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
              {drawnPaths.map(({ path, winRate, emphasis }) => {
                const d = pathD(path, pt); if (!d) return null;
                return (
                  <g key={path.key}>
                    <path d={d} fill="none" stroke={winColor(winRate, emphasis ? 0.9 : 0.4)}
                      strokeWidth={emphasis ? 0.8 : 0.32} strokeLinecap="round" strokeLinejoin="round" />
                    <StartEnd path={path} winRate={winRate} pt={pt} />
                  </g>
                );
              })}
              {killMarkers.map((k, i) => { const c = pt(k.x, k.y); if (!c) return null;
                return <g key={`k${i}`} stroke="#46d369" strokeWidth={0.5}>
                  <line x1={c.x - 1} y1={c.y - 1} x2={c.x + 1} y2={c.y + 1} />
                  <line x1={c.x + 1} y1={c.y - 1} x2={c.x - 1} y2={c.y + 1} /></g>; })}
              {deathMarkers.map((dpos, i) => { const c = pt(dpos.x, dpos.y); if (!c) return null;
                return <circle key={`d${i}`} cx={c.x} cy={c.y} r={0.9} fill="none" stroke="#f5694a" strokeWidth={0.4} />; })}
            </svg>
            {!calibrated && <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-mid/15 px-2 py-0.5 text-[10px] text-mid">{meta.map} uncalibrated — routes auto-scaled</div>}
          </div>
          {/* legend + summary stats (Stat cards) ... see file */}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            <Stat label="Paths" value={String(summary.paths)} />
            <Stat label="Win rate" value={`${Math.round(summary.winRate * 100)}%`} color={winColor(summary.winRate)} />
            <Stat label="Kills" value={String(summary.kills)} />
            <Stat label="Deaths" value={String(summary.deaths)} />
            <Stat label="Avg life" value={`${summary.avgLife.toFixed(1)}s`} />
          </div>
        </div>
        <div className="card flex max-h-160 flex-col px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="stat-label">{mode === "common" ? `${clusters.length} common routes` : `${individualPaths.length} player paths`}</span>
            {selectedCluster && <button type="button" onClick={() => setSelected(null)} className="text-[10px] text-faint hover:text-ink">✕ clear</button>}
          </div>
          <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
            {mode === "common"
              ? clusters.map((c) => <RouteRow key={c.id} cluster={c} active={c.id === selected} onClick={() => setSelected(c.id === selected ? null : c.id)} />)
              : individualPaths.slice().sort((a, b) => a.round - b.round).map((p) => <PathRow key={p.key} path={p} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

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
function StartEnd({ path, winRate, pt }: { path: PlayerPath; winRate: number; pt: PtFn }) {
  const a = path.points[0]; const b = path.points[path.points.length - 1];
  const start = pt(a.x, a.y); const end = pt(b.x, b.y);
  return <>{start && <circle cx={start.x} cy={start.y} r={0.55} fill={path.side === "T" ? T : CT} />}
    {end && <circle cx={end.x} cy={end.y} r={0.7} fill={winColor(winRate)} />}</>;
}
function GridBg() { /* dark holo grid fallback for uncalibrated maps - see file */ return null as any; }
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
