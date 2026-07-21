"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import {
  computeWeaponInsights,
  computeBuyMatrix,
  computeNemesis,
  computeDuels,
  weaponMeta,
  type WeaponStat,
  type WeaponInsightsData,
  type WeaponClass,
} from "@/lib/demo/weapons";
import { classifyBuy, BUY_KEYS, type BuyKey } from "@/lib/demo/economy";
import { buildProjection } from "@/lib/demo/projection";
import { getActiveZones, classifyPosition } from "@/lib/maps/zones";
import { radarImage } from "@/lib/maps/calibration";
import type { DemoView } from "@/components/demo/MatchToolbar";

const CT = "#5b9dff";
const T = "#e7b53c";
const teamColor = (t: "CT" | "T" | "") => (t === "T" ? T : t === "CT" ? CT : "var(--color-faint)");
const sideOf = (r: ReplayRound, i: number, meta: ReplayMeta): "CT" | "T" | "" =>
  r.ct?.includes(i) ? "CT" : r.t?.includes(i) ? "T" : meta.players[i]?.team ?? "";

const TIER: Record<BuyKey, { label: string; color: string }> = {
  full: { label: "Full", color: "#46d369" },
  force: { label: "Force", color: "#f5b942" },
  semi: { label: "Semi", color: "#e0a93c" },
  eco: { label: "Eco", color: "#5a7aa3" },
  pistol: { label: "Pistol", color: "#8a7dff" },
};

// --- small reusable bits ----------------------------------------------------

function WeaponBadge({ w, size = 22 }: { w: Pick<WeaponStat, "label" | "color">; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded font-black"
      style={{ width: size, height: size, background: `${w.color}22`, color: w.color, fontSize: size * 0.36 }}
    >
      {w.label.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase()}
    </span>
  );
}

const hsColor = (p: number) => (p >= 55 ? "var(--color-bad)" : p >= 35 ? "var(--color-mid)" : "var(--color-muted)");

function StatPill({
  label,
  value,
  hint,
  hex,
  tone,
  weapon,
  title,
}: {
  label: string;
  value: string;
  hint?: string;
  hex?: string;
  tone?: "offense" | "threat";
  weapon?: Pick<WeaponStat, "label" | "color"> | null; // when set, shows a weapon badge beside the value
  title?: string; // hover tooltip explaining the measurement
}) {
  return (
    <div className="card px-4 py-3 lg:px-3 lg:py-2" title={title}>
      <div className="flex items-center gap-1.5">
        {tone && (
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: tone === "threat" ? "var(--color-bad)" : "var(--color-good)" }}
          />
        )}
        <div className="stat-label">{label}</div>
      </div>
      <div className="mt-1 flex items-center gap-2">
        {weapon && <WeaponBadge w={weapon} size={26} />}
        <div className="min-w-0 truncate text-2xl font-extrabold tabular-nums lg:text-xl" style={hex ? { color: hex } : undefined}>
          {value}
        </div>
      </div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-faint">{hint}</div>}
    </div>
  );
}

// One weapon row. The bar length = kill share; within it a bright leading
// segment = the headshot fraction (dim = body shots), so precision reads at a
// glance. Clicking plots exactly those kills/deaths on the map (the star
// interaction) — selected rows get a coloured ring + an "on map" chip.
function WeaponRow({
  w,
  max,
  unit = "K",
  selected = false,
  onSelect,
  acc,
}: {
  w: WeaponStat;
  max: number;
  unit?: string;
  selected?: boolean;
  onSelect?: () => void;
  acc?: { s: number; h: number } | null; // per-weapon shots/hits (absent on old parses → no sub-stat)
}) {
  const pct = max ? (w.kills / max) * 100 : 0;
  const enough = w.kills >= 3;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={onSelect ? !!selected : undefined}
      title={onSelect ? `Plot ${w.label} ${unit === "D" ? "deaths" : "kills"} on the map` : undefined}
      className={`group block w-full rounded-lg px-2 py-1.5 text-left transition ${
        selected ? "bg-panel/70" : "hover:bg-panel/40"
      }`}
      style={selected ? { boxShadow: `inset 0 0 0 1px ${w.color}` } : undefined}
    >
      <div className="flex items-center gap-2">
        <WeaponBadge w={w} />
        <span className="truncate text-sm font-semibold text-ink">{w.label}</span>
        {selected ? (
          <span className="shrink-0 rounded-full px-1.5 text-[9px] font-bold uppercase tracking-wider" style={{ background: `${w.color}22`, color: w.color }}>
            on map
          </span>
        ) : (
          onSelect && (
            <span className="hidden shrink-0 text-[9px] font-semibold uppercase tracking-wider text-brand/70 group-hover:inline">
              → map
            </span>
          )
        )}
        <span className="ml-auto flex shrink-0 items-baseline gap-2 tabular-nums">
          {acc != null && acc.s > 0 && (
            <span className="text-[10px] font-semibold text-faint" title={`${acc.h} of ${acc.s} bullets hit`}>
              {Math.round((acc.h / acc.s) * 100)}% acc
            </span>
          )}
          <span className="text-sm font-bold text-ink">
            {w.kills}
            <span className="ml-0.5 text-[10px] font-normal text-faint">{unit}</span>
          </span>
          <span
            className="w-11 text-right text-[10px] font-bold"
            style={{ color: enough ? hsColor(w.hsPct) : "var(--color-faint)" }}
            title={enough ? undefined : "sample too small to judge headshot rate"}
          >
            {w.hsPct.toFixed(0)}% HS
          </span>
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-panel">
        <div className="relative h-full rounded-full" style={{ width: `${pct}%`, background: `${w.color}59` }}>
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${w.hsPct}%`, background: w.color, boxShadow: `0 0 8px -2px ${w.color}` }}
          />
        </div>
      </div>
    </button>
  );
}

function ClassMix({ data }: { data: WeaponInsightsData }) {
  const segs = data.classes.filter((c) => c.kills > 0);
  if (!segs.length) return null;
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
            {c.label} <span className="tabular-nums text-faint">{c.pct.toFixed(0)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// The Arsenal panel — the offense/defense weapon list with one lens toggle
// (Kills / Deaths) instead of two side-by-side panels. Clicking a weapon plots
// exactly those kills (or deaths) on the map. Deaths are only meaningful once a
// player or side is scoped (unscoped, every kill is someone's death, so the two
// lists are identical) — the toggle disables itself and explains why.
function Arsenal({
  offense,
  defense,
  unscoped,
  scopeLabel,
  lens,
  onLens,
  selectedWeapon,
  onSelectWeapon,
  weaponAcc,
}: {
  offense: WeaponInsightsData;
  defense: WeaponInsightsData;
  unscoped: boolean;
  scopeLabel: string;
  lens: "kills" | "deaths";
  onLens: (l: "kills" | "deaths") => void;
  selectedWeapon: string | null;
  onSelectWeapon: (key: string) => void;
  weaponAcc?: Map<string, { s: number; h: number }>; // scoped per-weapon shots/hits (kills lens only)
}) {
  const showDeaths = lens === "deaths" && !unscoped;
  const data = showDeaths ? defense : offense;
  const unit = showDeaths ? "D" : "K";
  const max = data.weapons[0]?.kills ?? 1;
  return (
    <div className="card-2 px-5 py-4 lg:flex lg:min-w-0 lg:flex-col lg:px-4 lg:py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="stat-label">Arsenal</h3>
        <div className="flex rounded-lg border border-line bg-panel p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => onLens("kills")}
            aria-pressed={!showDeaths}
            className={`rounded-md px-2 py-0.5 font-medium transition ${!showDeaths ? "bg-brand/15 text-brand" : "text-muted hover:text-ink"}`}
          >
            Kills
          </button>
          <button
            type="button"
            onClick={() => !unscoped && onLens("deaths")}
            aria-pressed={showDeaths}
            disabled={unscoped}
            title={unscoped ? "Pick a player or side to see what kills them" : undefined}
            className={`rounded-md px-2 py-0.5 font-medium transition ${showDeaths ? "bg-brand/15 text-brand" : "text-muted hover:text-ink"} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            Deaths
          </button>
        </div>
      </div>
      <div className="mb-2 flex items-center justify-between gap-2 text-[10px] text-faint">
        <span className="truncate">
          {showDeaths ? `what kills ${scopeLabel}` : `${scopeLabel} kills by weapon`}
        </span>
        <span className="shrink-0 text-brand/70">click a weapon → map</span>
      </div>
      {data.weapons.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted">
          No {showDeaths ? "deaths" : "kills"} in this scope.
        </div>
      ) : (
        <>
          <div className="space-y-1">
            {data.weapons.slice(0, 9).map((w) => (
              <WeaponRow
                key={w.key}
                w={w}
                max={max}
                unit={unit}
                selected={selectedWeapon === w.key}
                onSelect={() => onSelectWeapon(w.key)}
                // deaths list the killers' weapons — the scoped subject's own
                // accuracy with them would be the wrong number, so kills only
                acc={showDeaths ? null : weaponAcc?.get(w.key) ?? null}
              />
            ))}
          </div>
          <div className="mt-3 border-t border-line pt-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="stat-label">Class mix</div>
              <span className="text-[9px] text-faint">bar: bright = headshots</span>
            </div>
            <ClassMix data={data} />
          </div>
        </>
      )}
    </div>
  );
}

