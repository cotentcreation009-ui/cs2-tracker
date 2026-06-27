"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import {
  computeWeaponInsights,
  type PlayerWeaponStat,
  type WeaponStat,
  type WeaponInsightsData,
} from "@/lib/demo/weapons";
import type { DemoView } from "@/components/demo/MatchToolbar";

const CT = "#5b9dff";
const T = "#e7b53c";
const teamColor = (t: "CT" | "T" | "") => (t === "T" ? T : t === "CT" ? CT : "var(--color-faint)");

// --- small reusable bits ----------------------------------------------------

function WeaponBadge({ w, size = 22 }: { w: WeaponStat; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded font-black"
      style={{
        width: size,
        height: size,
        background: `${w.color}22`,
        color: w.color,
        fontSize: size * 0.36,
      }}
    >
      {w.label.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase()}
    </span>
  );
}

const hsColor = (p: number) =>
  p >= 55 ? "var(--color-bad)" : p >= 35 ? "var(--color-mid)" : "var(--color-muted)";

function StatPill({
  label,
  value,
  hint,
  hex,
}: {
  label: string;
  value: string;
  hint?: string;
  hex?: string;
}) {
  return (
    <div className="card px-4 py-3">
      <div className="stat-label">{label}</div>
      <div
        className="mt-1 text-2xl font-extrabold tabular-nums"
        style={hex ? { color: hex } : undefined}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-faint">{hint}</div>}
    </div>
  );
}

// --- weapon kill rows (overall) --------------------------------------------

function WeaponRow({ w, max }: { w: WeaponStat; max: number }) {
  const pct = max ? (w.kills / max) * 100 : 0;
  return (
    <div className="group">
      <div className="mb-1 flex items-center gap-2">
        <WeaponBadge w={w} />
        <span className="text-sm font-semibold text-ink">{w.label}</span>
        <span className="ml-auto flex items-center gap-2 text-xs tabular-nums">
          <span className="text-faint">{w.kills} K</span>
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
            style={{ background: `${hsColor(w.hsPct)}1f`, color: hsColor(w.hsPct) }}
          >
            {w.hsPct.toFixed(0)}% HS
          </span>
        </span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-panel">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${pct}%`, background: w.color, boxShadow: `0 0 8px -2px ${w.color}` }}
        />
        {/* headshot fill overlay */}
        <div
          className="absolute inset-y-0 left-0 rounded-full opacity-90"
          style={{
            width: `${(pct * w.hsPct) / 100}%`,
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,.35))",
          }}
        />
      </div>
    </div>
  );
}

// --- weapon class mix (stacked holo bar + legend) --------------------------

