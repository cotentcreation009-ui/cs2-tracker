"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import {
  computeInsights,
  clusterUtilThrows,
  weaponLabel,
  PLAYER_INSIGHTS_LIMITATIONS,
  type PlayerInsight,
  type UtilThrow,
} from "@/lib/demo/insights";
import { buildProjection } from "@/lib/demo/projection";
import { loadZones, classifyPosition, type Zone } from "@/lib/maps/zones";
import { KIND_COLOR, KIND_LABEL } from "@/components/demo/RadarMap";
import { UtilThrowMap } from "@/components/demo/UtilThrowMap";
import { demoCheat, BAND_HEX, BAND_LABEL } from "@/lib/demo/cheat";
import { AccountCheck } from "@/components/demo/AccountCheck";
import type { DemoView } from "@/components/demo/MatchToolbar";

const UTIL_KINDS = ["smoke", "flash", "he", "molotov", "decoy"] as const;
type Timing = "early" | "mid" | "late";

const CT = "#5b9dff";
const T = "#e7b53c";
const sideHex = (t: PlayerInsight["team"]) => (t === "T" ? T : CT);
const mmss = (t: number) =>
  `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-panel/50 px-2.5 py-2">
      <div className="stat-label">{label}</div>
      <div className="mt-0.5 text-base font-bold tabular-nums text-ink">{value}</div>
      {sub && <div className="text-[10px] text-faint">{sub}</div>}
    </div>
  );
}

function SplitBar({ a, b, aHex, bHex }: { a: number; b: number; aHex: string; bHex: string }) {
  const total = a + b || 1;
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-panel">
      <div style={{ width: `${(a / total) * 100}%`, background: aHex }} />
      <div style={{ width: `${(b / total) * 100}%`, background: bHex }} />
    </div>
  );
}

const TIMING_STYLE: Record<Timing, { label: string; cls: string }> = {
  early: { label: "early", cls: "bg-good/15 text-good" },
  mid: { label: "mid-round", cls: "bg-mid/15 text-mid" },
  late: { label: "late", cls: "bg-bad/15 text-bad" },
};
function TimingBadge({ timing }: { timing: Timing }) {
  const m = TIMING_STYLE[timing];
  return <span className={`pill ${m.cls}`}>{m.label}</span>;
}

// Clickable utility chip on a player card — focuses the player + selects a kind.
function UtilPill({
  kind,
  n,
  label,
  active,
  onClick,
}: {
  kind: string;
  n: number;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Break down ${label} on the map`}
      className={`pill transition ${
        active
          ? "bg-brand/20 text-brand ring-1 ring-brand/40"
          : "bg-panel text-muted hover:bg-panel2 hover:text-ink"
      }`}
    >
      <span
        className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
        style={{ background: KIND_COLOR[kind] }}
      />
      {n} {label}
    </button>
  );
}

interface SideLean { a: number; b: number; mid: number; n: number }
interface PlayerSiteLean { ct: SideLean; t: SideLean }

function leanLabel(l: SideLean): string {
  const tot = l.a + l.b + l.mid || 1;
  const a = l.a / tot;
  const b = l.b / tot;
  if (a >= 0.55) return "A-heavy";
  if (b >= 0.55) return "B-heavy";
  if (Math.abs(a - b) < 0.12) return "flexible";
  return a > b ? "A lean" : "B lean";
}
function LeanRow({ side, l }: { side: "CT" | "T"; l: SideLean }) {
  const tot = l.a + l.b + l.mid || 1;
  const aw = (l.a / tot) * 100;
  const mw = (l.mid / tot) * 100;
  const bw = (l.b / tot) * 100;
  return (
    <div>
      <div className="flex justify-between text-[10px]">
        <span className="font-semibold" style={{ color: side === "T" ? T : CT }}>{side}</span>
        <span className="text-faint">
          {leanLabel(l)} · A {Math.round(aw)} · Mid {Math.round(mw)} · B {Math.round(bw)}
        </span>
      </div>
      <div className="mt-0.5 flex h-1.5 overflow-hidden rounded-full bg-panel">
        <div style={{ width: `${aw}%`, background: "#f5694a" }} />
        <div style={{ width: `${mw}%`, background: "#f5b942" }} />
        <div style={{ width: `${bw}%`, background: "#5b9dff" }} />
      </div>
    </div>
  );
}