// --- longest kill (a single headline stat) ----------------------------------
// The full "range profile" panel was dropped as competitively thin; we keep only
// the one recognisable number — the match's (or scoped player's) longest gun
// kill — computed straight from the kill coordinates.

const UNIT_TO_M = 0.01905; // CS2 world units → meters (16u ≈ 1ft)

interface LongestKill {
  d: number;
  label: string;
  color: string;
  killer: string;
  victim: string;
  rn: number;
}

function longestKillOf(
  meta: ReplayMeta,
  rounds: ReplayRound[],
  roundFilter: ((r: ReplayRound, idx: number) => boolean) | undefined,
  side: "all" | "CT" | "T",
  focus: number | null,
): LongestKill | null {
  let best: LongestKill | null = null;
  rounds.forEach((r, idx) => {
    if (roundFilter && !roundFilter(r, idx)) return;
    for (const k of r.kills ?? []) {
      if (k.k < 0 || !k.w) continue;
      if (weaponMeta(k.w).cls === "other") continue; // guns only — no lobbed nades
      if (focus != null && k.k !== focus) continue;
      if (side !== "all" && sideOf(r, k.k, meta) !== side) continue;
      const d = Math.hypot(k.kx - k.vx, k.ky - k.vy) * UNIT_TO_M;
      if (!best || d > best.d) {
        const wm = weaponMeta(k.w);
        best = { d, label: wm.label, color: wm.color, killer: meta.players[k.k]?.name ?? "?", victim: meta.players[k.v]?.name ?? "?", rn: r.n };
      }
    }
  });
  return best;
}

// --- bullet accuracy (shots / hits / headshot hits) --------------------------
// Summed from the per-round player stats (older parses lack them → all zeros,
// rendered as "—"). Same scoping rules as the weapon computations: optional
// round filter, side (by the side the player was on THAT round), and focus.

interface BulletAcc {
  shots: number;
  hits: number;
  hsHits: number;
}

function accuracyOf(
  meta: ReplayMeta,
  rounds: ReplayRound[],
  roundFilter: ((r: ReplayRound, idx: number) => boolean) | undefined,
  side: "all" | "CT" | "T",
  focus: number | null,
): BulletAcc {
  const acc: BulletAcc = { shots: 0, hits: 0, hsHits: 0 };
  rounds.forEach((r, idx) => {
    if (roundFilter && !roundFilter(r, idx)) return;
    for (const s of r.stats ?? []) {
      if (focus != null && s.i !== focus) continue;
      if (side !== "all" && sideOf(r, s.i, meta) !== side) continue;
      acc.shots += s.shots ?? 0;
      acc.hits += s.hits ?? 0;
      acc.hsHits += s.hsHits ?? 0;
    }
  });
  return acc;
}

const pctOr = (num: number, den: number) => (den ? `${((num / den) * 100).toFixed(0)}%` : "—");

// --- per-weapon accuracy (stats.wacc) ----------------------------------------
// wacc is keyed by the parser's weapon strings — the very same strings kill
// events carry — so normalising each key through weaponMeta() lands it on the
// WeaponStat.key the Arsenal rows use. Absent on older parses → empty map →
// the "% acc" sub-stat simply never renders.

function weaponAccOf(
  meta: ReplayMeta,
  rounds: ReplayRound[],
  roundFilter: ((r: ReplayRound, idx: number) => boolean) | undefined,
  side: "all" | "CT" | "T",
  focus: number | null,
): Map<string, { s: number; h: number }> {
  const out = new Map<string, { s: number; h: number }>();
  rounds.forEach((r, idx) => {
    if (roundFilter && !roundFilter(r, idx)) return;
    for (const st of r.stats ?? []) {
      if (focus != null && st.i !== focus) continue;
      if (side !== "all" && sideOf(r, st.i, meta) !== side) continue;
      for (const [raw, a] of Object.entries(st.wacc ?? {})) {
        const key = weaponMeta(raw).key;
        const e = out.get(key) ?? { s: 0, h: 0 };
        e.s += a.s ?? 0;
        e.h += a.h ?? 0;
        out.set(key, e);
      }
    }
  });
  return out;
}

// --- round highlights (multi-kills + opener conversion) ---------------------
// The pro's first scan of a match: who dropped the 3K/4K/ACE rounds, and how
// often each side converted the opening pick into the round. Chips jump the
// whole workspace to that round + player (every lens follows).

