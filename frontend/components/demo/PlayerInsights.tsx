"use client";

import { useMemo, useState } from "react";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import {
  computeInsights,
  weaponLabel,
  PLAYER_INSIGHTS_LIMITATIONS,
  type PlayerInsight,
} from "@/lib/demo/insights";
import { RadarMap, KIND_COLOR, KIND_LABEL } from "@/components/demo/RadarMap";

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

// Clickable utility chip — opens the map view for this player + grenade kind.
function UtilPill({
  kind,
  n,
  label,
  onClick,
}: {
  kind: string;
  n: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Show ${label} placements on the map`}
      className="pill bg-panel text-muted transition hover:bg-panel2 hover:text-ink"
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
  onUtil,
}: {
  p: PlayerInsight;
  onUtil: (player: PlayerInsight, kind: string) => void;
}) {
  const hex = sideHex(p.team);
  const mk = p.multiKills;
  const area = p.area;
  const areaTotal = area.a + area.b + area.mid || 1;
  return (
    <div className="card lift relative overflow-hidden pl-3 pr-4 py-3">
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: hex }} />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-bold">{p.name}</span>
        <span
          className="pill shrink-0"
          style={{ background: `${hex}22`, color: hex }}
        >
          {p.team || "—"}
        </span>
      </div>
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
          {p.utilThrown.smoke > 0 && <UtilPill kind="smoke" n={p.utilThrown.smoke} label="smoke" onClick={() => onUtil(p, "smoke")} />}
          {p.utilThrown.flash > 0 && <UtilPill kind="flash" n={p.utilThrown.flash} label="flash" onClick={() => onUtil(p, "flash")} />}
          {p.utilThrown.he > 0 && <UtilPill kind="he" n={p.utilThrown.he} label="HE" onClick={() => onUtil(p, "he")} />}
          {p.utilThrown.molotov > 0 && <UtilPill kind="molotov" n={p.utilThrown.molotov} label="molly" onClick={() => onUtil(p, "molotov")} />}
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
}: {
  meta: ReplayMeta;
  rounds: ReplayRound[];
}) {
  const data = useMemo(() => computeInsights(meta, rounds), [meta, rounds]);
  const [view, setView] = useState<{ player: PlayerInsight; kind: string } | null>(
    null,
  );
  if (!data.players.length) {
    return (
      <div className="card px-4 py-6 text-sm text-muted">
        No per-player data in this demo.
      </div>
    );
  }
  const u = data.util;

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-faint">
        Tip: click a player&apos;s utility chip to see where they throw it on the
        map — tight clusters across rounds reveal a repeatable setup.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.players.map((p) => (
          <PlayerCard
            key={p.i}
            p={p}
            onUtil={(player, kind) => setView({ player, kind })}
          />
        ))}
      </div>

      {/* Match-wide utility (no per-player thrower in our data) */}
      <div className="card-2 px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="stat-label">Utility used</span>
          <span className="pill bg-panel text-faint">match total</span>
          <span className="ml-auto text-xs text-muted tabular-nums">
            {u.perRound.toFixed(1)} / round
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          <Stat label="Smokes" value={`${u.smoke}`} />
          <Stat label="Molotovs" value={`${u.molotov}`} />
          <Stat label="Flashes" value={`${u.flash}`} />
          <Stat label="HE" value={`${u.he}`} />
          <Stat label="Decoys" value={`${u.decoy}`} />
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-faint">
        <span className="font-semibold text-muted">Data notes:</span>{" "}
        {PLAYER_INSIGHTS_LIMITATIONS}
      </p>

      {view && (
        <UtilMapModal
          meta={meta}
          player={view.player}
          kind={view.kind}
          onKind={(k) => setView((v) => (v ? { ...v, kind: k } : v))}
          onClose={() => setView(null)}
        />
      )}
    </div>
  );
}

// Modal: a player's grenade placements plotted on the map radar, with a kind
// switcher. Repeated spots across rounds reveal a setup.
function UtilMapModal({
  meta,
  player,
  kind,
  onKind,
  onClose,
}: {
  meta: ReplayMeta;
  player: PlayerInsight;
  kind: string;
  onKind: (k: string) => void;
  onClose: () => void;
}) {
  const kinds = useMemo(() => {
    const set = new Set(player.utilNades.map((n) => n.kind));
    return UTIL_KINDS.filter((k) => set.has(k));
  }, [player]);
  const dots = useMemo(
    () => player.utilNades.filter((n) => n.kind === kind),
    [player, kind],
  );
  const roundsHit = new Set(dots.map((d) => d.round)).size;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="card-2 w-full max-w-lg p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-bold">{player.name}</div>
            <div className="stat-label">utility placement map</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost px-2 py-1 text-xs"
          >
            ✕ Close
          </button>
        </div>

        <div className="mb-3 flex flex-wrap gap-1">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onKind(k)}
              className={`pill transition ${
                k === kind
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

        <RadarMap map={meta.map} dots={dots} className="mx-auto max-w-115" />

        <p className="mt-3 text-center text-xs text-muted">
          <span className="font-semibold text-ink">{dots.length}</span>{" "}
          {(KIND_LABEL[kind] ?? kind).toLowerCase()} placement
          {dots.length === 1 ? "" : "s"} across{" "}
          <span className="font-semibold text-ink">{roundsHit}</span> round
          {roundsHit === 1 ? "" : "s"} — tight clusters mean a repeatable setup.
        </p>
      </div>
    </div>
  );
}