function PlayerCard({
  p,
  focused,
  activeKind,
  lean,
  onFocus,
  onUtil,
}: {
  p: PlayerInsight;
  focused: boolean;
  activeKind: string | null;
  lean?: PlayerSiteLean;
  onFocus: () => void;
  onUtil: (player: PlayerInsight, kind: string) => void;
}) {
  const hex = sideHex(p.team);
  const mk = p.multiKills;
  const area = p.area;
  const areaTotal = area.a + area.b + area.mid || 1;
  const cheat = demoCheat(p);
  return (
    <div
      className={`card lift relative overflow-hidden py-3 pl-3 pr-4 transition ${
        focused ? "ring-1 ring-brand/50" : ""
      }`}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: hex }} />
      <button
        type="button"
        onClick={onFocus}
        className="flex w-full items-center justify-between gap-2 text-left"
        title="Focus this player across all tabs"
      >
        <span className="truncate font-bold">{p.name}</span>
        <span className="pill shrink-0" style={{ background: `${hex}22`, color: hex }}>
          {p.team || "—"}
        </span>
      </button>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-extrabold tabular-nums" style={{ color: hex }}>
          {p.kills}
        </span>
        <span className="text-sm text-faint">/ {p.deaths}</span>
        <span className="text-xs text-muted">
          {p.kd.toFixed(2)} K/D · {p.kpr.toFixed(2)} KPR
        </span>
      </div>

      <div
        className="mt-2"
        title={`CheatMeter — single-match anomaly, not proof. Top: ${cheat.factors
          .slice(0, 3)
          .map((f) => `${f.label} ${f.display}`)
          .join(" · ")}`}
      >
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted">
            CheatMeter <span className="text-faint">· this match</span>
          </span>
          <span className="font-bold tabular-nums" style={{ color: BAND_HEX[cheat.band] }}>
            {cheat.score.toFixed(0)}% {BAND_LABEL[cheat.band]}
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel">
          <div
            className="h-full rounded-full"
            style={{ width: `${cheat.score}%`, background: BAND_HEX[cheat.band] }}
          />
        </div>
      </div>

      <div className="mt-2 grid grid-cols-4 gap-1.5">
        <Stat label="ADR" value={p.adr.toFixed(0)} />
        <Stat label="HS%" value={`${p.hsPct.toFixed(0)}%`} />
        <Stat label="Trade K" value={`${p.tradeKills}`} sub={`${p.tradeKillPct.toFixed(0)}%`} />
        <Stat label="Multi-K" value={`${p.multiKillRounds}`} sub="rounds" />
      </div>

      <div className="mt-2.5">
        <div className="flex justify-between text-[11px] text-muted">
          <span>Opening duels</span>
          <span className="tabular-nums">
            {p.openingKills}–{p.openingDeaths} · {p.openingWinPct.toFixed(0)}%
          </span>
        </div>
        <div className="mt-1">
          <SplitBar a={p.openingKills} b={p.openingDeaths} aHex="#46d369" bHex="#f5694a" />
        </div>
      </div>

      {(mk.k3 + mk.k4 + mk.k5 > 0 || mk.k2 > 0) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {mk.k2 > 0 && <span className="pill bg-panel text-muted">{mk.k2}× 2K</span>}
          {mk.k3 > 0 && <span className="pill bg-panel text-mid">{mk.k3}× 3K</span>}
          {mk.k4 > 0 && <span className="pill bg-brand/15 text-brand">{mk.k4}× 4K</span>}
          {mk.k5 > 0 && <span className="pill bg-bad/15 text-bad">{mk.k5}× ACE</span>}
        </div>
      )}

      {p.favoriteWeapons.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {p.favoriteWeapons.map((w) => (
            <span key={w.weapon} className="pill bg-panel2 text-faint">
              {weaponLabel(w.weapon)} <span className="text-muted">{w.kills}</span>
            </span>
          ))}
        </div>
      )}

      {(p.utilThrown.total > 0 || p.utilDamage > 0 || p.enemiesFlashed > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px]">
          {p.utilThrown.smoke > 0 && <UtilPill kind="smoke" n={p.utilThrown.smoke} label="smoke" active={activeKind === "smoke"} onClick={() => onUtil(p, "smoke")} />}
          {p.utilThrown.flash > 0 && <UtilPill kind="flash" n={p.utilThrown.flash} label="flash" active={activeKind === "flash"} onClick={() => onUtil(p, "flash")} />}
          {p.utilThrown.he > 0 && <UtilPill kind="he" n={p.utilThrown.he} label="HE" active={activeKind === "he"} onClick={() => onUtil(p, "he")} />}
          {p.utilThrown.molotov > 0 && <UtilPill kind="molotov" n={p.utilThrown.molotov} label="molly" active={activeKind === "molotov"} onClick={() => onUtil(p, "molotov")} />}
          {p.enemiesFlashed > 0 && (
            <span className="pill bg-brand/10 text-brand">{p.enemiesFlashed} flashed · {p.flashDuration.toFixed(0)}s</span>
          )}
          {p.utilDamage > 0 && <span className="pill bg-bad/10 text-bad">{p.utilDamage} util dmg</span>}
        </div>
      )}

      {lean && (lean.ct.n > 0 || lean.t.n > 0) ? (
        <div className="mt-2.5 space-y-1.5">
          <div className="text-[11px] text-muted">Site focus (by call-out)</div>
          {lean.ct.n > 0 && <LeanRow side="CT" l={lean.ct} />}
          {lean.t.n > 0 && <LeanRow side="T" l={lean.t} />}
        </div>
      ) : area.rounds > 0 ? (
        <div className="mt-2.5">
          <div className="flex justify-between text-[11px] text-muted">
            <span>Area lean</span>
            <span className="text-faint">
              A {Math.round((area.a / areaTotal) * 100)}% · Mid{" "}
              {Math.round((area.mid / areaTotal) * 100)}% · B{" "}
              {Math.round((area.b / areaTotal) * 100)}%
            </span>
          </div>
          <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-panel">
            <div style={{ width: `${(area.a / areaTotal) * 100}%`, background: "#f5694a" }} />
            <div style={{ width: `${(area.mid / areaTotal) * 100}%`, background: "#f5b942" }} />
            <div style={{ width: `${(area.b / areaTotal) * 100}%`, background: "#5b9dff" }} />
          </div>
        </div>
      ) : null}

      {p.buys.pistol + p.buys.eco + p.buys.force + p.buys.full > 0 && (
        <div className="mt-2 flex items-center justify-between text-[10px]">
          <span className="text-muted">Buys</span>
          <span className="text-faint">
            {p.buys.full} full · {p.buys.force} force · {p.buys.eco} eco · {p.buys.pistol} pistol
          </span>
        </div>
      )}

      <AccountCheck steamId={p.steamId} name={p.name} matchScore={cheat.score} />
    </div>
  );
}

