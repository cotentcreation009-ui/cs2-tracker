"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import { analyzeRoutes, type PlayerPath, type RouteCluster, type Side } from "@/lib/demo/routes";
import { radarImage } from "@/lib/maps/calibration";
import { buildProjection } from "@/lib/demo/projection";
import { loadZones, classifyPosition, type Zone } from "@/lib/maps/zones";
import { teamAStarters, roundWinnerTeam } from "@/lib/demo/score";
import { KIND_COLOR } from "@/components/demo/RadarMap";
import { weaponLabel, throwOrigin } from "@/lib/demo/insights";
import { PlayerRoundCard } from "@/components/demo/PlayerRoundCard";
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

// shared cross-highlight selection between the map and the round-detail lists.
// "duel" pinpoints a bullets-only damage exchange between two players (id =
// attacker*64+victim): the map marks their closest approach while both lived.
type Active = { kind: "util" | "kill" | "player" | "duel"; id: number } | null;
const sameActive = (a: Active, b: Active) => !!a && !!b && a.kind === b.kind && a.id === b.id;

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
  const [hover, setHover] = useState<Active>(null);
  const [pin, setPin] = useState<Active>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const active = pin ?? hover;
  const onHover = (a: Active) => setHover(a);
  const onPin = (a: Active) => setPin((cur) => (sameActive(cur, a) ? null : a));

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
    setHover(null);
    setPin(null);
  }, [view.side, view.focusPlayer, view.scopeRound, mode]);

  useEffect(() => {
    setZoom(1);
    setCenter({ x: 50, y: 50 });
  }, [view.side, view.focusPlayer, view.scopeRound]);

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
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onMove = (e: React.MouseEvent) => {
    if (!drag.current || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const span = 100 / zoom;
    const dx = ((e.clientX - drag.current.x) / rect.width) * span;
    const dy = ((e.clientY - drag.current.y) / rect.height) * span;
    if (Math.abs(e.clientX - drag.current.x) + Math.abs(e.clientY - drag.current.y) > 2) drag.current.moved = true;
    drag.current = { x: e.clientX, y: e.clientY, moved: drag.current.moved };
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

  // cluster markers (non-scoped view)
  const clusterKills = selectedCluster?.killPositions ?? [];
  const clusterDeaths = selectedCluster?.deathPositions ?? [];

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

  // Fight badges for the focused player's route: one marker per opponent they
  // traded bullet damage with this round, placed at the player's position at
  // the pair's closest approach (bullets carry no event coordinates). Pairs
  // that ended in a kill are excluded — the kill marker already shows those.
  const duelMarks = useMemo(() => {
    if (!scopedRound || typeof playerFilter !== "number") return [];
    const pf = playerFilter;
    const stats = scopedRound.stats ?? [];
    const kills = scopedRound.kills ?? [];
    const opps = new Map<number, { dealt: number; taken: number }>();
    const myStat = stats.find((s) => s.i === pf);
    for (const [vi, dm] of Object.entries(myStat?.dmgTo ?? {})) {
      if (dm > 0) opps.set(Number(vi), { dealt: dm, taken: 0 });
    }
    for (const s of stats) {
      if (s.i === pf) continue;
      const dm = s.dmgTo?.[pf] ?? 0;
      if (dm > 0) {
        const e = opps.get(s.i) ?? { dealt: 0, taken: 0 };
        e.taken = dm;
        opps.set(s.i, e);
      }
    }
    const deathT = (idx: number) => {
      const k = kills.find((kk) => kk.v === idx);
      return k ? k.t : Infinity;
    };
    const out: { o: number; x: number; y: number; t: number; dealt: number; taken: number }[] = [];
    for (const [o, v] of opps) {
      if (kills.some((k) => (k.k === pf && k.v === o) || (k.k === o && k.v === pf))) continue;
      const cutoff = Math.min(deathT(pf), deathT(o));
      let best: { d: number; x: number; y: number; t: number } | null = null;
      for (const f of scopedRound.frames ?? []) {
        if (f.t > cutoff + 0.5) break;
        const pa = f.p.find((p) => p.i === pf);
        const pv = f.p.find((p) => p.i === o);
        if (!pa || !pv) continue;
        const dd = Math.hypot(pa.x - pv.x, pa.y - pv.y);
        if (!best || dd < best.d) best = { d: dd, x: pa.x, y: pa.y, t: f.t };
      }
      if (best) out.push({ o, x: best.x, y: best.y, t: best.t, dealt: v.dealt, taken: v.taken });
    }
    return out;
  }, [scopedRound, playerFilter]);

  // running score AFTER the scoped round — counted by TEAM (ct = team that
  // started CT, t = started T), since sides swap at half.
  const score = useMemo(() => {
    if (view.scopeRound == null) return null;
    const teamA = teamAStarters(rounds);
    let ct = 0, t = 0;
    for (let i = 0; i <= view.scopeRound && i < rounds.length; i++) {
      const tm = roundWinnerTeam(rounds[i], teamA);
      if (tm === "A") ct++;
      else if (tm === "B") t++;
    }
    return { ct, t };
  }, [rounds, view.scopeRound]);

  if (!analysis.paths.length)
    return <div className="card px-5 py-6 text-sm text-muted">No movement data in this match to derive routes.</div>;

  const half = 50 / zoom;
  const cc = clampCenter(center, zoom);
  const viewBox = `${cc.x - half} ${cc.y - half} ${2 * half} ${2 * half}`;
  const s = 1 / zoom; // keep marker sizes visually constant while zoomed

  const name = (i: number) => meta.players[i]?.name ?? `P${i + 1}`;
  const sideOfIdx = (r: ReplayRound, i: number): Side =>
    r.ct?.includes(i) ? "CT" : r.t?.includes(i) ? "T" : meta.players[i]?.team === "T" ? "T" : "CT";
  const zoneOf = (x: number, y: number) => classifyPosition(meta.map, x, y, zones)?.name ?? null;

  // dim helper: when something is active, fade the unrelated
  const dim = (related: boolean) => (active && !related ? 0.18 : 1);

  // at lg+ the pane is viewport-locked: the map column is a size container and
  // the square takes the FULL pane height — the legend becomes a translucent
  // strip on the map's bottom edge and the stat tiles (non-scoped) move into
  // the routes card, so nothing below the square steals map size.
  const focused = typeof playerFilter === "number";
  const squareW = "lg:w-[min(100cqw,100cqh)]";

  // shared between the sub-lg below-the-map rows and their lg homes
  const legendItems = (
    <>
      <Legend swatch="#46d369" label="kill" shape="x" />
      <Legend swatch="#f5694a" label="death" shape="x" />
      <Legend swatch={KIND_COLOR.smoke} label="smoke" shape="b" />
      <Legend swatch={KIND_COLOR.flash} label="flash" shape="b" />
      <Legend swatch={KIND_COLOR.he} label="HE" shape="b" />
      <Legend swatch={KIND_COLOR.molotov} label="molly" shape="b" />
      {scopedRound && focused && <Legend swatch="#46d369" label="fight" shape="d" />}
      {scopedRound && <span className="ml-auto">util: ○ thrown from --→ ✸ landed · scroll to zoom</span>}
    </>
  );
  const statTiles = (
    <>
      <Stat label="Paths" value={String(summary.paths)} />
      <Stat label="Win rate" value={`${Math.round(summary.winRate * 100)}%`} color={winColor(summary.winRate)} />
      <Stat label="Kills" value={String(summary.kills)} />
      <Stat label="Deaths" value={String(summary.deaths)} />
      <Stat label="Avg life" value={`${summary.avgLife.toFixed(1)}s`} />
    </>
  );

  return (
    <div className="space-y-4 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:gap-2.5 lg:space-y-0">
      <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
        <Seg value={mode} onChange={(v) => { setMode(v); setSelected(null); }}
          options={[{ key: "common", label: "Common routes" }, { key: "individual", label: "All paths" }]} />
        <span className="text-[11px] text-faint">
          Pick a player, round &amp; side in the toolbar. Choose a round to see its full breakdown — then hover or click anything to link the map and the lists.
        </span>
      </div>

      {/* main grid: map unit | detail column(s). When a round AND a player are
          both scoped the two right-hand cards get a column each — the pane is
          wide, so going horizontal beats stacking them into one tall rail. */}
      <div
        className={`grid gap-4 lg:min-h-0 lg:flex-1 lg:items-stretch lg:gap-3 ${
          scopedRound && focused
            ? "lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.8fr)_minmax(320px,0.9fr)]"
            : "lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,1fr)]"
        }`}
      >
        {/* map unit: size container — square map + legend (+ stats) share one
            width so they stay aligned while the square is height-driven */}
        <div className="space-y-3 lg:flex lg:h-full lg:min-h-0 lg:min-w-0 lg:flex-col lg:items-center lg:justify-center lg:gap-2 lg:space-y-0 lg:@container-size">
          <div
            ref={wrapRef}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={() => { onUp(); }}
            className={`relative aspect-square w-full max-w-240 overflow-hidden rounded-xl border border-line bg-panel2 lg:max-w-none lg:shrink-0 ${squareW} ${
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

              {/* call-out zones are drawn only in the Zones tab; here their
                  names still label positions/throws via classifyPosition */}

              {/* routes */}
              {drawnPaths.map(({ path, winRate, emphasis }) => {
                const d = pathD(path, pt); if (!d) return null;
                const related = !active || (active.kind === "player" && path.playerIndex === active.id);
                return (
                  <g key={path.key} opacity={dim(related)}>
                    <path d={d} fill="none" stroke={winColor(winRate, emphasis ? 0.9 : 0.4)}
                      strokeWidth={(emphasis ? 0.8 : 0.32) * s} strokeLinecap="round" strokeLinejoin="round" />
                    <StartEnd path={path} winRate={winRate} pt={pt} scale={s} />
                  </g>
                );
              })}

              {/* damage-taken reveal: hovering an attacker in the round card
                  highlights THEIR route for this round, even though the map is
                  scoped to the selected player (bullet damage has no coords —
                  the attacker's path is the "where it came from") */}
              {scopedRound &&
                typeof playerFilter === "number" &&
                active?.kind === "player" &&
                active.id !== playerFilter &&
                (() => {
                  const p = analysis.paths.find(
                    (pp) => pp.round === scopedRound.n && pp.playerIndex === active.id,
                  );
                  if (!p) return null;
                  const dd = pathD(p, pt);
                  if (!dd) return null;
                  return (
                    <g>
                      <path
                        d={dd}
                        fill="none"
                        stroke={sideHex(p.side)}
                        strokeWidth={0.8 * s}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={0.95}
                      />
                      <StartEnd path={p} winRate={p.won ? 1 : 0} pt={pt} scale={s} />
                    </g>
                  );
                })()}

              {scopedRound ? (
                <>
                  {/* util: origin → landing, interactive */}
                  {(scopedRound.nades ?? []).map((n, i) => {
                    // when a player is selected: their own util, PLUS any enemy
                    // grenade that damaged them (a damage-taken source, so the
                    // card's hover can point at it)
                    if (
                      playerFilter !== "all" &&
                      n.by !== playerFilter &&
                      (n.dmg?.[playerFilter] ?? 0) <= 0
                    )
                      return null;
                    const c = pt(n.x, n.y); if (!c) return null;
                    const col = KIND_COLOR[n.k] ?? "#8a7dff";
                    const o = throwOrigin(scopedRound, n);
                    const oc = o ? pt(o.x, o.y) : null;
                    const related = !active
                      ? true
                      : active.kind === "util"
                        ? active.id === i
                        : active.kind === "player"
                          ? n.by === active.id
                          : false;
                    const on = sameActive(active, { kind: "util", id: i });
                    const z = zoneOf(n.x, n.y);
                    return (
                      <g
                        key={`n${i}`}
                        opacity={dim(related)}
                        style={{ cursor: "pointer" }}
                        onMouseEnter={() => onHover({ kind: "util", id: i })}
                        onMouseLeave={() => onHover(null)}
                        onClick={(e) => { e.stopPropagation(); if (!drag.current?.moved) onPin({ kind: "util", id: i }); }}
                      >
                        <title>{`${n.k}${n.by >= 0 ? ` · ${name(n.by)}` : ""} · ${mmss(n.t)}${z ? ` · ${z}` : ""}`}</title>
                        {oc && <line x1={oc.x} y1={oc.y} x2={c.x} y2={c.y} stroke={col} strokeWidth={(on ? 0.7 : 0.4) * s} strokeDasharray={`${1.4 * s} ${1 * s}`} opacity={on ? 1 : 0.6} />}
                        {/* thrown-from = hollow ring (empty spot the nade left) */}
                        {oc && <circle cx={oc.x} cy={oc.y} r={0.85 * s} fill="none" stroke={col} strokeWidth={0.4 * s} opacity={0.9} />}
                        {/* landing = detonation burst: filled dot + four rays */}
                        {(() => {
                          const r = (on ? 1.5 : 1) * s;
                          const ray = r + 0.9 * s;
                          return (
                            <g>
                              <g stroke={col} strokeWidth={0.35 * s} strokeLinecap="round" opacity={0.95}>
                                <line x1={c.x - ray} y1={c.y} x2={c.x - r} y2={c.y} />
                                <line x1={c.x + r} y1={c.y} x2={c.x + ray} y2={c.y} />
                                <line x1={c.x} y1={c.y - ray} x2={c.x} y2={c.y - r} />
                                <line x1={c.x} y1={c.y + r} x2={c.x} y2={c.y + ray} />
                              </g>
                              <circle cx={c.x} cy={c.y} r={r} fill={`${col}dd`} stroke="#04060e" strokeWidth={0.25 * s} />
                            </g>
                          );
                        })()}
                        <circle cx={c.x} cy={c.y} r={2.6 * s} fill="transparent" pointerEvents="all" />
                      </g>
                    );
                  })}

                  {/* fight badges: where the focused player traded bullet
                      damage (no kill) — diamond on THEIR route at the pair's
                      closest approach; green = came out ahead, red = behind.
                      Hover/click links to the card's damage rows (duel refs). */}
                  {typeof playerFilter === "number" &&
                    duelMarks.map((m) => {
                      const c = pt(m.x, m.y);
                      if (!c) return null;
                      const idDealt = playerFilter * 64 + m.o;
                      const idTaken = m.o * 64 + playerFilter;
                      const related = !active
                        ? true
                        : active.kind === "duel"
                          ? active.id === idDealt || active.id === idTaken
                          : active.kind === "player"
                            ? active.id === playerFilter || active.id === m.o
                            : false;
                      const on =
                        active?.kind === "duel" && (active.id === idDealt || active.id === idTaken);
                      const hoverId = m.dealt > 0 ? idDealt : idTaken;
                      // size encodes fight intensity (total damage traded);
                      // split fill = a real exchange (green dealt / red taken),
                      // solid = one-way damage. Amounts live in the styled
                      // tooltip overlay (rendered outside the svg).
                      const rr = (0.95 + 0.6 * Math.min(1, (m.dealt + m.taken) / 150)) * (on ? 1.3 : 1) * s;
                      const top = `${c.x},${c.y - rr}`;
                      const rt = `${c.x + rr},${c.y}`;
                      const bot = `${c.x},${c.y + rr}`;
                      const lt = `${c.x - rr},${c.y}`;
                      const split = m.dealt > 0 && m.taken > 0;
                      return (
                        <g
                          key={`dm${m.o}`}
                          opacity={dim(related)}
                          style={{ cursor: "pointer" }}
                          onMouseEnter={() => onHover({ kind: "duel", id: hoverId })}
                          onMouseLeave={() => onHover(null)}
                          onClick={(e) => { e.stopPropagation(); if (!drag.current?.moved) onPin({ kind: "duel", id: hoverId }); }}
                        >
                          {split ? (
                            <>
                              <polygon points={`${top} ${lt} ${bot}`} fill="#f5694a" />
                              <polygon points={`${top} ${rt} ${bot}`} fill="#46d369" />
                            </>
                          ) : (
                            <polygon points={`${top} ${rt} ${bot} ${lt}`} fill={m.dealt > 0 ? "#46d369" : "#f5694a"} />
                          )}
                          <polygon points={`${top} ${rt} ${bot} ${lt}`} fill="none" stroke="#04060e" strokeWidth={0.3 * s} />
                          <circle cx={c.x} cy={c.y} r={2.6 * s} fill="transparent" pointerEvents="all" />
                        </g>
                      );
                    })}

                  {/* kills: killer X + victim ring, interactive */}
                  {(scopedRound.kills ?? []).map((k, i) => {
                    if (k.k < 0) return null;
                    // when a player is selected, only their own engagements (their
                    // kills + their death) — not where other people were fighting
                    if (playerFilter !== "all" && k.k !== playerFilter && k.v !== playerFilter) return null;
                    const kc = pt(k.kx, k.ky);
                    const vc = pt(k.vx, k.vy); if (!vc) return null;
                    const related = !active
                      ? true
                      : active.kind === "kill"
                        ? active.id === i
                        : active.kind === "player"
                          ? k.k === active.id || k.v === active.id
                          : false;
                    const on = sameActive(active, { kind: "kill", id: i });
                    return (
                      <g
                        key={`k${i}`}
                        opacity={dim(related)}
                        style={{ cursor: "pointer" }}
                        onMouseEnter={() => onHover({ kind: "kill", id: i })}
                        onMouseLeave={() => onHover(null)}
                        onClick={(e) => { e.stopPropagation(); if (!drag.current?.moved) onPin({ kind: "kill", id: i }); }}
                      >
                        <title>{`${name(k.k)} ${weaponLabel(k.w)}${k.hs ? " (hs)" : ""} → ${name(k.v)} · ${mmss(k.t)}${k.rct ? ` · ${k.rct}ms react` : ""}`}</title>
                        {kc && on && <line x1={kc.x} y1={kc.y} x2={vc.x} y2={vc.y} stroke="#f5694a" strokeWidth={0.4 * s} opacity={0.8} />}
                        {kc && <g stroke="#46d369" strokeWidth={0.5 * s}>
                          <line x1={kc.x - (on ? 1.4 : 1) * s} y1={kc.y - (on ? 1.4 : 1) * s} x2={kc.x + (on ? 1.4 : 1) * s} y2={kc.y + (on ? 1.4 : 1) * s} />
                          <line x1={kc.x + (on ? 1.4 : 1) * s} y1={kc.y - (on ? 1.4 : 1) * s} x2={kc.x - (on ? 1.4 : 1) * s} y2={kc.y + (on ? 1.4 : 1) * s} />
                        </g>}
                        {/* victim spot = red ✕ (same convention as the Weapons map) */}
                        {(() => {
                          const r = (on ? 1.3 : 0.9) * s;
                          return (
                            <g stroke="#f5694a" strokeWidth={0.45 * s} strokeLinecap="round">
                              <line x1={vc.x - r} y1={vc.y - r} x2={vc.x + r} y2={vc.y + r} />
                              <line x1={vc.x + r} y1={vc.y - r} x2={vc.x - r} y2={vc.y + r} />
                            </g>
                          );
                        })()}
                        <circle cx={vc.x} cy={vc.y} r={2.4 * s} fill="transparent" pointerEvents="all" />
                        {on && (
                          <g fontSize={2.9 * s} fontWeight="bold" textAnchor="middle" style={{ paintOrder: "stroke" }} stroke="#04060e" strokeWidth={0.8 * s} strokeLinejoin="round">
                            {kc && (
                              <text x={kc.x} y={kc.y - 2.4 * s} fill={sideHex(sideOfIdx(scopedRound, k.k))}>
                                {name(k.k)}
                              </text>
                            )}
                            <text x={vc.x} y={vc.y + 4.2 * s} fill="#f5694a">
                              ☠ {name(k.v)}
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  })}

                  {/* duel spot: a bullets-only damage exchange has no event
                      coordinates, so mark the two players at their CLOSEST
                      APPROACH while both were alive — where the fight happened */}
                  {active?.kind === "duel" &&
                    (() => {
                      const a = Math.floor(active.id / 64);
                      const v = active.id % 64;
                      const deathT = (idx: number) => {
                        const k = (scopedRound.kills ?? []).find((kk) => kk.v === idx);
                        return k ? k.t : Infinity;
                      };
                      const cutoff = Math.min(deathT(a), deathT(v));
                      let best: { d: number; ax: number; ay: number; vx: number; vy: number; t: number } | null = null;
                      for (const f of scopedRound.frames ?? []) {
                        if (f.t > cutoff + 0.5) break;
                        const pa = f.p.find((p) => p.i === a);
                        const pv = f.p.find((p) => p.i === v);
                        if (!pa || !pv) continue;
                        const dd = Math.hypot(pa.x - pv.x, pa.y - pv.y);
                        if (!best || dd < best.d) best = { d: dd, ax: pa.x, ay: pa.y, vx: pv.x, vy: pv.y, t: f.t };
                      }
                      if (!best) return null;
                      const ca = pt(best.ax, best.ay);
                      const cv = pt(best.vx, best.vy);
                      if (!ca || !cv) return null;
                      const aHex = sideHex(sideOfIdx(scopedRound, a));
                      const vHex = sideHex(sideOfIdx(scopedRound, v));
                      return (
                        <g>
                          <line x1={ca.x} y1={ca.y} x2={cv.x} y2={cv.y} stroke="#f5b942" strokeWidth={0.45 * s} strokeDasharray={`${1.2 * s} ${0.9 * s}`} opacity={0.9} />
                          <circle cx={ca.x} cy={ca.y} r={1.2 * s} fill={aHex} stroke="#04060e" strokeWidth={0.3 * s} />
                          <circle cx={cv.x} cy={cv.y} r={1.2 * s} fill={vHex} stroke="#04060e" strokeWidth={0.3 * s} />
                          <g fontSize={2.9 * s} fontWeight="bold" textAnchor="middle" style={{ paintOrder: "stroke" }} stroke="#04060e" strokeWidth={0.8 * s} strokeLinejoin="round">
                            <text x={ca.x} y={ca.y - 2.2 * s} fill={aHex}>{name(a)}</text>
                            <text x={cv.x} y={cv.y + 4 * s} fill={vHex}>{name(v)}</text>
                            <text x={(ca.x + cv.x) / 2} y={(ca.y + cv.y) / 2 - 1.6 * s} fill="#f5b942" fontSize={2.3 * s}>
                              ~{mmss(best.t)}
                            </text>
                          </g>
                        </g>
                      );
                    })()}

                  {/* bomb plant */}
                  {(scopedRound.bomb ?? []).filter((b) => b.k === "plant").map((b, i) => {
                    const c = pt(b.x, b.y); if (!c) return null;
                    return <g key={`b${i}`}><circle cx={c.x} cy={c.y} r={1.4 * s} fill="#f5694a" /><text x={c.x} y={c.y - 2 * s} fill="#fff" fontSize={2.6 * s} textAnchor="middle" fontWeight="bold">C4</text></g>;
                  })}
                </>
              ) : (
                <>
                  {/* cluster kills/deaths (aggregate view) */}
                  {clusterKills.map((k, i) => { const c = pt(k.x, k.y); if (!c) return null;
                    return <g key={`ck${i}`} stroke="#46d369" strokeWidth={0.5 * s}>
                      <line x1={c.x - s} y1={c.y - s} x2={c.x + s} y2={c.y + s} />
                      <line x1={c.x + s} y1={c.y - s} x2={c.x - s} y2={c.y + s} /></g>; })}
                  {clusterDeaths.map((dp, i) => { const c = pt(dp.x, dp.y); if (!c) return null;
                    return <g key={`cd${i}`} stroke="#f5694a" strokeWidth={0.45 * s} strokeLinecap="round">
                      <line x1={c.x - 0.9 * s} y1={c.y - 0.9 * s} x2={c.x + 0.9 * s} y2={c.y + 0.9 * s} />
                      <line x1={c.x + 0.9 * s} y1={c.y - 0.9 * s} x2={c.x - 0.9 * s} y2={c.y + 0.9 * s} /></g>; })}
                </>
              )}
            </svg>

            {/* fight tooltip — a styled overlay above the active fight badge
                (native <title> is slow and plain). Shows for badge hover AND
                the card's fight-row hover, since both drive the same duel ref. */}
            {active?.kind === "duel" &&
              typeof playerFilter === "number" &&
              (() => {
                const a = Math.floor(active.id / 64);
                const v = active.id % 64;
                const m = duelMarks.find(
                  (mm) => (a === playerFilter && mm.o === v) || (v === playerFilter && mm.o === a),
                );
                if (!m) return null;
                const c = pt(m.x, m.y);
                if (!c) return null;
                const lx = ((c.x - (cc.x - half)) / (2 * half)) * 100;
                const ly = ((c.y - (cc.y - half)) / (2 * half)) * 100;
                if (lx < 2 || lx > 98 || ly < 4 || ly > 100) return null;
                return (
                  <div
                    className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-line2 bg-bg/90 px-2.5 py-1 text-[11px] leading-snug shadow-xl backdrop-blur"
                    style={{ left: `${lx}%`, top: `calc(${ly}% - 8px)` }}
                  >
                    <span className="font-bold text-ink">⚔ {name(m.o)}</span>
                    {m.dealt > 0 && <span className="ml-1.5 font-semibold text-good">+{m.dealt}</span>}
                    {m.taken > 0 && <span className="ml-1 font-semibold text-bad">−{m.taken}</span>}
                    <span className="ml-1.5 text-faint">~{mmss(m.t)}</span>
                  </div>
                );
              })()}

            {/* zoom controls */}
            <div className="absolute right-2 top-2 flex flex-col gap-1">
              <button type="button" onClick={() => setZoom((z) => clamp(+(z * 1.4).toFixed(3), 1, 6))} title="Zoom in" className="grid h-7 w-7 place-items-center rounded-md border border-line bg-bg/80 text-sm font-bold backdrop-blur hover:text-brand">+</button>
              <button type="button" onClick={() => setZoom((z) => clamp(+(z / 1.4).toFixed(3), 1, 6))} title="Zoom out" className="grid h-7 w-7 place-items-center rounded-md border border-line bg-bg/80 text-sm font-bold backdrop-blur hover:text-brand">−</button>
              {zoom > 1 && (
                <button type="button" onClick={resetView} title="Reset zoom" className="grid h-7 w-7 place-items-center rounded-md border border-line bg-bg/80 text-[10px] backdrop-blur hover:text-brand">⤢</button>
              )}
            </div>
            {(zoom > 1 || pin) && (
              <div className="pointer-events-none absolute left-2 top-2 rounded-full bg-bg/70 px-2 py-0.5 text-[10px] text-muted backdrop-blur">
                {zoom > 1 ? `${zoom.toFixed(1)}× · drag to pan` : ""}{zoom > 1 && pin ? " · " : ""}{pin ? "pinned — click again to clear" : ""}
              </div>
            )}
            {scopedRound && (() => {
              if (playerFilter !== "all") {
                const pf = playerFilter;
                const involved =
                  (scopedRound.kills ?? []).some((k) => k.k >= 0 && (k.k === pf || k.v === pf)) ||
                  (scopedRound.nades ?? []).some((n) => n.by === pf) ||
                  duelMarks.length > 0;
                return involved ? null : (
                  <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-bg/70 px-3 py-1 text-xs text-muted backdrop-blur">
                    No kills, damage or utility for {name(pf)} this round
                  </div>
                );
              }
              return (scopedRound.kills ?? []).filter((k) => k.k >= 0).length === 0 ? (
                <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-bg/70 px-3 py-1 text-xs text-muted backdrop-blur">
                  Round {scopedRound.n} — no eliminations
                </div>
              ) : null;
            })()}
            {!calibrated && <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-mid/15 px-2 py-0.5 text-[10px] text-mid lg:bottom-auto lg:top-3">{meta.map} uncalibrated — auto-scaled</div>}

            {/* legend — at lg+ a translucent strip on the map's bottom edge,
                so the square keeps the full pane height */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-line/50 bg-bg/75 px-3 py-1.5 text-[10px] text-faint backdrop-blur lg:flex">
              {legendItems}
            </div>
          </div>

          {/* legend + stats (sub-lg, below the map — at lg they live in the
              map overlay / the routes card instead) */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[10px] text-faint lg:hidden">
            {legendItems}
          </div>

          {!scopedRound && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:hidden">
              {statTiles}
            </div>
          )}
        </div>

        {/* right panel — lg:contents promotes the player card and the round
            detail to their own grid columns at lg; below lg they stack as
            before */}
        {scopedRound ? (
          <div className="space-y-3 lg:contents lg:space-y-0">
            {typeof playerFilter === "number" && (
              <div className="scroll-slim lg:h-full lg:min-h-0 lg:overflow-y-auto">
                <PlayerRoundCard
                  round={scopedRound}
                  meta={meta}
                  i={playerFilter}
                  rounds={rounds}
                  onClose={() => view.setFocusPlayer(null)}
                  onUtilHover={(id) => onHover(id == null ? null : { kind: "util", id })}
                  onUtilPin={(id) => onPin({ kind: "util", id })}
                  activeUtilId={active?.kind === "util" ? active.id : null}
                  onRefHover={(r) => onHover(r)}
                  onRefPin={(r) => onPin(r)}
                  activeRef={active}
                  zoneOf={zoneOf}
                />
              </div>
            )}
            <RoundDetail
              meta={meta}
              round={scopedRound}
              score={score}
              active={active}
              focus={typeof playerFilter === "number" ? playerFilter : null}
              onHover={onHover}
              onPin={onPin}
              name={name}
              sideOfIdx={(i) => sideOfIdx(scopedRound, i)}
              zoneOf={zoneOf}
            />
          </div>
        ) : (
          <div className="card flex max-h-240 flex-col px-4 py-3 lg:h-full lg:max-h-none lg:min-h-0">
            {/* lg: the match-summary tiles move here from under the map
                (3-up until xl so the labels don't wrap in a narrow column) */}
            <div className="mb-2.5 hidden gap-2 lg:grid lg:shrink-0 lg:grid-cols-3 xl:grid-cols-5">
              {statTiles}
            </div>
            <div className="mb-2 flex items-center justify-between lg:shrink-0">
              <span className="stat-label">{mode === "common" ? `${clusters.length} common routes` : `${individualPaths.length} player paths`}</span>
              {selectedCluster && <button type="button" onClick={() => setSelected(null)} className="text-[10px] text-faint hover:text-ink">✕ clear</button>}
            </div>
            <div className="scroll-slim flex-1 space-y-1.5 overflow-y-auto pr-1">
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
  score,
  active,
  focus,
  onHover,
  onPin,
  name,
  sideOfIdx,
  zoneOf,
}: {
  meta: ReplayMeta;
  round: ReplayRound;
  score: { ct: number; t: number } | null;
  active: Active;
  focus: number | null;
  onHover: (a: Active) => void;
  onPin: (a: Active) => void;
  name: (i: number) => string;
  sideOfIdx: (i: number) => Side;
  zoneOf: (x: number, y: number) => string | null;
}) {
  const winHex = round.winner === "T" ? T : round.winner === "CT" ? CT : "#8a7dff";

  // keep original indices so hover/pin line up with the map markers. When a
  // player is selected, the util + kill feeds show only their own actions.
  const nadesAll = (round.nades ?? []).map((n, i) => ({ n, i })).sort((a, b) => a.n.t - b.n.t);
  const killsAll = (round.kills ?? []).map((k, i) => ({ k, i })).sort((a, b) => a.k.t - b.k.t);
  const nades = focus != null ? nadesAll.filter((x) => x.n.by === focus) : nadesAll;
  const killsReal =
    focus != null
      ? killsAll.filter((x) => x.k.k >= 0 && (x.k.k === focus || x.k.v === focus))
      : killsAll.filter((x) => x.k.k >= 0);

  const status = (i: number) => {
    const death = (round.kills ?? []).find((k) => k.v === i);
    const ks = (round.kills ?? []).filter((k) => k.k === i && k.k >= 0).length;
    return { died: !!death, deathT: death?.t ?? null, kills: ks };
  };
  const roster = (ids: number[] | undefined, side: Side) =>
    (ids ?? []).map((i) => ({ i, side, ...status(i) }));
  const ct = roster(round.ct, "CT");
  const t = roster(round.t, "T");

  // shared row interaction props
  const rowProps = (a: Active, on: boolean) => ({
    onMouseEnter: () => onHover(a),
    onMouseLeave: () => onHover(null),
    onClick: () => onPin(a),
    "aria-pressed": on,
    className: `flex w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left transition ${
      on ? "bg-brand/15 ring-1 ring-brand/40" : "hover:bg-panel/60"
    }`,
  });

  return (
    <div className="card flex max-h-240 flex-col overflow-hidden p-0 lg:h-full lg:max-h-none lg:min-h-0">
      <div
        className="flex items-center justify-between gap-2 px-4 py-3 lg:shrink-0"
        style={{ background: `linear-gradient(90deg, ${winHex}26, transparent)` }}
      >
        <div>
          <div className="text-xs text-muted">Round {round.n}</div>
          <div className="text-lg font-extrabold" style={{ color: winHex }}>
            {round.winner ? `${round.winner} win` : "—"}
          </div>
          <div className="text-xs text-muted">{reasonLabel(round.reason, round.winner)}</div>
          {focus != null && (
            <div className="mt-0.5 text-[11px] font-semibold text-brand">Showing {name(focus)} only</div>
          )}
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

      <div className="scroll-slim flex-1 space-y-3 overflow-y-auto px-4 py-3">
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
                {col.list.map((p) => {
                  const on = sameActive(active, { kind: "player", id: p.i });
                  return (
                    <button key={p.i} type="button" {...rowProps({ kind: "player", id: p.i }, on)}>
                      <span className="w-3 text-center text-xs">{p.died ? <span className="text-bad">✕</span> : <span className="text-good">✓</span>}</span>
                      <span className={`truncate text-xs ${p.i === focus ? "font-bold text-brand" : p.died ? "text-muted" : "text-ink"}`}>{name(p.i)}</span>
                      {p.kills > 0 && <span className="ml-auto shrink-0 text-[11px] text-faint">{p.kills}K</span>}
                      {p.died && p.deathT != null && (
                        <span className={`shrink-0 text-[11px] tabular-nums text-faint ${p.kills > 0 ? "ml-1.5" : "ml-auto"}`}>{mmss(p.deathT)}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* util timeline — hidden when a player is focused (it's in their card above) */}
        {focus == null && (
          <div>
            <div className="stat-label mb-1.5">Utility ({nades.length})</div>
            {nades.length === 0 ? (
              <div className="text-[11px] text-faint">No utility this round.</div>
            ) : (
              <div className="space-y-0.5">
                {nades.map(({ n, i }) => {
                  const zone = zoneOf(n.x, n.y);
                  const on = sameActive(active, { kind: "util", id: i });
                  return (
                    <button key={i} type="button" {...rowProps({ kind: "util", id: i }, on)}>
                      <span className="w-8 shrink-0 text-[11px] tabular-nums text-faint">{mmss(n.t)}</span>
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_COLOR[n.k] ?? "#8a7dff" }} />
                      <span className="text-[11px] capitalize text-muted">{n.k}</span>
                      {n.by >= 0 && <span className="text-[11px] text-faint">· {name(n.by)}</span>}
                      {zone && <span className="ml-auto truncate text-[11px] text-faint">{zone}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* kill feed */}
        <div>
          <div className="stat-label mb-1.5">Kills ({killsReal.length})</div>
          {killsReal.length === 0 ? (
            <div className="text-[11px] text-faint">No kills this round.</div>
          ) : (
            <div className="space-y-0.5">
              {killsReal.map(({ k, i }) => {
                const on = sameActive(active, { kind: "kill", id: i });
                return (
                  <button key={i} type="button" {...rowProps({ kind: "kill", id: i }, on)}>
                    <span className="w-8 shrink-0 text-[11px] tabular-nums text-faint">{mmss(k.t)}</span>
                    <span className="max-w-26 truncate text-[11px] font-semibold" style={{ color: sideHex(sideOfIdx(k.k)) }}>{name(k.k)}</span>
                    <span className="shrink-0 text-[10px] text-faint">{weaponLabel(k.w)}{k.hs ? " ⌖" : ""}</span>
                    {k.rct != null && k.rct > 0 && (
                      <span
                        className="shrink-0 rounded-full bg-panel px-1.5 text-[9px] font-semibold tabular-nums text-muted"
                        title={`Reaction on this kill: ${k.rct}ms from ${name(k.v)} becoming visible to the kill`}
                      >
                        {k.rct}ms
                      </span>
                    )}
                    <span className="shrink-0 text-faint">▸</span>
                    <span className="ml-auto max-w-26 truncate text-[11px] font-medium" style={{ color: sideHex(sideOfIdx(k.v)) }}>{name(k.v)}</span>
                  </button>
                );
              })}
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
function Legend({ swatch, label, shape }: { swatch: string; label: string; shape?: "x" | "o" | "d" | "b" }) {
  return (
    <span className="flex items-center gap-1">
      {shape === "x" ? (
        <span style={{ color: swatch }} className="font-bold">✕</span>
      ) : shape === "o" ? (
        <span style={{ color: swatch }}>◯</span>
      ) : shape === "d" ? (
        <span className="h-2 w-2 rotate-45" style={{ background: swatch }} />
      ) : shape === "b" ? (
        // "burst" — the landed-grenade detonation glyph
        <span style={{ color: swatch }} className="font-bold leading-none">✸</span>
      ) : (
        <span className="h-2 w-2 rounded-full" style={{ background: swatch }} />
      )}
      {label}
    </span>
  );
}
function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { key: T; label: string }[] }) {
  return <div className="flex rounded-lg border border-line bg-panel p-0.5">{options.map((o) =>
    <button key={o.key} type="button" onClick={() => onChange(o.key)} aria-pressed={value === o.key}
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
  return <button type="button" onClick={onClick} aria-pressed={active}
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