function RoundHighlights({ meta, rounds, view }: { meta: ReplayMeta; rounds: ReplayRound[]; view: DemoView }) {
  const data = useMemo(() => {
    const marks: { idx: number; n: number; player: number; count: number; weapon: string }[] = [];
    let ctOpen = 0, ctConv = 0, tOpen = 0, tConv = 0;
    rounds.forEach((r, idx) => {
      const kills = (r.kills ?? []).filter((k) => k.k >= 0);
      const enemyKill = (k: (typeof kills)[number]) => {
        const ks = sideOf(r, k.k, meta);
        return ks !== "" && ks !== sideOf(r, k.v, meta);
      };
      // multi-kills (enemy kills only — no teamkill "aces")
      const per = new Map<number, { n: number; w: Map<string, number> }>();
      for (const k of kills) {
        if (!enemyKill(k)) continue;
        const e = per.get(k.k) ?? { n: 0, w: new Map<string, number>() };
        e.n++;
        e.w.set(k.w, (e.w.get(k.w) ?? 0) + 1);
        per.set(k.k, e);
      }
      for (const [p, e] of per) {
        if (e.n >= 3) {
          const weapon = [...e.w.entries()].sort((a, b) => b[1] - a[1])[0][0];
          marks.push({ idx, n: r.n, player: p, count: e.n, weapon });
        }
      }
      // opening pick → did the opener's side win the round?
      const first = kills.filter(enemyKill).sort((a, b) => a.t - b.t)[0];
      if (first) {
        const s = sideOf(r, first.k, meta);
        if (s === "CT") {
          ctOpen++;
          if (r.winner === "CT") ctConv++;
        } else if (s === "T") {
          tOpen++;
          if (r.winner === "T") tConv++;
        }
      }
    });
    marks.sort((a, b) => a.idx - b.idx || b.count - a.count);
    return { marks, ctOpen, ctConv, tOpen, tConv };
  }, [meta, rounds]);

  if (!data.marks.length && !data.ctOpen && !data.tOpen) return null;

  const tier = (c: number) =>
    c >= 5
      ? { label: "ACE", chip: "bg-good/15 text-good", ring: "ring-good/40" }
      : c === 4
        ? { label: "4K", chip: "bg-mid/15 text-mid", ring: "ring-mid/40" }
        : { label: "3K", chip: "bg-panel text-muted", ring: "ring-line" };

  return (
    <div className="scroll-slim flex items-center gap-2 overflow-x-auto pb-0.5 lg:shrink-0">
      <span className="stat-label shrink-0">Highlights</span>
      {data.marks.map((m) => {
        const t = tier(m.count);
        const on = view.scopeRound === m.idx && view.focusPlayer === m.player;
        return (
          <button
            key={`${m.idx}:${m.player}`}
            type="button"
            onClick={() => {
              view.setScopeRound(on ? null : m.idx);
              view.setFocusPlayer(on ? null : m.player);
            }}
            aria-pressed={on}
            title={`Round ${m.n}: ${meta.players[m.player]?.name ?? "?"} ${m.count}K with ${weaponMeta(m.weapon).label} — scope the workspace to it`}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset transition hover:brightness-110 ${t.chip} ${
              on ? "ring-2 ring-brand" : t.ring
            }`}
          >
            <span className="font-black">{t.label}</span>
            <span className="text-ink">{meta.players[m.player]?.name ?? "?"}</span>
            <span className="text-faint">
              R{m.n} · {weaponMeta(m.weapon).label}
            </span>
          </button>
        );
      })}
      {data.marks.length === 0 && <span className="text-[11px] text-faint">no 3K+ rounds</span>}
      <span className="ml-auto shrink-0 pl-3 text-[11px] tabular-nums text-muted">
        Opening picks:{" "}
        <span className="font-semibold" style={{ color: CT }}>
          CT {data.ctOpen}
        </span>
        {data.ctOpen > 0 && (
          <span className="text-faint"> ({Math.round((data.ctConv / data.ctOpen) * 100)}% won)</span>
        )}
        <span className="text-faint"> · </span>
        <span className="font-semibold" style={{ color: T }}>
          T {data.tOpen}
        </span>
        {data.tOpen > 0 && (
          <span className="text-faint"> ({Math.round((data.tConv / data.tOpen) * 100)}% won)</span>
        )}
      </span>
    </div>
  );
}

// --- buy-vs-buy kill matrix (the economy ladder) ---------------------------

function BuyMatrixCard({ meta, rounds, view }: { meta: ReplayMeta; rounds: ReplayRound[]; view: DemoView }) {
  const m = useMemo(
    () =>
      computeBuyMatrix(
        meta,
        rounds,
        view.scopeRound != null ? (_r, idx) => idx === view.scopeRound : undefined,
        view.side,
        view.focusPlayer,
      ),
    [meta, rounds, view.scopeRound, view.side, view.focusPlayer],
  );

  if (!m.hasData || m.total === 0) {
    return (
      <div className="card-2 px-5 py-4">
        <h3 className="stat-label mb-1">Economy ladder · who frags up the buy</h3>
        <p className="text-xs text-muted">
          No per-round economy data for this scope (re-parse the demo to populate buy values).
        </p>
      </div>
    );
  }

  const rank = (k: BuyKey) => BUY_KEYS.indexOf(k);
  const upsetPct = m.total ? (m.upset / m.total) * 100 : 0;

  const totalPct = (n: number) => (m.total ? Math.round((n / m.total) * 100) : 0);
  return (
    <div className="card-2 px-5 py-4 lg:px-4 lg:py-3">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="stat-label">Economy ladder · who frags up the buy</h3>
        <span className="text-[10px] text-faint">cell = kills · green ring = punching up</span>
      </div>
      <p className="mb-3 text-xs text-muted">
        <span className="font-bold text-good">{m.upset}</span> upset frags ({upsetPct.toFixed(0)}%) — killing an
        equal-or-richer enemy while on the weaker buy · {m.total} gun kills with economy data.
      </p>
      <div className="scroll-slim overflow-x-auto">
        <div
          className="grid w-full gap-1 text-xs"
          style={{ gridTemplateColumns: `2.4rem repeat(${BUY_KEYS.length}, minmax(2.4rem, 1fr)) 2.8rem` }}
        >
          {/* header row: victim buy tiers + Σ */}
          <div className="flex items-end justify-end pr-1 text-[9px] uppercase tracking-wider text-faint">K\V</div>
          {BUY_KEYS.map((vk) => (
            <div key={vk} className="pb-0.5 text-center text-[11px] font-bold" style={{ color: TIER[vk].color }}>
              {TIER[vk].label}
            </div>
          ))}
          <div className="flex items-end justify-center pb-0.5 text-[10px] font-bold uppercase text-faint">Σ</div>

          {/* body rows */}
          {BUY_KEYS.map((kk) => (
            <Fragment key={kk}>
              <div className="flex items-center justify-end pr-1 text-[11px] font-bold" style={{ color: TIER[kk].color }}>
                {TIER[kk].label}
              </div>
              {BUY_KEYS.map((vk) => {
                const n = m.cells[kk][vk];
                const intensity = m.max ? n / m.max : 0;
                const upset = rank(kk) > rank(vk);
                return (
                  <div
                    key={vk}
                    title={`${TIER[kk].label} buy killed ${TIER[vk].label} buy: ${n} time${n === 1 ? "" : "s"}${upset && n > 0 ? " (punching up)" : ""}`}
                    className={`grid h-11 place-items-center rounded font-semibold tabular-nums lg:h-9 ${upset && n > 0 ? "ring-1 ring-good/70" : ""}`}
                    style={{
                      background: n
                        ? `color-mix(in srgb, var(--color-brand) ${Math.round(12 + intensity * 60)}%, var(--color-panel))`
                        : "var(--color-panel)",
                      color: n ? "var(--color-ink)" : "var(--color-faint)",
                    }}
                  >
                    {n || "·"}
                  </div>
                );
              })}
              {/* row total: kills made on this buy tier */}
              <div
                title={`${TIER[kk].label} buys got ${m.rowTotals[kk]} kills (${totalPct(m.rowTotals[kk])}% of all)`}
                className="grid h-11 place-items-center rounded bg-panel/60 text-[11px] font-bold tabular-nums text-muted lg:h-9"
              >
                {m.rowTotals[kk] || "·"}
              </div>
            </Fragment>
          ))}

          {/* totals row: deaths by victim buy + grand total */}
          <div className="flex items-center justify-center text-[10px] font-bold uppercase text-faint">Σ</div>
          {BUY_KEYS.map((vk) => (
            <div
              key={vk}
              title={`${TIER[vk].label} buys were killed ${m.colTotals[vk]} times`}
              className="grid h-8 place-items-center rounded bg-panel/60 text-[11px] font-bold tabular-nums text-muted"
            >
              {m.colTotals[vk] || "·"}
            </div>
          ))}
          <div className="grid h-8 place-items-center rounded bg-brand/10 text-[11px] font-black tabular-nums text-brand">
            {m.total}
          </div>
        </div>
      </div>
      <div className="mt-2 text-[10px] text-faint">
        Rows = killer&apos;s buy, columns = the victim&apos;s. Cells above the diagonal (green ring) = the killer
        was on a cheaper buy than who they killed. Σ = kills by that buy (row) / deaths on it (column).
      </div>
    </div>
  );
}

// --- kill / death map (marks/heat · weapon-class · phase + HS filters) -------

const CLASS_CHIPS: { key: WeaponClass | "all"; label: string; color: string }[] = [
  { key: "all", label: "All", color: "var(--color-muted)" },
  { key: "rifle", label: "Rifles", color: "#f5694a" },
  { key: "sniper", label: "Snipers", color: "#46d369" },
  { key: "smg", label: "SMGs", color: "#8a7dff" },
  { key: "pistol", label: "Pistols", color: "#f5b942" },
  { key: "heavy", label: "Heavy", color: "#9bb0c8" },
];

type MapPhase = "any" | "opening" | "postplant";
const PHASES: { key: MapPhase; label: string; title: string }[] = [
  { key: "any", label: "Any time", title: "Every kill in the scope" },
  { key: "opening", label: "Opening", title: "Only the round's first duel (the opening pick)" },
  { key: "postplant", label: "Post-plant", title: "Only kills after the bomb was planted" },
];

type BuyTier = "any" | "full" | "force" | "eco";
const BUY_TIERS: { key: BuyTier; label: string; match: (b: string) => boolean; title: string }[] = [
  { key: "any", label: "Any buy", match: () => true, title: "Every buy tier" },
  { key: "full", label: "Full", match: (b) => b === "full", title: "The killer/victim was on a full buy" },
  { key: "force", label: "Force", match: (b) => b === "force", title: "…on a force buy" },
  { key: "eco", label: "Eco", match: (b) => b === "eco" || b === "semi", title: "…on an eco / light buy" },
];

type DistBand = "any" | "close" | "mid" | "long";
const DISTS: { key: DistBand; label: string; test: (m: number) => boolean; title: string }[] = [
  { key: "any", label: "Any range", test: () => true, title: "Every engagement distance" },
  { key: "close", label: "Close", test: (m) => m < 10, title: "Under ~10m — close quarters" },
  { key: "mid", label: "Mid", test: (m) => m >= 10 && m < 22, title: "~10–22m" },
  { key: "long", label: "Long", test: (m) => m >= 22, title: "Over ~22m — long range" },
];

// special-kill flag filters (wallbang / through smoke / attacker blind /
// noscope). Absent on old parses — the chips hide entirely when the scoped
// kills carry none of these flags, rather than showing dead toggles.
type SpecialFlag = "wb" | "ts" | "bl" | "ns";
const SPECIALS: { key: SpecialFlag; label: string; title: string }[] = [
  { key: "wb", label: "Wallbang", title: "Only wallbang kills — the bullet penetrated an object" },
  { key: "ts", label: "Smoke", title: "Only kills through smoke" },
  { key: "bl", label: "Blind", title: "Only kills landed while the attacker was flashed" },
  { key: "ns", label: "Noscope", title: "Only noscope kills — a scoped weapon fired unscoped" },
];
const NO_SPECIALS: Record<SpecialFlag, boolean> = { wb: false, ts: false, bl: false, ns: false };

const TRADE_WINDOW = 5; // seconds — a kill is "traded" if the killer dies within this

function DuelMap({
  meta,
  rounds,
  view,
  weaponSel,
  onClearWeapon,
}: {
  meta: ReplayMeta;
  rounds: ReplayRound[];
  view: DemoView;
  weaponSel: { key: string; label: string; color: string; mode: "kills" | "deaths" } | null;
  onClearWeapon: () => void;
}) {
  const proj = useMemo(() => buildProjection(meta.map, rounds), [meta, rounds]);
  const calibrated = proj.calibrated;
  const zones = useMemo(() => (calibrated ? getActiveZones(meta.map) : []), [calibrated, meta.map]);
  const [mode, setMode] = useState<"kills" | "deaths">("kills");
  const [cls, setCls] = useState<WeaponClass | "all">("all");
  const [angle, setAngle] = useState(false);
  const [render, setRender] = useState<"marks" | "heat">("marks");
  const [phase, setPhase] = useState<MapPhase>("any");
  const [buy, setBuy] = useState<BuyTier>("any");
  const [dist, setDist] = useState<DistBand>("any");
  const [hsOnly, setHsOnly] = useState(false);
  const [tradedOnly, setTradedOnly] = useState(false);
  const [specials, setSpecials] = useState<Record<SpecialFlag, boolean>>(NO_SPECIALS);

  // whether the scoped kills carry ANY special-kill flags (old parses lack
  // them) — when none exist we hide the four chips and never apply the filter.
  const hasSpecials = useMemo(() => {
    const scoped = view.scopeRound != null && rounds[view.scopeRound] ? [rounds[view.scopeRound]] : rounds;
    return scoped.some((r) => (r.kills ?? []).some((k) => k.wb || k.ts || k.bl || k.ns));
  }, [rounds, view.scopeRound]);

  // a weapon picked from the kill/death panels drives the map (its own mode);
  // otherwise the map uses its local mode + class-chip filter.
  const activeMode = weaponSel ? weaponSel.mode : mode;

  const plot = useMemo(() => {
    const scoped = view.scopeRound != null && rounds[view.scopeRound] ? [rounds[view.scopeRound]] : rounds;
    const out: { vx: number; vy: number; kx: number | null; ky: number | null; color: string }[] = [];
    const spots = new Map<string, number>(); // callout → kills there (calibrated only)
    const buyMatch = BUY_TIERS.find((t) => t.key === buy)!.match;
    const distTest = DISTS.find((d) => d.key === dist)!.test;
    for (const r of scoped) {
      const kills = r.kills ?? [];
      // opening kill = earliest enemy kill of the round (first blood)
      let openT = Infinity;
      for (const k of kills) {
        if (k.k < 0 || k.v < 0) continue;
        const ks = sideOf(r, k.k, meta);
        if (ks && ks !== sideOf(r, k.v, meta) && k.t < openT) openT = k.t;
      }
      const plantT = (r.bomb ?? []).find((b) => b.k === "plant")?.t ?? null;
      for (const k of kills) {
        if (k.k < 0) continue;
        const subj = activeMode === "kills" ? k.k : k.v;
        if (subj < 0) continue;
        if (view.focusPlayer != null && subj !== view.focusPlayer) continue;
        if (view.side !== "all" && sideOf(r, subj, meta) !== view.side) continue;
        const wm = weaponMeta(k.w);
        if (weaponSel) {
          if (wm.key !== weaponSel.key) continue;
        } else if (cls !== "all" && wm.cls !== cls) continue;
        if (hsOnly && !k.hs) continue;
        if (hasSpecials && SPECIALS.some((s) => specials[s.key] && !k[s.key])) continue;
        if (phase === "opening" && k.t !== openT) continue;
        if (phase === "postplant" && (plantT == null || k.t < plantT)) continue;
        if (buy !== "any") {
          // the subject's buy that round (killer in kills mode, victim in deaths)
          const st = r.stats?.find((s) => s.i === subj);
          const bk = st?.buy ?? (st?.equip != null ? classifyBuy(st.equip, r.n).key : null);
          if (!bk || !buyMatch(bk)) continue;
        }
        if (dist !== "any") {
          const m = Math.hypot(k.kx - k.vx, k.ky - k.vy) * UNIT_TO_M;
          if (!distTest(m)) continue;
        }
        if (tradedOnly) {
          // The kill was traded if its killer dies to an ENEMY within the trade
          // window (inclusive — same-tick mutual frags count). This tags the
          // kill that GOT traded; the feeds' TRADE pill tags the avenging kill
          // of the same pair (see lib/demo/killContext.ts).
          const traded = kills.some(
            (k2) =>
              k2 !== k &&
              k2.k >= 0 &&
              k2.v === k.k &&
              sideOf(r, k2.k, meta) !== "" &&
              sideOf(r, k2.k, meta) !== sideOf(r, k2.v, meta) &&
              k2.t >= k.t &&
              k2.t - k.t <= TRADE_WINDOW,
          );
          if (!traded) continue;
        }
        const v = proj.project(k.vx, k.vy);
        if (!v) continue;
        const kp = proj.project(k.kx, k.ky);
        out.push({ vx: v.x * 100, vy: v.y * 100, kx: kp ? kp.x * 100 : null, ky: kp ? kp.y * 100 : null, color: wm.color });
        if (zones.length) {
          const z = classifyPosition(meta.map, k.vx, k.vy, zones);
          if (z?.name) spots.set(z.name, (spots.get(z.name) ?? 0) + 1);
        }
      }
    }
    const callouts = [...spots.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
    return { pts: out, callouts };
  }, [meta, rounds, proj, zones, view.scopeRound, view.side, view.focusPlayer, activeMode, cls, weaponSel, phase, buy, dist, hsOnly, tradedOnly, specials, hasSpecials]);

  const marks = plot.pts;
  const specialOn = hasSpecials && SPECIALS.some((s) => specials[s.key]);
  const anyFilter = cls !== "all" || phase !== "any" || buy !== "any" || dist !== "any" || hsOnly || tradedOnly || specialOn;
  const resetFilters = () => {
    setCls("all");
    setPhase("any");
    setBuy("any");
    setDist("any");
    setHsOnly(false);
    setTradedOnly(false);
    setSpecials(NO_SPECIALS);
    onClearWeapon();
  };

  // --- pan / zoom / fullscreen -----------------------------------------------
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [full, setFull] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  zoomRef.current = zoom;
  panRef.current = pan;

  const clampZoom = (z: number) => Math.min(6, Math.max(1, z));
  // keep the (origin-top-left, scaled) content covering the box so panning never
  // reveals dead space: x/y ∈ [-(z-1)*size, 0].
  const clampPan = (p: { x: number; y: number }, z: number, s: number) => {
    const min = -(z - 1) * s;
    return { x: Math.max(min, Math.min(0, p.x)), y: Math.max(min, Math.min(0, p.y)) };
  };
  const zoomBy = (factor: number) => {
    const s = boxRef.current?.getBoundingClientRect().width ?? 0;
    const nz = clampZoom(zoom * factor);
    const k = nz / zoom;
    const c = s / 2; // zoom toward the centre for the buttons
    setPan(clampPan({ x: c - (c - pan.x) * k, y: c - (c - pan.y) * k }, nz, s));
    setZoom(nz);
  };
  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };
  const onDown = (e: React.PointerEvent) => {
    if (zoom <= 1) return;
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const s = boxRef.current?.getBoundingClientRect().width ?? 0;
    setPan(clampPan({ x: dragRef.current.px + (e.clientX - dragRef.current.x), y: dragRef.current.py + (e.clientY - dragRef.current.y) }, zoom, s));
  };
  const onUp = () => {
    dragRef.current = null;
  };

  // wheel zoom toward the cursor (native, non-passive so we can preventDefault)
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // inline, only zoom on Ctrl/⌘+scroll so the page can still scroll past the
      // map; fullscreen zooms on any scroll.
      if (!full && !e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const box = el.getBoundingClientRect();
      const cx = e.clientX - box.left;
      const cy = e.clientY - box.top;
      const z = zoomRef.current;
      const p = panRef.current;
      const nz = clampZoom(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
      if (nz === z) return;
      const k = nz / z;
      setPan(clampPan({ x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k }, nz, box.width));
      setZoom(nz);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [full]);

  // Escape exits fullscreen; lock body scroll while fullscreen
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [full]);

  const focusName = view.focusPlayer != null ? meta.players[view.focusPlayer]?.name : null;
  const heatColor =
    weaponSel?.color ?? (cls !== "all" ? CLASS_CHIPS.find((c) => c.key === cls)?.color ?? "#ff7a45" : "#ff7a45");
  const filterNote = [
    phase !== "any" ? PHASES.find((p) => p.key === phase)?.label.toLowerCase() : null,
    buy !== "any" ? `${buy} buy` : null,
    dist !== "any" ? `${dist} range` : null,
    hsOnly ? "HS" : null,
    tradedOnly ? "traded" : null,
    ...SPECIALS.filter((s) => hasSpecials && specials[s.key]).map((s) => s.label.toLowerCase()),
  ].filter(Boolean).join(" · ");

  return (
    // Inline: a natural-height card. Fullscreen: a fixed overlay filling the
    // viewport, with the same controls and a height-filled square map. Scroll to
    // zoom (toward the cursor), drag to pan, double-click to toggle zoom.
    <div
      className={
        full
          ? "fixed inset-0 z-50 flex flex-col gap-2 bg-bg/95 p-3 backdrop-blur-sm sm:p-4"
          : "card-2 p-3 lg:flex lg:min-w-0 lg:flex-col"
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 lg:shrink-0">
        <span className="stat-label">{activeMode === "kills" ? "Kill positions" : "Death positions"}</span>
        <div className="flex rounded-lg border border-line bg-panel p-0.5 text-[11px]">
          {(["kills", "deaths"] as const).map((mm) => (
            <button
              key={mm}
              type="button"
              onClick={() => {
                onClearWeapon(); // manual mode toggle leaves the weapon drilldown
                setMode(mm);
              }}
              aria-pressed={activeMode === mm}
              className={`rounded-md px-2 py-0.5 font-medium capitalize transition ${
                activeMode === mm ? "bg-brand/15 text-brand" : "text-muted hover:text-ink"
              }`}
            >
              {mm}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg border border-line bg-panel p-0.5 text-[11px]">
          {(["marks", "heat"] as const).map((rr) => (
            <button
              key={rr}
              type="button"
              onClick={() => setRender(rr)}
              aria-pressed={render === rr}
              title={rr === "heat" ? "Density heatmap — brighter = more kills here" : "Individual ✕ markers"}
              className={`rounded-md px-2 py-0.5 font-medium capitalize transition ${
                render === rr ? "bg-brand/15 text-brand" : "text-muted hover:text-ink"
              }`}
            >
              {rr}
            </button>
          ))}
        </div>
        {render === "marks" && (
          <button
            type="button"
            onClick={() => setAngle((a) => !a)}
            aria-pressed={angle}
            title="Show the shot angle line on each marker"
            className={`rounded-md border px-2 py-0.5 text-[11px] transition ${
              angle ? "border-brand/50 bg-brand/15 text-brand" : "border-line text-muted hover:text-ink"
            }`}
          >
            angle line
          </button>
        )}
        <span className="ml-auto text-[10px] text-faint">
          {marks.length} {activeMode} · {focusName ? focusName : view.side !== "all" ? `${view.side} side` : "match"}
        </span>
      </div>

      {/* weapon drilldown chip (from the kills/deaths panels) OR class chips */}
      {weaponSel ? (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 lg:shrink-0">
          <span className="text-[10px] text-faint">Showing</span>
          <button
            type="button"
            onClick={() => {
              setMode(activeMode); // keep the map on this mode after clearing
              onClearWeapon();
            }}
            title="Clear weapon filter"
            className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold transition hover:brightness-110"
            style={{ background: `${weaponSel.color}22`, color: weaponSel.color }}
          >
            {weaponSel.label} {activeMode} <span className="opacity-70">✕</span>
          </button>
        </div>
      ) : (
        <div className="mb-2 flex flex-wrap gap-1 lg:shrink-0">
          {CLASS_CHIPS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCls(c.key)}
              aria-pressed={cls === c.key}
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
                cls === c.key ? "border-current" : "border-line text-muted hover:text-ink"
              }`}
              style={cls === c.key ? { color: c.color } : undefined}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* phase · buy tier · headshot filters — all compose with each other */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5 lg:shrink-0">
        <div className="flex rounded-lg border border-line bg-panel p-0.5 text-[10px]">
          {PHASES.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPhase(p.key)}
              aria-pressed={phase === p.key}
              title={p.title}
              className={`rounded-md px-1.5 py-0.5 font-medium transition ${
                phase === p.key ? "bg-brand/15 text-brand" : "text-muted hover:text-ink"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg border border-line bg-panel p-0.5 text-[10px]">
          {BUY_TIERS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setBuy(t.key)}
              aria-pressed={buy === t.key}
              title={t.title}
              className={`rounded-md px-1.5 py-0.5 font-medium transition ${
                buy === t.key ? "bg-brand/15 text-brand" : "text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg border border-line bg-panel p-0.5 text-[10px]">
          {DISTS.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => setDist(d.key)}
              aria-pressed={dist === d.key}
              title={d.title}
              className={`rounded-md px-1.5 py-0.5 font-medium transition ${
                dist === d.key ? "bg-brand/15 text-brand" : "text-muted hover:text-ink"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setHsOnly((h) => !h)}
          aria-pressed={hsOnly}
          title="Headshot kills only"
          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
            hsOnly ? "border-bad/50 bg-bad/15 text-bad" : "border-line text-muted hover:text-ink"
          }`}
        >
          HS only
        </button>
        <button
          type="button"
          onClick={() => setTradedOnly((t) => !t)}
          aria-pressed={tradedOnly}
          title={`Only kills that were traded — the killer died within ${TRADE_WINDOW}s (over-extended picks)`}
          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
            tradedOnly ? "border-good/50 bg-good/15 text-good" : "border-line text-muted hover:text-ink"
          }`}
        >
          Traded
        </button>
        {hasSpecials &&
          SPECIALS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSpecials((prev) => ({ ...prev, [s.key]: !prev[s.key] }))}
              aria-pressed={specials[s.key]}
              title={s.title}
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
                specials[s.key] ? "border-brand/50 bg-brand/15 text-brand" : "border-line text-muted hover:text-ink"
              }`}
            >
              {s.label}
            </button>
          ))}
        {(anyFilter || weaponSel) && (
          <button
            type="button"
            onClick={resetFilters}
            title="Clear every map filter"
            className="rounded-full border border-line px-2 py-0.5 text-[10px] font-medium text-muted transition hover:border-brand/50 hover:text-brand"
          >
            ⟲ Reset
          </button>
        )}
      </div>

      <div className={full ? "flex min-h-0 flex-1 items-center justify-center" : "contents"}>
      <div
        ref={boxRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        onDoubleClick={() => (zoom > 1 ? resetView() : zoomBy(1.8))}
        className={`relative select-none touch-none overflow-hidden rounded-xl border border-line bg-panel2 ${
          zoom > 1 ? (dragRef.current ? "cursor-grabbing" : "cursor-grab") : ""
        } ${full ? "mx-auto aspect-square h-full max-h-full w-auto max-w-full" : "mx-auto aspect-square w-full max-w-xl lg:max-w-none"}`}
      >
        {/* pan/zoom transform layer — radar + marks move & scale together */}
        <div className="absolute inset-0 origin-top-left" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          {calibrated ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={radarImage(meta.map)} alt={`${meta.map} radar`} className="absolute inset-0 h-full w-full object-cover opacity-90" draggable={false} />
          ) : (
            <div className="absolute inset-0 bg-[#0a1020]" />
          )}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            <defs>
              <filter id="wxHeatBlur" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="2.3" />
              </filter>
            </defs>
            {render === "heat" ? (
              // overlapping blurred blobs, screen-blended so hotspots glow brighter
              <g filter="url(#wxHeatBlur)" style={{ mixBlendMode: "screen" }}>
                {marks.map((mk, i) => (
                  <circle key={i} cx={mk.vx} cy={mk.vy} r={3.4} fill={heatColor} opacity={0.32} />
                ))}
              </g>
            ) : (
              <>
                {angle &&
                  marks.map((mk, i) =>
                    mk.kx != null && mk.ky != null ? (
                      // engagement line: shooter dot (•) → victim (✕). The dot marks
                      // WHERE the shot came from so the direction is unambiguous.
                      <g key={`l${i}`}>
                        <line x1={mk.kx} y1={mk.ky} x2={mk.vx} y2={mk.vy} stroke={mk.color} strokeWidth={0.28} opacity={0.5} />
                        <circle cx={mk.kx} cy={mk.ky} r={0.75} fill={mk.color} opacity={0.85} />
                      </g>
                    ) : null,
                  )}
                {marks.map((mk, i) => (
                  <g key={i} stroke={mk.color} strokeWidth={0.55} strokeLinecap="round">
                    <line x1={mk.vx - 1.2} y1={mk.vy - 1.2} x2={mk.vx + 1.2} y2={mk.vy + 1.2} />
                    <line x1={mk.vx + 1.2} y1={mk.vy - 1.2} x2={mk.vx - 1.2} y2={mk.vy + 1.2} />
                  </g>
                ))}
              </>
            )}
          </svg>
        </div>

        {/* zoom / fullscreen controls — pinned to the corner, never transformed.
            stopPropagation so a button press never starts a map pan/zoom drag
            (which would capture the pointer and swallow the click). */}
        <div
          className="absolute right-2 top-2 z-10 flex flex-col gap-1"
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={() => zoomBy(1.35)} title={full ? "Zoom in (scroll)" : "Zoom in (Ctrl+scroll)"} aria-label="Zoom in" className="grid h-7 w-7 place-items-center rounded-md bg-black/55 text-base leading-none text-ink backdrop-blur transition hover:bg-black/75">+</button>
          <button type="button" onClick={() => zoomBy(1 / 1.35)} title={full ? "Zoom out (scroll)" : "Zoom out (Ctrl+scroll)"} aria-label="Zoom out" className="grid h-7 w-7 place-items-center rounded-md bg-black/55 text-base leading-none text-ink backdrop-blur transition hover:bg-black/75">−</button>
          {(zoom > 1 || pan.x !== 0 || pan.y !== 0) && (
            <button type="button" onClick={resetView} title="Reset zoom" aria-label="Reset zoom" className="grid h-7 w-7 place-items-center rounded-md bg-black/55 text-xs leading-none text-ink backdrop-blur transition hover:bg-black/75">⟲</button>
          )}
          <button
            type="button"
            onClick={() => setFull((f) => !f)}
            title={full ? "Exit fullscreen (Esc)" : "Fullscreen"}
            aria-label={full ? "Exit fullscreen" : "Fullscreen"}
            className="grid h-7 w-7 place-items-center rounded-md bg-black/55 text-xs leading-none text-ink backdrop-blur transition hover:bg-black/75"
          >
            {full ? "✕" : "⛶"}
          </button>
        </div>

        {zoom > 1 && (
          <div className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] tabular-nums text-ink backdrop-blur">
            {zoom.toFixed(1)}× · drag to pan
          </div>
        )}

        {marks.length === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center gap-2 px-4 text-center text-xs text-muted">
            <span>No {activeMode} for the current filter{filterNote ? ` (${filterNote})` : ""}.</span>
            {(anyFilter || weaponSel) && (
              <button
                type="button"
                onClick={resetFilters}
                className="pointer-events-auto rounded-full border border-brand/50 bg-brand/10 px-3 py-1 text-[11px] font-semibold text-brand transition hover:bg-brand/20"
              >
                ⟲ Clear filters
              </button>
            )}
          </div>
        )}
        {!calibrated && (
          <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-mid/15 px-2 py-0.5 text-[10px] text-mid">
            {meta.map} uncalibrated — auto-scaled
          </div>
        )}
      </div>
      </div>

      {/* top named callouts for the current filtered set — where these
          kills/deaths actually concentrate (calibrated maps only) */}
      {plot.callouts.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 lg:shrink-0">
          <span className="text-[10px] uppercase tracking-wider text-faint">Top spots</span>
          {plot.callouts.slice(0, 4).map((c) => (
            <span
              key={c.name}
              className="rounded-full bg-panel px-2 py-0.5 text-[10px] tabular-nums text-muted"
              title={`${c.n} ${activeMode} at ${c.name}`}
            >
              {c.name} <span className="font-semibold text-ink">{c.n}</span>
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 text-[10px] text-faint lg:shrink-0">
        {render === "heat"
          ? `Density heatmap — brighter clusters = more ${activeMode} here${weaponSel ? ` with the ${weaponSel.label}` : ""}. `
          : `✕ = the victim's spot, coloured by weapon${angle ? "; the angle line runs from the shooter (•) to the victim" : " — toggle the angle line for the shot direction"}. `}
        Filter by phase (opening / post-plant), buy tier, range, headshots, or trades, and click a weapon in the Arsenal to isolate it.
        {" "}Zoom with +/− (or Ctrl+scroll), drag to pan, ⛶ for fullscreen.
      </div>
    </div>
  );
}

// --- head-to-head (player vs player) ---------------------------------------

// Focused-player head-to-head: their kill/death record vs every opponent, with
// the weapon they mostly beat each one with. Only renders when a player is
// focused — the old unscoped 10×10 net-frag matrix was dropped as clutter.
function HeadToHead({ meta, rounds, view }: { meta: ReplayMeta; rounds: ReplayRound[]; view: DemoView }) {
  const focus = view.focusPlayer;
  const roundFilter = useMemo(
    () => (view.scopeRound == null ? undefined : (_r: ReplayRound, idx: number) => idx === view.scopeRound),
    [view.scopeRound],
  );
  const duels = useMemo(
    () => (focus != null ? computeDuels(meta, rounds, focus, roundFilter) : []),
    [meta, rounds, focus, roundFilter],
  );
  const focusName = focus != null ? meta.players[focus]?.name : null;
  if (focus == null) return null;

  return (
    <div className="card-2 px-5 py-4 lg:px-4 lg:py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="stat-label">Head-to-head · {focusName}</h3>
        <span className="text-[10px] text-faint">click to switch player</span>
      </div>
      {duels.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted">No duels in this scope.</div>
      ) : (
        <div className="grid gap-x-6 gap-y-1.5 lg:grid-cols-2">
          {duels.map((d) => {
            const tot = d.for + d.against || 1;
            const col = teamColor(d.opp.team);
            const netCol = d.net > 0 ? "var(--color-good)" : d.net < 0 ? "var(--color-bad)" : "var(--color-faint)";
            return (
              <button
                key={d.opp.i}
                type="button"
                onClick={() => view.setFocusPlayer(d.opp.i)}
                title={`${d.for} kills${d.forWeapon ? ` (mostly ${d.forWeapon.label})` : ""} · ${d.against} deaths${d.againstWeapon ? ` (mostly ${d.againstWeapon.label})` : ""}`}
                className="flex w-full items-center gap-2 rounded px-1 py-1 text-left transition hover:bg-panel/60"
              >
                <span className="w-28 shrink-0 truncate text-[12px] font-semibold" style={{ color: col }}>
                  {d.opp.name}
                </span>
                <span className="w-12 shrink-0 text-right text-[12px] tabular-nums">
                  <span className="font-bold text-good">{d.for}</span>
                  <span className="text-faint">–</span>
                  <span className="font-bold text-bad">{d.against}</span>
                </span>
                <span className="relative flex h-2 flex-1 overflow-hidden rounded-full bg-panel">
                  <span className="h-full" style={{ width: `${(d.for / tot) * 100}%`, background: "var(--color-good)" }} />
                  <span className="h-full" style={{ width: `${(d.against / tot) * 100}%`, background: "var(--color-bad)" }} />
                </span>
                {d.forWeapon && <WeaponBadge w={d.forWeapon} size={14} />}
                <span className="w-9 shrink-0 text-right text-[12px] font-bold tabular-nums" style={{ color: netCol }}>
                  {d.net > 0 ? `+${d.net}` : d.net}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="mt-2 text-[10px] text-faint">
        <span className="text-good">green</span> = {focusName}&apos;s kills, <span className="text-bad">red</span> = deaths to them. Spans the whole match (duels cross sides).
      </div>
    </div>
  );
}

// --- team gunfights (CT vs T aggregate comparison) --------------------------

function TeamCompare({
  ct,
  t,
  openings,
  acc,
}: {
  ct: WeaponInsightsData;
  t: WeaponInsightsData;
  openings: { ctOpen: number; ctWon: number; tOpen: number; tWon: number };
  acc: { ct: BulletAcc; t: BulletAcc };
}) {
  const side = (data: WeaponInsightsData, s: "CT" | "T", open: number, won: number, a: BulletAcc) => {
    const hex = s === "T" ? T : CT;
    const soft = s === "T" ? "#f0cd78" : "#9cc1ff";
    return (
      <div className="min-w-0 space-y-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: hex }} />
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: soft }}>
            {s}
          </span>
          <span className="ml-auto text-2xl font-extrabold tabular-nums text-ink">
            {data.totalKills}
            <span className="ml-1 text-[10px] font-normal text-faint">kills</span>
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-panel/50 px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wider text-faint">Headshot</div>
            <div className="text-sm font-bold tabular-nums" style={{ color: hsColor(data.overallHsPct) }}>
              {data.overallHsPct.toFixed(0)}%
            </div>
          </div>
          <div
            className="rounded-lg bg-panel/50 px-2 py-1.5"
            title={
              a.shots
                ? `bullets that dealt damage ÷ bullets fired by ${s} players: ${a.hits}/${a.shots}`
                : "no shot data for this scope (re-parse the demo)"
            }
          >
            <div className="text-[9px] uppercase tracking-wider text-faint">Accuracy</div>
            <div className="text-sm font-bold tabular-nums text-ink">{pctOr(a.hits, a.shots)}</div>
          </div>
          <div
            className="col-span-2 rounded-lg bg-panel/50 px-2 py-1.5"
            title="the round's first duel, won = the side went on to win the round"
          >
            <div className="text-[9px] uppercase tracking-wider text-faint">Opening picks</div>
            <div className="text-sm font-bold tabular-nums text-ink">
              {open ? `${won}/${open}` : "—"}
              {open > 0 && <span className="ml-1 text-[10px] font-normal text-faint">{Math.round((won / open) * 100)}% won</span>}
            </div>
          </div>
        </div>
        {data.classes.length > 0 && <ClassMix data={data} />}
        <div className="space-y-1">
          {data.weapons.slice(0, 3).map((w) => (
            <div key={w.key} className="flex items-center gap-2 text-[11px]">
              <WeaponBadge w={w} size={16} />
              <span className="truncate font-medium text-muted">{w.label}</span>
              <span className="ml-auto shrink-0 tabular-nums text-faint">
                {w.kills} · {w.hsPct.toFixed(0)}% HS
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };
  return (
    <div className="card-2 px-5 py-4 lg:px-4 lg:py-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="stat-label">Team gunfights · CT vs T</h3>
        <span className="text-[10px] text-faint">who&apos;s winning the guns</span>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:gap-5">
        <div className="border-r border-line pr-4 lg:pr-5">{side(ct, "CT", openings.ctOpen, openings.ctWon, acc.ct)}</div>
        <div>{side(t, "T", openings.tOpen, openings.tWon, acc.t)}</div>
      </div>
      <div className="mt-3 border-t border-line pt-2 text-[10px] text-faint">
        Aggregated by the side each player was on that round (both halves). Opening picks = the round&apos;s first duel;
        won = that side went on to win the round.
      </div>
    </div>
  );
}

// --- main -------------------------------------------------------------------

export default function WeaponInsights({ meta, rounds, view }: { meta: ReplayMeta; rounds: ReplayRound[]; view: DemoView }) {
  const roundSel = view.scopeRound;
  const focus = view.focusPlayer;

  // Arsenal lens (kills / deaths) + the weapon picked from it, which drives the
  // map. Both reset when the scope/side/focus changes (the kill set changed).
  const [lens, setLens] = useState<"kills" | "deaths">("kills");
  const [weaponSel, setWeaponSel] = useState<{ key: string; mode: "kills" | "deaths" } | null>(null);
  useEffect(() => {
    setWeaponSel(null);
    setLens("kills");
  }, [roundSel, view.side, focus]);
  const pickWeapon = (key: string, mode: "kills" | "deaths") =>
    setWeaponSel((s) => (s && s.key === key && s.mode === mode ? null : { key, mode }));

  const roundFilter = useMemo(
    () => (roundSel == null ? undefined : (_r: ReplayRound, idx: number) => idx === roundSel),
    [roundSel],
  );

  // offense = kills by weapon (scoped to focus); roster = all players (drilldown);
  // defense = deaths by weapon (what kills the scoped player/side).
  const offense = useMemo(() => computeWeaponInsights(meta, rounds, roundFilter, view.side, { by: "killer", focus }), [meta, rounds, roundFilter, view.side, focus]);
  const roster = useMemo(() => computeWeaponInsights(meta, rounds, roundFilter, view.side, { by: "killer", focus: null }), [meta, rounds, roundFilter, view.side]);
  const defense = useMemo(() => computeWeaponInsights(meta, rounds, roundFilter, view.side, { by: "victim", focus }), [meta, rounds, roundFilter, view.side, focus]);
  const nemesis = useMemo(() => (focus != null ? computeNemesis(meta, rounds, focus, roundFilter) : null), [meta, rounds, focus, roundFilter]);

  // bullet accuracy — shots/hits/headshot-hits summed from the per-round stats,
  // scoped exactly like the weapon computations above (round · side · focus).
  const acc = useMemo(() => accuracyOf(meta, rounds, roundFilter, view.side, focus), [meta, rounds, roundFilter, view.side, focus]);

  // per-weapon shots/hits (stats.wacc) under the same scope as the offense
  // list — feeds the "% acc" sub-stat on the Arsenal rows (kills lens).
  const weaponAcc = useMemo(() => weaponAccOf(meta, rounds, roundFilter, view.side, focus), [meta, rounds, roundFilter, view.side, focus]);

  // team gunfights — each side's fragging aggregated over the whole match
  // (both halves), independent of the side filter so it stays a real comparison.
  const teamCT = useMemo(() => computeWeaponInsights(meta, rounds, roundFilter, "CT", { by: "killer" }), [meta, rounds, roundFilter]);
  const teamT = useMemo(() => computeWeaponInsights(meta, rounds, roundFilter, "T", { by: "killer" }), [meta, rounds, roundFilter]);
  const teamAcc = useMemo(
    () => ({ ct: accuracyOf(meta, rounds, roundFilter, "CT", null), t: accuracyOf(meta, rounds, roundFilter, "T", null) }),
    [meta, rounds, roundFilter],
  );
  const openings = useMemo(() => {
    let ctOpen = 0, ctWon = 0, tOpen = 0, tWon = 0;
    rounds.forEach((r, idx) => {
      if (roundFilter && !roundFilter(r, idx)) return;
      let first: { t: number; k: number } | null = null;
      for (const k of r.kills ?? []) {
        if (k.k < 0 || k.v < 0) continue;
        const ks = sideOf(r, k.k, meta);
        if (ks && ks !== sideOf(r, k.v, meta) && (!first || k.t < first.t)) first = { t: k.t, k: k.k };
      }
      if (!first) return;
      const s = sideOf(r, first.k, meta);
      if (s === "CT") { ctOpen++; if (r.winner === "CT") ctWon++; }
      else if (s === "T") { tOpen++; if (r.winner === "T") tWon++; }
    });
    return { ctOpen, ctWon, tOpen, tWon };
  }, [meta, rounds, roundFilter]);

  // Unscoped, deaths-by-weapon exactly mirrors kills-by-weapon (every kill is
  // someone's death), so the Deaths lens and threat tile only mean something
  // once a player or side is scoped.
  const unscoped = focus == null && view.side === "all";
  const longest = useMemo(
    () => longestKillOf(meta, rounds, roundFilter, view.side, focus),
    [meta, rounds, roundFilter, view.side, focus],
  );

  const focusName = focus != null ? meta.players[focus]?.name : null;
  const scopeLabel = focusName ?? (view.side !== "all" ? `${view.side} side` : "the match");

  if (!roster.totalKills) {
    return (
      <div className="card-2 px-5 py-8 text-center text-sm text-muted">
        No kill data for {roundSel == null ? "this match" : `round ${rounds[roundSel]?.n}`}
        {view.side !== "all" ? ` (${view.side} side)` : ""}.
      </div>
    );
  }

  const scopeChips = [
    roundSel != null ? `Round ${rounds[roundSel]?.n}` : null,
    view.side !== "all" ? `${view.side} side` : null,
    focusName ? focusName : null,
  ].filter(Boolean);

  return (
    // Natural-height, page-scrolling layout (the lens pane scrolls). Capped +
    // centred on very wide panes so the two columns stay evenly proportioned
    // instead of stretching edge-to-edge. Two balanced columns fill the height.
    <section className="space-y-4 lg:space-y-3 xl:mx-auto xl:max-w-330">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand/15 text-brand">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <circle cx="12" cy="12" r="8" />
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
          </svg>
        </span>
        <h2 className="text-lg font-extrabold tracking-tight">Weapons</h2>
        <span className="text-xs text-faint">
          what {focusName ?? "the match"} kills with — and what kills {focusName ?? "them"}
        </span>
        {scopeChips.length > 0 && <span className="ml-auto pill bg-brand/15 text-brand">{scopeChips.join(" · ")} · scoped</span>}
      </div>

      {/* dual headline strip: offense + threat */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatPill tone="offense" label="Top weapon" value={offense.topWeapon ? offense.topWeapon.label : "—"} hint={offense.topWeapon ? `${offense.topWeapon.kills} kills · ${offense.topWeapon.hsPct.toFixed(0)}% HS` : undefined} hex={offense.topWeapon?.color} weapon={offense.topWeapon} />
        <StatPill tone="offense" label="Headshot rate" value={`${offense.overallHsPct.toFixed(0)}%`} hint={`${offense.totalHeadshots}/${offense.totalKills} kills`} hex={hsColor(offense.overallHsPct)} />
        <StatPill
          tone="offense"
          label="Accuracy"
          value={pctOr(acc.hits, acc.shots)}
          hint={acc.shots ? `${acc.hits}/${acc.shots} bullets hit` : "no shot data (re-parse)"}
          title={`Bullet accuracy — bullets that dealt damage ÷ bullets fired (firearms only) by ${scopeLabel} over the scoped rounds`}
        />
        <StatPill
          tone="offense"
          label="HS hits"
          value={pctOr(acc.hsHits, acc.hits)}
          hint={acc.hits ? `${acc.hsHits}/${acc.hits} hits to the head` : "no hit data (re-parse)"}
          title={`Headshot precision — headshot hits ÷ all connecting bullets by ${scopeLabel} (every hit counts, not just the kill shots)`}
        />
        <StatPill
          tone="offense"
          label="Longest kill"
          value={longest ? `${longest.d.toFixed(0)}m` : "—"}
          hint={longest ? `${longest.killer} → ${longest.victim} · ${longest.label} · R${longest.rn}` : undefined}
          hex={longest?.color}
          weapon={longest}
        />
        {focusName ? (
          <StatPill
            tone="threat"
            label="Nemesis"
            value={nemesis ? nemesis.name : "—"}
            hint={nemesis ? `killed you ${nemesis.deaths}× · ${nemesis.weapon.label}` : "never died"}
            hex={nemesis ? teamColor(nemesis.team) : undefined}
          />
        ) : (
          <StatPill
            tone="offense"
            label="Deadliest player"
            value={roster.deadliestPlayer ? roster.deadliestPlayer.name : "—"}
            hint={roster.deadliestPlayer ? `${roster.deadliestPlayer.totalKills} kills` : undefined}
            hex={roster.deadliestPlayer ? teamColor(roster.deadliestPlayer.team) : undefined}
          />
        )}
      </div>

      {/* round highlights — multi-kill chips (jump the workspace) + opener
          conversion, the pro's first scan of a match */}
      <RoundHighlights meta={meta} rounds={rounds} view={view} />

      {/* main analysis — two evenly-matched columns: LEFT stacks the two
          compact panels (Arsenal + economy ladder ≈ the map's height), RIGHT is
          the map (hero). The team / head-to-head summary spans full width below,
          so no column is left with dangling whitespace. */}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {/* left: arsenal → economy (stacked to match the map's height) */}
        <div className="space-y-4">
          <Arsenal
            offense={offense}
            defense={defense}
            unscoped={unscoped}
            scopeLabel={scopeLabel}
            lens={lens}
            onLens={(l) => {
              setLens(l);
              setWeaponSel(null);
            }}
            selectedWeapon={weaponSel && weaponSel.mode === lens ? weaponSel.key : null}
            onSelectWeapon={(k) => pickWeapon(k, lens)}
            weaponAcc={weaponAcc}
          />
          <BuyMatrixCard meta={meta} rounds={rounds} view={view} />
        </div>

        {/* right: the map (hero), driven by the shared weapon selection */}
        <DuelMap
          meta={meta}
          rounds={rounds}
          view={view}
          weaponSel={
            weaponSel
              ? { key: weaponSel.key, mode: weaponSel.mode, label: weaponMeta(weaponSel.key).label, color: weaponMeta(weaponSel.key).color }
              : null
          }
          onClearWeapon={() => setWeaponSel(null)}
        />
      </div>

      {/* full-width summary: CT-vs-T gunfights, or the focused player's
          head-to-head. Spanning both columns keeps the bottom edge even. */}
      {focus != null ? (
        <HeadToHead meta={meta} rounds={rounds} view={view} />
      ) : (
        <TeamCompare ct={teamCT} t={teamT} openings={openings} acc={teamAcc} />
      )}

      <p className="text-[10px] leading-relaxed text-faint">
        Derived from kill events (killer · weapon · headshot · positions) plus per-round buy values. A kill
        records only the killer&apos;s weapon, so the Deaths lens means what killed a player, never their own gun.
        Click any weapon to plot exactly those kills on the map. The economy ladder needs per-round buy data
        (re-parse older demos). For grenade usage see the Utility tab; for playstyle reads, Tendencies.
      </p>
    </section>
  );
}