function ClassMix({ data }: { data: WeaponInsightsData }) {
  const segs = data.classes.filter((c) => c.kills > 0);
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-panel">
        {segs.map((c) => (
          <div
            key={c.cls}
            className="h-full first:rounded-l-full last:rounded-r-full"
            title={`${c.label}: ${c.kills} (${c.pct.toFixed(0)}%)`}
            style={{ width: `${c.pct}%`, background: c.color, boxShadow: `inset 0 0 6px ${c.color}` }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {segs.map((c) => (
          <span key={c.cls} className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
            {c.label}{" "}
            <span className="tabular-nums text-faint">{c.pct.toFixed(0)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// --- per-player drilldown ---------------------------------------------------

function PlayerCard({
  p,
  maxKills,
  open,
  onToggle,
}: {
  p: PlayerWeaponStat;
  maxKills: number;
  open: boolean;
  onToggle: () => void;
}) {
  const col = teamColor(p.team);
  const top = p.topWeapon;
  const barMax = p.weapons[0]?.kills ?? 1;
  return (
    <div className={`card px-4 py-3 ${open ? "ring-1 ring-brand/40" : ""}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 text-left"
      >
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm font-black"
          style={{ background: `${col}22`, color: col }}
        >
          {(p.name || "?").slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-bold text-ink">{p.name}</span>
            <span
              className="rounded px-1 text-[9px] font-bold"
              style={{ background: `${col}22`, color: col }}
            >
              {p.team || "—"}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-faint">
            {top && <WeaponBadge w={top} size={14} />}
            <span className="truncate">{top ? top.label : "—"}</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-extrabold tabular-nums text-ink">{p.totalKills}</div>
          <div className="text-[10px] tabular-nums" style={{ color: hsColor(p.hsPct) }}>
            {p.hsPct.toFixed(0)}% HS
          </div>
        </div>
        <svg
          className={`h-4 w-4 shrink-0 text-faint transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          {p.weapons.map((w) => {
            const pct = barMax ? (w.kills / barMax) * 100 : 0;
            return (
              <div key={w.key} className="flex items-center gap-2">
                <WeaponBadge w={w} size={18} />
                <span className="w-24 shrink-0 truncate text-[11px] font-medium text-muted">
                  {w.label}
                </span>
                <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-panel">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${pct}%`, background: w.color }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-faint">
                  {w.kills}
                </span>
                <span
                  className="w-12 shrink-0 text-right text-[11px] tabular-nums"
                  style={{ color: hsColor(w.hsPct) }}
                >
                  {w.hsPct.toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- main -------------------------------------------------------------------

/**
 * WeaponInsights — a kill-driven weapon meta for one match. Re-derives the old
 * csgomap weapon view from §5 kill events only (we have no purchase/economy
 * data): per-weapon kills + headshot %, weapon-class mix, and a per-player
 * weapon breakdown. Scope to a single round or the whole match.
 */
export default function WeaponInsights({
  meta,
  rounds,
  view,
}: {
  meta: ReplayMeta;
  rounds: ReplayRound[];
  view: DemoView;
}) {
  const roundSel = view.scopeRound; // null = whole match, else a round index
  const [openPlayer, setOpenPlayer] = useState<number | null>(null);

  // Follow the shared player focus (toolbar or another tab).
  useEffect(() => {
    if (view.focusPlayer != null) setOpenPlayer(view.focusPlayer);
  }, [view.focusPlayer]);

  const data = useMemo(
    () =>
      computeWeaponInsights(
        meta,
        rounds,
        roundSel === null ? undefined : (_r, idx) => idx === roundSel,
        view.side,
      ),
    [meta, rounds, roundSel, view.side],
  );

  if (!data.totalKills) {
    return (
      <div className="card-2 px-5 py-8 text-center text-sm text-muted">
        No kill data available for {roundSel === null ? "this match" : `round ${rounds[roundSel]?.n}`}
        {view.side !== "all" ? ` (${view.side} side)` : ""}.
      </div>
    );
  }

  const maxKills = data.weapons[0]?.kills ?? 1;
  const topWeapons = data.weapons.slice(0, 8);

  return (
    <section className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand/15 text-brand">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <circle cx="12" cy="12" r="8" />
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
          </svg>
        </span>
        <h2 className="text-lg font-extrabold tracking-tight">Weapon Insights</h2>
        <span className="text-xs text-faint">
          {data.totalKills} kills · {data.rounds} {data.rounds === 1 ? "round" : "rounds"} · kill-derived
        </span>

        {(roundSel !== null || view.side !== "all") && (
          <span className="ml-auto pill bg-brand/15 text-brand">
            {[
              roundSel !== null ? `Round ${rounds[roundSel]?.n}` : null,
              view.side !== "all" ? `${view.side} side` : null,
            ]
              .filter(Boolean)
              .join(" · ")}{" "}
            · scoped
          </span>
        )}
      </div>

      {/* headline stat strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatPill label="Total kills" value={String(data.totalKills)} hint={`${data.rounds} rounds`} />
        <StatPill
          label="Headshot rate"
          value={`${data.overallHsPct.toFixed(0)}%`}
          hint={`${data.totalHeadshots} headshots`}
          hex={hsColor(data.overallHsPct)}
        />
        <StatPill
          label="Top weapon"
          value={data.topWeapon ? data.topWeapon.label : "—"}
          hint={data.topWeapon ? `${data.topWeapon.kills} kills` : undefined}
          hex={data.topWeapon?.color}
        />
        <StatPill
          label="Deadliest"
          value={data.deadliestPlayer ? data.deadliestPlayer.name : "—"}
          hint={data.deadliestPlayer ? `${data.deadliestPlayer.totalKills} kills` : undefined}
          hex={data.deadliestPlayer ? teamColor(data.deadliestPlayer.team) : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* weapon kill chart */}
        <div className="card-2 px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="stat-label">Kills by weapon</h3>
            <span className="text-[10px] text-faint">bar = kills · pill = headshot %</span>
          </div>
          <div className="space-y-3">
            {topWeapons.map((w) => (
              <WeaponRow key={w.key} w={w} max={maxKills} />
            ))}
          </div>

          <div className="mt-4 border-t border-line pt-3">
            <div className="stat-label mb-2">Weapon class mix</div>
            <ClassMix data={data} />
          </div>

          {data.topHsWeapon && (
            <div className="mt-4 rounded-lg border border-line bg-panel/40 p-3">
              <div className="flex items-center gap-1.5">
                <span className="text-bad">◎</span>
                <p className="text-[10px] font-bold uppercase tracking-wider text-faint">
                  Most headshot-prone
                </p>
              </div>
              <p className="mt-0.5 text-[12px] text-muted">
                <span className="font-bold" style={{ color: data.topHsWeapon.color }}>
                  {data.topHsWeapon.label}
                </span>{" "}
                landed{" "}
                <span className="font-bold" style={{ color: hsColor(data.topHsWeapon.hsPct) }}>
                  {data.topHsWeapon.hsPct.toFixed(0)}%
                </span>{" "}
                headshots ({data.topHsWeapon.headshots}/{data.topHsWeapon.kills} kills).
              </p>
            </div>
          )}
        </div>

        {/* per-player breakdown */}
        <div className="card-2 px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="stat-label">Per-player weapons</h3>
            <span className="text-[10px] text-faint">click to expand</span>
          </div>
          <div className="space-y-2">
            {data.players.map((p) => (
              <PlayerCard
                key={p.i}
                p={p}
                maxKills={maxKills}
                open={openPlayer === p.i}
                onToggle={() => {
                  const next = openPlayer === p.i ? null : p.i;
                  setOpenPlayer(next);
                  view.setFocusPlayer(next);
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <p className="text-[10px] leading-relaxed text-faint">
        Derived from kill events (killer · weapon · headshot). Per-weapon purchases
        and per-weapon damage aren&apos;t attributed by the demo, so this is a
        kill-driven weapon meta — see the Insights tab for economy (buys), ADR and
        flash stats.
      </p>
    </section>
  );
}