// One individual throw — click to play its lineup solo on the map.
function ThrowRow({
  tw,
  zone,
  timing,
  active,
  onClick,
}: {
  tw: UtilThrow;
  zone: string | null;
  timing: Timing;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-left transition ${
        active ? "border-brand/50 bg-brand/5" : "border-line hover:bg-panel/50"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2 text-xs">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_COLOR[tw.kind] }} />
        <span className="font-semibold text-ink">Round {tw.round}</span>
        {zone && <span className="truncate text-faint">{zone}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-[10px] text-faint">
        <TimingBadge timing={timing} />
        <span className="tabular-nums">{mmss(tw.t)}</span>
      </span>
    </button>
  );
}

export default function PlayerInsights({
  meta,
  rounds,
  view,
}: {
  meta: ReplayMeta;
  rounds: ReplayRound[];
  view: DemoView;
}) {
  const [kindSel, setKindSel] = useState<{ i: number; kind: string } | null>(null);
  const [throwIdx, setThrowIdx] = useState<number | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);

  const proj = useMemo(() => buildProjection(meta.map, rounds), [meta, rounds]);

  // scope the insights to the toolbar's round + side selection
  const data = useMemo(() => {
    const scoped =
      view.scopeRound != null && rounds[view.scopeRound]
        ? [rounds[view.scopeRound]]
        : rounds;
    return computeInsights(meta, scoped);
  }, [meta, rounds, view.scopeRound]);

  const players = useMemo(
    () => data.players.filter((p) => view.side === "all" || p.team === view.side),
    [data, view.side],
  );

  const fallback = useMemo(() => {
    let best: PlayerInsight | null = null;
    for (const p of players) {
      if (p.utilNades.length && (!best || p.utilNades.length > best.utilNades.length)) {
        best = p;
      }
    }
    if (!best) return null;
    const counts: Record<string, number> = {};
    for (const n of best.utilNades) counts[n.kind] = (counts[n.kind] ?? 0) + 1;
    const topKind = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    return { i: best.i, kind: topKind };
  }, [players]);

  const focusI = view.focusPlayer ?? fallback?.i ?? null;

  // timing tertiles across all util throws in the (scoped) match — robust to the
  // freeze-time offset baked into t (which is seconds since round start).
  const timingOf = useMemo(() => {
    const ts = players.flatMap((p) => p.utilNades.map((n) => n.t)).sort((a, b) => a - b);
    if (ts.length < 3) return (_t: number): Timing => "mid";
    const q = (f: number) => ts[Math.min(ts.length - 1, Math.floor((ts.length - 1) * f))];
    const t1 = q(1 / 3);
    const t2 = q(2 / 3);
    return (t: number): Timing => (t <= t1 ? "early" : t <= t2 ? "mid" : "late");
  }, [players]);

  // per-player A/B/Mid lean per side, classified against the active call-out
  // zones — "is this player usually an A or B player on each side?"
  const siteLean = useMemo(() => {
    const m = new Map<number, PlayerSiteLean>();
    if (!zones.length) return m;
    const get = (i: number) => {
      let v = m.get(i);
      if (!v) {
        v = { ct: { a: 0, b: 0, mid: 0, n: 0 }, t: { a: 0, b: 0, mid: 0, n: 0 } };
        m.set(i, v);
      }
      return v;
    };
    const scoped =
      view.scopeRound != null && rounds[view.scopeRound] ? [rounds[view.scopeRound]] : rounds;
    for (const r of scoped) {
      const frames = r.frames ?? [];
      for (let fi = 0; fi < frames.length; fi += 4) {
        for (const p of frames[fi].p) {
          if (p.h <= 0) continue;
          const sd = r.ct?.includes(p.i) ? "ct" : r.t?.includes(p.i) ? "t" : null;
          if (!sd) continue;
          const z = classifyPosition(meta.map, p.x, p.y, zones);
          const k = z?.kind;
          if (k !== "A" && k !== "B" && k !== "Mid") continue;
          const v = get(p.i)[sd];
          if (k === "A") v.a++;
          else if (k === "B") v.b++;
          else v.mid++;
          v.n++;
        }
      }
    }
    return m;
  }, [meta.map, rounds, view.scopeRound, zones]);

  // load this map's active call-out zones (localStorage / built-in defaults)
  useEffect(() => {
    setZones(loadZones(meta.map));
  }, [meta.map]);

  // reset the drill-down when the scope, side, or focused player changes
  useEffect(() => {
    setKindSel(null);
    setThrowIdx(null);
  }, [view.scopeRound, view.side]);
  // kind is player-scoped (see pickedKind), so changing player resets it
  // implicitly; only the throw selection needs an explicit reset here.
  useEffect(() => {
    setThrowIdx(null);
  }, [focusI]);

  if (!players.length) {
    const lbl =
      view.scopeRound != null && rounds[view.scopeRound]
        ? `round ${rounds[view.scopeRound].n}`
        : "match";
    return (
      <div className="card px-4 py-6 text-sm text-muted">
        No per-player data for {lbl}
        {view.side !== "all" ? ` on ${view.side}` : ""}.
      </div>
    );
  }

  const u = data.util;
  const scopeLabel =
    view.scopeRound != null && rounds[view.scopeRound]
      ? `round ${rounds[view.scopeRound].n}`
      : "match";
  const selPlayer = focusI != null ? players.find((p) => p.i === focusI) ?? null : null;
  const selKinds: string[] = selPlayer
    ? UTIL_KINDS.filter((k) => selPlayer.utilNades.some((n) => n.kind === k))
    : [];
  // honour a kind only if it was chosen for the currently-focused player
  const pickedKind =
    kindSel && kindSel.i === focusI && selKinds.includes(kindSel.kind) ? kindSel.kind : null;
  const activeKind =
    pickedKind ??
    (selPlayer && fallback && fallback.i === selPlayer.i && selKinds.includes(fallback.kind)
      ? fallback.kind
      : selKinds[0] ?? null);
  const selThrows =
    selPlayer && activeKind
      ? selPlayer.utilNades
          .filter((n) => n.kind === activeKind)
          .slice()
          .sort((a, b) => a.round - b.round || a.t - b.t)
      : [];
  const spots = activeKind ? clusterUtilThrows(selThrows, (x, y) => proj.project(x, y)) : [];
  const soloThrow = throwIdx != null && selThrows[throwIdx] ? selThrows[throwIdx] : null;
  const mapThrows = soloThrow ? [soloThrow] : selThrows;
  const zoneOf = (x: number, y: number) =>
    classifyPosition(meta.map, x, y, zones)?.name ?? null;
  const stepThrow = (d: number) =>
    setThrowIdx((i) => {
      if (!selThrows.length) return null;
      const next = (i ?? -1) + d;
      return Math.max(0, Math.min(selThrows.length - 1, next < 0 ? 0 : next));
    });

  const pickUtil = (player: PlayerInsight, k: string) => {
    view.setFocusPlayer(player.i);
    setKindSel({ i: player.i, kind: k });
    setThrowIdx(null);
  };
  const pickKind = (k: string) => {
    if (focusI != null) setKindSel({ i: focusI, kind: k });
    setThrowIdx(null);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,400px)]">
      {/* left: player cards */}
      <div className="space-y-3">
        <p className="text-[11px] text-faint">
          Click a player to focus them, then a utility chip to break it down — each
          spot is a cluster of throws that land together; open a spot to replay any
          single lineup on the map.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {players.map((p) => (
            <PlayerCard
              key={p.i}
              p={p}
              focused={focusI === p.i}
              activeKind={focusI === p.i ? activeKind : null}
              lean={siteLean.get(p.i)}
              onFocus={() => view.setFocusPlayer(view.focusPlayer === p.i ? null : p.i)}
              onUtil={pickUtil}
            />
          ))}
        </div>
        <p className="text-[11px] leading-relaxed text-faint">
          <span className="font-semibold text-muted">Data notes:</span>{" "}
          {PLAYER_INSIGHTS_LIMITATIONS}
        </p>
      </div>

      {/* right: utility explorer */}
      <div className="space-y-3 self-start lg:sticky lg:top-4">
        <div className="card-2 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="stat-label">Utility breakdown</span>
            {selPlayer && (
              <span className="pill max-w-[55%] truncate bg-panel text-ink">
                {selPlayer.name}
              </span>
            )}
          </div>

          {selPlayer && activeKind && selThrows.length > 0 ? (
            <>
              {/* kind tabs */}
              <div className="mb-2 flex flex-wrap gap-1">
                {selKinds.map((k) => {
                  const n = selPlayer.utilNades.filter((x) => x.kind === k).length;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => pickKind(k)}
                      className={`pill transition ${
                        k === activeKind
                          ? "bg-brand/15 text-brand"
                          : "bg-panel text-muted hover:text-ink"
                      }`}
                    >
                      <span
                        className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                        style={{ background: KIND_COLOR[k] }}
                      />
                      {KIND_LABEL[k]} {n}
                    </button>
                  );
                })}
              </div>

              <UtilThrowMap map={meta.map} proj={proj} throws={mapThrows} zones={zones} />

              {/* step through each throw */}
              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={() => stepThrow(-1)} title="Previous throw" className="btn btn-ghost px-2 py-1 text-xs">◀</button>
                <div className="min-w-0 flex-1 text-center text-[11px]">
                  {soloThrow ? (
                    <span>
                      <span className="font-semibold text-ink">Throw {(throwIdx ?? 0) + 1}/{selThrows.length}</span>
                      <span className="text-faint"> · R{soloThrow.round} · {mmss(soloThrow.t)}</span>
                      {zoneOf(soloThrow.x, soloThrow.y) && <span className="text-faint"> · {zoneOf(soloThrow.x, soloThrow.y)}</span>}
                    </span>
                  ) : (
                    <span className="text-muted">
                      {selThrows.length} {(KIND_LABEL[activeKind] ?? activeKind).toLowerCase()} — step ▶ or pick one
                    </span>
                  )}
                </div>
                {soloThrow && (
                  <button type="button" onClick={() => setThrowIdx(null)} title="Show all" className="btn btn-ghost px-2 py-1 text-[10px]">all</button>
                )}
                <button type="button" onClick={() => stepThrow(1)} title="Next throw" className="btn btn-ghost px-2 py-1 text-xs">▶</button>
              </div>
              {soloThrow && (
                <p className="mt-1 text-center text-[10px] text-brand">
                  dashed line = thrown from → landed · {timingOf(soloThrow.t)}
                </p>
              )}

              {/* every throw of this kind */}
              <div className="mt-2 max-h-48 space-y-1 overflow-y-auto pr-1">
                {selThrows.map((tw, i) => (
                  <ThrowRow
                    key={`${tw.round}-${tw.t}-${i}`}
                    tw={tw}
                    zone={zoneOf(tw.x, tw.y)}
                    timing={timingOf(tw.t)}
                    active={throwIdx === i}
                    onClick={() => setThrowIdx(throwIdx === i ? null : i)}
                  />
                ))}
              </div>

              {/* common spots — tendency summary */}
              {spots.length > 1 && (
                <div className="mt-2 border-t border-line pt-2">
                  <div className="stat-label mb-1">Common spots</div>
                  <div className="flex flex-wrap gap-1">
                    {spots.slice(0, 6).map((sp, i) => {
                      const z = zoneOf(sp.cx, sp.cy);
                      const first = selThrows.indexOf(sp.throws[0]);
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => first >= 0 && setThrowIdx(first)}
                          title={`${sp.count}× · usually ${timingOf(sp.avgT)} · avg ${mmss(sp.avgT)}`}
                          className="pill bg-panel text-muted hover:text-ink"
                        >
                          {z ?? "spot"} ×{sp.count}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="grid aspect-square place-items-center rounded-xl border border-dashed border-line px-4 text-center text-sm text-muted">
              {selPlayer
                ? `${selPlayer.name} threw no trackable utility${
                    view.scopeRound != null ? ` in ${scopeLabel}` : ""
                  }.`
                : "Pick a player to break down their utility."}
            </div>
          )}
        </div>

        <div className="card-2 px-4 py-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="stat-label">Utility used</span>
            <span className="pill bg-panel text-faint">{scopeLabel} total</span>
            <span className="ml-auto text-xs text-muted tabular-nums">
              {u.perRound.toFixed(1)} / round
            </span>
          </div>
          <div className="grid grid-cols-5 gap-2">
            <Stat label="Smoke" value={`${u.smoke}`} />
            <Stat label="Molly" value={`${u.molotov}`} />
            <Stat label="Flash" value={`${u.flash}`} />
            <Stat label="HE" value={`${u.he}`} />
            <Stat label="Decoy" value={`${u.decoy}`} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-1 text-[11px] text-faint">
          <span>
            {zones.length
              ? `${zones.length} call-out${zones.length === 1 ? "" : "s"} on ${meta.map.replace("de_", "")}`
              : "No call-outs yet for this map"}
          </span>
          <Link href="/demos/zones" className="text-brand hover:underline">
            Edit call-outs →
          </Link>
        </div>
      </div>
    </div>
  );
}
