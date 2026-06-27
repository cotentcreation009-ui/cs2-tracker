"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import {
  computeInsights,
  weaponLabel,
  PLAYER_INSIGHTS_LIMITATIONS,
  type PlayerInsight,
} from "@/lib/demo/insights";
import { KIND_COLOR, KIND_LABEL } from "@/components/demo/RadarMap";
import { UtilThrowMap } from "@/components/demo/UtilThrowMap";
import type { DemoView } from "@/components/demo/MatchToolbar";

const UTIL_KINDS = ["smoke", "flash", "he", "molotov", "decoy"] as const;

const CT = "#5b9dff";
const T = "#e7b53c";
const sideHex = (t: PlayerInsight["team"]) => (t === "T" ? T : CT);

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-panel/50 px-2.5 py-2">
      <div className="stat-label">{label}</div>
      <div className="mt-0.5 text-base font-bold tabular-nums text-ink">{value}</div>
      {sub && <div className="text-[10px] text-faint">{sub}</div>}
    </div>
  );
}

// Two-segment bar (wins vs losses style) for opening duels.
function SplitBar({ a, b, aHex, bHex }: { a: number; b: number; aHex: string; bHex: string }) {
  const total = a + b || 1;
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-panel">
      <div style={{ width: `${(a / total) * 100}%`, background: aHex }} />
      <div style={{ width: `${(b / total) * 100}%`, background: bHex }} />
    </div>
  );
}

// Clickable utility chip — drives the shared map panel + focuses this player.
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
      title={`Watch ${label} on the map`}
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

function PlayerCard({
  p,
  focused,
  activeKind,
  onFocus,
  onUtil,
}: {
  p: PlayerInsight;
  focused: boolean;
  activeKind: string | null;
  onFocus: () => void;
  onUtil: (player: PlayerInsight, kind: string) => void;
}) {
  const hex = sideHex(p.team);
  const mk = p.multiKills;
  const area = p.area;
  const areaTotal = area.a + area.b + area.mid || 1;
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

      {area.rounds > 0 && (
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
            <div style={{ width: `${(area.a / areaTotal) * 100}%`, background: "#46d369" }} />
            <div style={{ width: `${(area.mid / areaTotal) * 100}%`, background: "#f5b942" }} />
            <div style={{ width: `${(area.b / areaTotal) * 100}%`, background: "#5b9dff" }} />
          </div>
        </div>
      )}

      {p.buys.pistol + p.buys.eco + p.buys.force + p.buys.full > 0 && (
        <div className="mt-2 flex items-center justify-between text-[10px]">
          <span className="text-muted">Buys</span>
          <span className="text-faint">
            {p.buys.full} full · {p.buys.force} force · {p.buys.eco} eco · {p.buys.pistol} pistol
          </span>
        </div>
      )}
    </div>
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
  const [kind, setKind] = useState<string | null>(null);

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

  // Default the map to the biggest utility user's most-thrown grenade, so it's
  // alive on first view instead of an empty prompt.
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

  // reset the grenade-kind selection when the scope changes
  useEffect(() => {
    setKind(null);
  }, [view.scopeRound, view.side]);

  const scopeLabel =
    view.scopeRound != null && rounds[view.scopeRound]
      ? `round ${rounds[view.scopeRound].n}`
      : "match";

  if (!players.length) {
    return (
      <div className="card px-4 py-6 text-sm text-muted">
        No per-player data for {scopeLabel}
        {view.side !== "all" ? ` on ${view.side}` : ""}.
      </div>
    );
  }

  const u = data.util;
  const focusI = view.focusPlayer ?? fallback?.i ?? null;
  const selPlayer = focusI != null ? players.find((p) => p.i === focusI) ?? null : null;
  const selKinds: string[] = selPlayer
    ? UTIL_KINDS.filter((k) => selPlayer.utilNades.some((n) => n.kind === k))
    : [];
  const activeKind =
    kind && selKinds.includes(kind)
      ? kind
      : selPlayer && fallback && fallback.i === selPlayer.i && selKinds.includes(fallback.kind)
        ? fallback.kind
        : selKinds[0] ?? null;
  const selThrows =
    selPlayer && activeKind
      ? selPlayer.utilNades.filter((n) => n.kind === activeKind)
      : [];
  const roundsHit = new Set(selThrows.map((d) => d.round)).size;

  const pickUtil = (player: PlayerInsight, k: string) => {
    view.setFocusPlayer(player.i);
    setKind(k);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,380px)]">
      {/* left: player cards */}
      <div className="space-y-3">
        <p className="text-[11px] text-faint">
          Click a player to focus them everywhere; click a utility chip to watch it
          thrown on the map — tight clusters across rounds reveal a repeatable setup.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {players.map((p) => (
            <PlayerCard
              key={p.i}
              p={p}
              focused={focusI === p.i}
              activeKind={focusI === p.i ? activeKind : null}
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

      {/* right: persistent, animated utility map + match totals */}
      <div className="space-y-3 self-start lg:sticky lg:top-4">
        <div className="card-2 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="stat-label">Utility map</span>
            {selPlayer && (
              <span className="pill max-w-[55%] truncate bg-panel text-ink">
                {selPlayer.name}
              </span>
            )}
          </div>

          {selPlayer && activeKind && selThrows.length > 0 ? (
            <>
              <div className="mb-2 flex flex-wrap gap-1">
                {selKinds.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
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
                    {KIND_LABEL[k]}
                  </button>
                ))}
              </div>
              <UtilThrowMap map={meta.map} throws={selThrows} />
              <p className="mt-2 text-center text-xs text-muted">
                <span className="font-semibold text-ink">{selThrows.length}</span>{" "}
                {(KIND_LABEL[activeKind] ?? activeKind).toLowerCase()} across{" "}
                <span className="font-semibold text-ink">{roundsHit}</span> round
                {roundsHit === 1 ? "" : "s"} — tight clusters = a repeatable setup.
              </p>
            </>
          ) : (
            <div className="grid aspect-square place-items-center rounded-xl border border-dashed border-line px-4 text-center text-sm text-muted">
              {selPlayer
                ? `${selPlayer.name} threw no trackable utility${
                    view.scopeRound != null ? ` in ${scopeLabel}` : ""
                  }.`
                : "Pick a player to watch their utility on the map."}
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
      </div>
    </div>
  );
}
