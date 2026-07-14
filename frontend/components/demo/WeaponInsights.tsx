"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import {
  computeWeaponInsights,
  computeBuyMatrix,
  computeNemesis,
  computeDuels,
  computeDuelMatrix,
  weaponMeta,
  type PlayerWeaponStat,
  type WeaponStat,
  type WeaponInsightsData,
  type WeaponClass,
} from "@/lib/demo/weapons";
import { BUY_KEYS, type BuyKey } from "@/lib/demo/economy";
import { buildProjection } from "@/lib/demo/projection";
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
}: {
  label: string;
  value: string;
  hint?: string;
  hex?: string;
  tone?: "offense" | "threat";
  weapon?: Pick<WeaponStat, "label" | "color"> | null; // when set, shows a weapon badge beside the value
}) {
  return (
    <div className="card px-4 py-3 lg:px-3 lg:py-2">
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

// weapon bar: bar = count, pill = headshot %. `unit` is K (kills) or D (deaths).
// Clicking it plots exactly those kills/deaths on the map (selected = ring).
function WeaponRow({
  w,
  max,
  unit = "K",
  selected = false,
  onSelect,
}: {
  w: WeaponStat;
  max: number;
  unit?: string;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const pct = max ? (w.kills / max) * 100 : 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={onSelect ? !!selected : undefined}
      title={onSelect ? `Show ${w.label} ${unit === "D" ? "deaths" : "kills"} on the map` : undefined}
      className={`group block w-full rounded-lg px-1.5 py-1 text-left transition ${
        selected ? "bg-panel/70" : "hover:bg-panel/40"
      }`}
      style={selected ? { boxShadow: `inset 0 0 0 1px ${w.color}` } : undefined}
    >
      <div className="mb-1 flex items-center gap-2">
        <WeaponBadge w={w} />
        <span className="text-sm font-semibold text-ink">{w.label}</span>
        {selected ? (
          <span className="rounded-full px-1.5 text-[9px] font-bold uppercase tracking-wider" style={{ background: `${w.color}22`, color: w.color }}>
            on map
          </span>
        ) : (
          onSelect && (
            <span className="hidden text-[9px] font-semibold uppercase tracking-wider text-faint group-hover:inline">
              → map
            </span>
          )
        )}
        <span className="ml-auto flex items-center gap-2 text-xs tabular-nums">
          <span className="text-faint">{w.kills} {unit}</span>
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
        <div
          className="absolute inset-y-0 left-0 rounded-full opacity-90"
          style={{ width: `${(pct * w.hsPct) / 100}%`, background: "linear-gradient(90deg, transparent, rgba(255,255,255,.35))" }}
        />
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

// one weapon panel: kills OR deaths by weapon + a class mix. The dual-lens core.
function WeaponPanel({
  title,
  subtitle,
  data,
  unit,
  empty,
  selectedWeapon,
  onSelectWeapon,
}: {
  title: string;
  subtitle: string;
  data: WeaponInsightsData;
  unit: string;
  empty: string;
  selectedWeapon?: string | null;
  onSelectWeapon?: (key: string) => void;
}) {
  const max = data.weapons[0]?.kills ?? 1;
  return (
    <div className="card-2 px-5 py-4 lg:flex lg:h-full lg:min-h-0 lg:min-w-0 lg:flex-col lg:px-4 lg:py-3">
      <div className="mb-3 flex items-center justify-between lg:mb-2 lg:shrink-0">
        <h3 className="stat-label">{title}</h3>
        <span className="text-[10px] text-faint">{subtitle}</span>
      </div>
      {data.weapons.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted lg:my-auto">{empty}</div>
      ) : (
        <>
          <div className="scroll-slim space-y-1.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
            {data.weapons.slice(0, 8).map((w) => (
              <WeaponRow
                key={w.key}
                w={w}
                max={max}
                unit={unit}
                selected={selectedWeapon === w.key}
                onSelect={onSelectWeapon ? () => onSelectWeapon(w.key) : undefined}
              />
            ))}
          </div>
          <div className="mt-4 border-t border-line pt-3 lg:mt-3 lg:shrink-0">
            <div className="stat-label mb-2">Class mix</div>
            <ClassMix data={data} />
          </div>
        </>
      )}
    </div>
  );
}

// --- range profile (unscoped only) ------------------------------------------
// Per-weapon engagement distances from the kill coordinates. Replaces the
// "Deaths by weapon" panel when nothing is scoped — in that state deaths-by-
// weapon is an exact mirror of kills-by-weapon (every kill is someone's death),
// so this shows fresh signal instead of a duplicate list.

const UNIT_TO_M = 0.01905; // CS2 world units → meters (16u ≈ 1ft)

interface RangeRow {
  key: string;
  label: string;
  color: string;
  avg: number; // meters
  max: number;
  n: number;
}
export interface RangeData {
  rows: RangeRow[];
  overallAvg: number;
  longest: { d: number; key: string; label: string; color: string; killer: string; victim: string; rn: number } | null;
}

function computeRangeData(
  meta: ReplayMeta,
  rounds: ReplayRound[],
  roundFilter?: (r: ReplayRound, idx: number) => boolean,
): RangeData {
  const per = new Map<string, { sum: number; n: number; max: number }>();
  let longest: RangeData["longest"] = null;
  let sumAll = 0;
  let nAll = 0;
  rounds.forEach((r, idx) => {
    if (roundFilter && !roundFilter(r, idx)) return;
    for (const k of r.kills ?? []) {
      if (k.k < 0 || !k.w) continue;
      const d = Math.hypot(k.kx - k.vx, k.ky - k.vy) * UNIT_TO_M;
      const e = per.get(k.w) ?? { sum: 0, n: 0, max: 0 };
      e.sum += d;
      e.n++;
      if (d > e.max) e.max = d;
      per.set(k.w, e);
      sumAll += d;
      nAll++;
      if (!longest || d > longest.d) {
        const wm = weaponMeta(k.w);
        longest = {
          d,
          key: k.w,
          label: wm.label,
          color: wm.color,
          killer: meta.players[k.k]?.name ?? "?",
          victim: meta.players[k.v]?.name ?? "?",
          rn: r.n,
        };
      }
    }
  });
  const rows: RangeRow[] = [...per.entries()]
    .map(([key, e]) => {
      const wm = weaponMeta(key);
      return { key, label: wm.label, color: wm.color, avg: e.sum / e.n, max: e.max, n: e.n };
    })
    .sort((a, b) => b.avg - a.avg);
  return { rows, overallAvg: nAll ? sumAll / nAll : 0, longest };
}

// Range panel: how far each weapon's kills happen — AWP long, SMGs close. Rows
// share the map selection (click → plot that weapon's kills), so it stays part
// of the same cross-linked system as the kills panel.
function RangePanel({
  data,
  selectedWeapon,
  onSelectWeapon,
}: {
  data: RangeData;
  selectedWeapon?: string | null;
  onSelectWeapon?: (key: string) => void;
}) {
  const maxAvg = Math.max(1, ...data.rows.map((r) => r.avg));
  return (
    <div className="card-2 px-5 py-4 lg:flex lg:h-full lg:min-h-0 lg:min-w-0 lg:flex-col lg:px-4 lg:py-3">
      <div className="mb-3 flex items-center justify-between lg:mb-2 lg:shrink-0">
        <h3 className="stat-label">Range profile</h3>
        <span className="text-[10px] text-faint">avg kill distance · click a weapon → map</span>
      </div>
      {data.rows.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted lg:my-auto">No kills to measure.</div>
      ) : (
        <>
          <div className="scroll-slim space-y-1.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
            {data.rows.slice(0, 10).map((r) => {
              const selected = selectedWeapon === r.key;
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={onSelectWeapon ? () => onSelectWeapon(r.key) : undefined}
                  aria-pressed={!!selected}
                  title={`Show ${r.label} kills on the map`}
                  className={`group block w-full rounded-lg px-1.5 py-1 text-left transition ${
                    selected ? "bg-panel/70" : "hover:bg-panel/40"
                  }`}
                  style={selected ? { boxShadow: `inset 0 0 0 1px ${r.color}` } : undefined}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <WeaponBadge w={r} />
                    <span className="text-sm font-semibold text-ink">{r.label}</span>
                    {selected ? (
                      <span className="rounded-full px-1.5 text-[9px] font-bold uppercase tracking-wider" style={{ background: `${r.color}22`, color: r.color }}>
                        on map
                      </span>
                    ) : (
                      <span className="hidden text-[9px] font-semibold uppercase tracking-wider text-faint group-hover:inline">
                        → map
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-2 text-xs tabular-nums">
                      <span className="font-semibold text-ink">~{r.avg.toFixed(0)}m</span>
                      <span className="text-faint">max {r.max.toFixed(0)}m · {r.n}K</span>
                    </span>
                  </div>
                  <div className="relative h-1.5 overflow-hidden rounded-full bg-panel">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{ width: `${(r.avg / maxAvg) * 100}%`, background: r.color, boxShadow: `0 0 8px -2px ${r.color}` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-4 border-t border-line pt-3 text-[11px] text-muted lg:mt-3 lg:shrink-0">
            Average engagement <span className="font-semibold text-ink">~{data.overallAvg.toFixed(0)}m</span>
            {data.longest && (
              <>
                {" "}· longest{" "}
                <span className="font-semibold" style={{ color: data.longest.color }}>
                  {data.longest.d.toFixed(0)}m {data.longest.label}
                </span>
              </>
            )}
          </div>
        </>
      )}
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

  return (
    <div className="card-2 px-5 py-4 lg:flex lg:min-h-0 lg:min-w-0 lg:flex-col lg:px-4 lg:py-3">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 lg:shrink-0">
        <h3 className="stat-label">Economy ladder · killer buy vs victim buy</h3>
        <span className="text-[10px] text-faint">cell = kills · green ring = punching up</span>
      </div>
      <p className="mb-3 text-xs text-muted lg:mb-2 lg:shrink-0">
        <span className="font-bold text-good">{m.upset}</span> upset frags ({upsetPct.toFixed(0)}%) — killing an
        equal-or-richer enemy while on the weaker buy.
      </p>
      <div className="scroll-slim overflow-x-auto lg:min-h-0 lg:overflow-y-auto">
        <div
          className="inline-grid gap-1 text-[11px]"
          style={{ gridTemplateColumns: `auto repeat(${BUY_KEYS.length}, 2.4rem)` }}
        >
          <div className="flex items-end justify-end pr-1 text-[9px] uppercase tracking-wider text-faint">K\V</div>
          {BUY_KEYS.map((vk) => (
            <div key={vk} className="text-center text-[10px] font-semibold" style={{ color: TIER[vk].color }}>
              {TIER[vk].label}
            </div>
          ))}
          {BUY_KEYS.map((kk) => (
            <BuyRow key={kk} kk={kk} m={m} rank={rank} />
          ))}
        </div>
      </div>
      <div className="mt-2 text-[10px] text-faint lg:shrink-0">
        Rows = killer&apos;s buy, columns = victim&apos;s buy. Cells above the diagonal = the killer was on a
        cheaper buy than who they killed.
      </div>
    </div>
  );
}

function BuyRow({
  kk,
  m,
  rank,
}: {
  kk: BuyKey;
  m: ReturnType<typeof computeBuyMatrix>;
  rank: (k: BuyKey) => number;
}) {
  return (
    <>
      <div className="flex items-center justify-end pr-1 text-[10px] font-semibold" style={{ color: TIER[kk].color }}>
        {TIER[kk].label}
      </div>
      {BUY_KEYS.map((vk) => {
        const n = m.cells[kk][vk];
        const intensity = m.max ? n / m.max : 0;
        const upset = rank(kk) > rank(vk);
        return (
          <div
            key={vk}
            title={`${TIER[kk].label} buy → killed ${TIER[vk].label} buy: ${n}`}
            className={`grid h-9 place-items-center rounded tabular-nums lg:h-7 ${upset && n > 0 ? "ring-1 ring-good/70" : ""}`}
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
    </>
  );
}

// --- kill / death map (toggle + weapon-class filter + angle line) -----------

const CLASS_CHIPS: { key: WeaponClass | "all"; label: string; color: string }[] = [
  { key: "all", label: "All", color: "var(--color-muted)" },
  { key: "rifle", label: "Rifles", color: "#f5694a" },
  { key: "sniper", label: "Snipers", color: "#46d369" },
  { key: "smg", label: "SMGs", color: "#8a7dff" },
  { key: "pistol", label: "Pistols", color: "#f5b942" },
  { key: "heavy", label: "Heavy", color: "#9bb0c8" },
];

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
  const [mode, setMode] = useState<"kills" | "deaths">("kills");
  const [cls, setCls] = useState<WeaponClass | "all">("all");
  const [angle, setAngle] = useState(false);

  // a weapon picked from the kill/death panels drives the map (its own mode);
  // otherwise the map uses its local mode + class-chip filter.
  const activeMode = weaponSel ? weaponSel.mode : mode;

  const marks = useMemo(() => {
    const scoped = view.scopeRound != null && rounds[view.scopeRound] ? [rounds[view.scopeRound]] : rounds;
    const out: { vx: number; vy: number; kx: number | null; ky: number | null; color: string }[] = [];
    for (const r of scoped) {
      for (const k of r.kills ?? []) {
        if (k.k < 0) continue;
        const subj = activeMode === "kills" ? k.k : k.v;
        if (subj < 0) continue;
        if (view.focusPlayer != null && subj !== view.focusPlayer) continue;
        if (view.side !== "all" && sideOf(r, subj, meta) !== view.side) continue;
        const wm = weaponMeta(k.w);
        if (weaponSel) {
          if (wm.key !== weaponSel.key) continue;
        } else if (cls !== "all" && wm.cls !== cls) continue;
        const v = proj.project(k.vx, k.vy);
        if (!v) continue;
        const kp = proj.project(k.kx, k.ky);
        out.push({ vx: v.x * 100, vy: v.y * 100, kx: kp ? kp.x * 100 : null, ky: kp ? kp.y * 100 : null, color: wm.color });
      }
    }
    return out;
  }, [meta, rounds, proj, view.scopeRound, view.side, view.focusPlayer, activeMode, cls, weaponSel]);

  const focusName = view.focusPlayer != null ? meta.players[view.focusPlayer]?.name : null;

  return (
    // at lg+ the card is a size container: the square radar below takes
    // min(width, height − controls/footnote) so the whole card fits the pane
    <div className="card-2 p-3 lg:flex lg:h-full lg:min-h-0 lg:min-w-0 lg:flex-col lg:@container-size">
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

      <div className="relative mx-auto aspect-square w-full max-w-xl overflow-hidden rounded-xl border border-line bg-panel2 lg:my-auto lg:w-[min(100cqw,calc(100cqh-150px))] lg:max-w-none lg:shrink-0">
        {calibrated ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={radarImage(meta.map)} alt={`${meta.map} radar`} className="absolute inset-0 h-full w-full object-cover opacity-90" draggable={false} />
        ) : (
          <div className="absolute inset-0 bg-[#0a1020]" />
        )}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {angle &&
            marks.map((mk, i) =>
              mk.kx != null && mk.ky != null ? (
                <line key={`l${i}`} x1={mk.kx} y1={mk.ky} x2={mk.vx} y2={mk.vy} stroke={mk.color} strokeWidth={0.25} opacity={0.4} />
              ) : null,
            )}
          {marks.map((mk, i) => (
            <g key={i} stroke={mk.color} strokeWidth={0.55} strokeLinecap="round">
              <line x1={mk.vx - 1.2} y1={mk.vy - 1.2} x2={mk.vx + 1.2} y2={mk.vy + 1.2} />
              <line x1={mk.vx + 1.2} y1={mk.vy - 1.2} x2={mk.vx - 1.2} y2={mk.vy + 1.2} />
            </g>
          ))}
        </svg>
        {marks.length === 0 && (
          <div className="absolute inset-0 grid place-items-center px-4 text-center text-xs text-muted">
            No {activeMode} for the current filter.
          </div>
        )}
        {!calibrated && (
          <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-mid/15 px-2 py-0.5 text-[10px] text-mid">
            {meta.map} uncalibrated — auto-scaled
          </div>
        )}
      </div>
      <div className="mt-2 text-[10px] text-faint lg:shrink-0">
        ✕ at the victim&apos;s spot, coloured by weapon. {activeMode === "deaths" ? "Where the scoped player/side dies" : "Where the scoped player/side gets kills"} — toggle the angle line for the shot direction. Click a weapon in the kills/deaths lists to isolate it.
      </div>
    </div>
  );
}

// --- per-player drilldown (offense) ----------------------------------------

function PlayerCard({ p, open, onToggle }: { p: PlayerWeaponStat; open: boolean; onToggle: () => void }) {
  const col = teamColor(p.team);
  const top = p.topWeapon;
  const barMax = p.weapons[0]?.kills ?? 1;
  return (
    <div className={`card px-4 py-3 ${open ? "ring-1 ring-brand/40" : ""}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 text-left">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm font-black" style={{ background: `${col}22`, color: col }}>
          {(p.name || "?").slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-bold text-ink">{p.name}</span>
            <span className="rounded px-1 text-[9px] font-bold" style={{ background: `${col}22`, color: col }}>{p.team || "—"}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-faint">
            {top && <WeaponBadge w={top} size={14} />}
            <span className="truncate">{top ? top.label : "—"}</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-extrabold tabular-nums text-ink">{p.totalKills}</div>
          <div className="text-[10px] tabular-nums" style={{ color: hsColor(p.hsPct) }}>{p.hsPct.toFixed(0)}% HS</div>
        </div>
        <svg className={`h-4 w-4 shrink-0 text-faint transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
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
                <span className="w-24 shrink-0 truncate text-[11px] font-medium text-muted">{w.label}</span>
                <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-panel">
                  <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: w.color }} />
                </div>
                <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-faint">{w.kills}</span>
                <span className="w-12 shrink-0 text-right text-[11px] tabular-nums" style={{ color: hsColor(w.hsPct) }}>{w.hsPct.toFixed(0)}%</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- head-to-head (player vs player) ---------------------------------------

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
  const matrix = useMemo(
    () => (focus == null ? computeDuelMatrix(meta, rounds, roundFilter) : null),
    [meta, rounds, focus, roundFilter],
  );
  const focusName = focus != null ? meta.players[focus]?.name : null;

  // focused player → their duel list vs every opponent
  if (focus != null) {
    return (
      <div className="card-2 px-5 py-4 lg:flex lg:min-h-0 lg:min-w-0 lg:flex-1 lg:flex-col lg:px-4 lg:py-3">
        <div className="mb-3 flex items-center justify-between lg:mb-2 lg:shrink-0">
          <h3 className="stat-label">Head-to-head · {focusName}</h3>
          <span className="text-[10px] text-faint">your kills vs theirs · click to switch player</span>
        </div>
        {duels.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted lg:my-auto">No duels in this scope.</div>
        ) : (
          <div className="scroll-slim space-y-1.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
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
        <div className="mt-2 text-[10px] text-faint lg:shrink-0">
          <span className="text-good">green</span> = your kills, <span className="text-bad">red</span> = your deaths to them. Spans the whole match (duels cross sides).
        </div>
      </div>
    );
  }

  // no focus → full net-frag matrix
  if (!matrix || matrix.players.length === 0) return null;
  const { players, net, maxAbs } = matrix;
  return (
    <div className="card-2 px-5 py-4 lg:flex lg:min-h-0 lg:min-w-0 lg:flex-1 lg:flex-col lg:px-4 lg:py-3">
      <div className="mb-3 flex items-center justify-between lg:mb-2 lg:shrink-0">
        <h3 className="stat-label">Head-to-head · net frags</h3>
        <span className="text-[10px] text-faint">row vs column · green = row leads · click a name</span>
      </div>
      <div className="scroll-slim overflow-x-auto lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        <div
          className="inline-grid gap-0.5 text-[11px]"
          style={{ gridTemplateColumns: `minmax(7rem,auto) repeat(${players.length}, 1.9rem)` }}
        >
          <div />
          {players.map((p, j) => (
            <div key={p.i} title={p.name} className="grid place-items-center text-[9px] font-semibold" style={{ color: teamColor(p.team) }}>
              {j + 1}
            </div>
          ))}
          {players.map((p, a) => (
            <Fragment key={p.i}>
              <button
                type="button"
                onClick={() => view.setFocusPlayer(p.i)}
                className="flex items-center gap-1 truncate pr-1 text-left transition hover:text-ink"
                style={{ color: teamColor(p.team) }}
              >
                <span className="w-4 shrink-0 text-faint">{a + 1}</span>
                <span className="truncate font-semibold">{p.name}</span>
              </button>
              {players.map((q, b) => {
                if (a === b) return <div key={q.i} className="grid h-7 place-items-center text-line2">·</div>;
                const v = net[a][b];
                const inten = maxAbs ? Math.abs(v) / maxAbs : 0;
                const bg =
                  v > 0
                    ? `color-mix(in srgb, var(--color-good) ${Math.round(15 + inten * 55)}%, var(--color-panel))`
                    : v < 0
                      ? `color-mix(in srgb, var(--color-bad) ${Math.round(15 + inten * 55)}%, var(--color-panel))`
                      : "var(--color-panel)";
                return (
                  <div
                    key={q.i}
                    title={`${p.name} vs ${q.name}: ${matrix.for[a][b]}–${matrix.for[b][a]} (net ${v > 0 ? "+" : ""}${v})`}
                    className="grid h-7 place-items-center rounded tabular-nums"
                    style={{ background: bg, color: v !== 0 ? "var(--color-ink)" : "var(--color-faint)" }}
                  >
                    {v > 0 ? `+${v}` : v || "0"}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="mt-2 text-[10px] text-faint lg:shrink-0">
        Numbers index the rows. Each cell = that row player&apos;s net kills against the column player (whole match).
      </div>
    </div>
  );
}

// --- main -------------------------------------------------------------------

export default function WeaponInsights({ meta, rounds, view }: { meta: ReplayMeta; rounds: ReplayRound[]; view: DemoView }) {
  const roundSel = view.scopeRound;
  const focus = view.focusPlayer;
  const [openPlayer, setOpenPlayer] = useState<number | null>(null);
  useEffect(() => {
    if (focus != null) setOpenPlayer(focus);
  }, [focus]);

  // a weapon picked from either kills/deaths panel drives the map; reset it
  // whenever the scope/side/focus changes (the underlying kill set changed).
  const [weaponSel, setWeaponSel] = useState<{ key: string; mode: "kills" | "deaths" } | null>(null);
  useEffect(() => {
    setWeaponSel(null);
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

  // Unscoped, deaths-by-weapon exactly mirrors kills-by-weapon (every kill is
  // someone's death), so the threat panel/tile would duplicate the offense ones.
  // In that state show engagement RANGES instead — fresh signal from the same
  // kill events. Any player/side scope brings the real deaths lens back.
  const unscoped = focus == null && view.side === "all";
  const range = useMemo(
    () => (unscoped ? computeRangeData(meta, rounds, roundFilter) : null),
    [unscoped, meta, rounds, roundFilter],
  );

  const focusName = focus != null ? meta.players[focus]?.name : null;

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
    <section className="space-y-4 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:gap-3 lg:space-y-0">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
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
      <div className="grid gap-3 sm:grid-cols-2 lg:shrink-0 lg:grid-cols-4">
        <StatPill tone="offense" label="Top weapon" value={offense.topWeapon ? offense.topWeapon.label : "—"} hint={offense.topWeapon ? `${offense.topWeapon.kills} kills · ${offense.topWeapon.hsPct.toFixed(0)}% HS` : undefined} hex={offense.topWeapon?.color} weapon={offense.topWeapon} />
        <StatPill tone="offense" label="Headshot rate" value={`${offense.overallHsPct.toFixed(0)}%`} hint={`${offense.totalHeadshots}/${offense.totalKills} kills`} hex={hsColor(offense.overallHsPct)} />
        {range?.longest ? (
          <StatPill
            tone="offense"
            label="Longest kill"
            value={`${range.longest.d.toFixed(0)}m`}
            hint={`${range.longest.killer} → ${range.longest.victim} · ${range.longest.label} · R${range.longest.rn}`}
            hex={range.longest.color}
            weapon={range.longest}
          />
        ) : (
          <StatPill
            tone="threat"
            label={focusName ? "Most killed by" : "Deadliest weapon"}
            value={defense.topWeapon ? defense.topWeapon.label : "—"}
            hint={defense.topWeapon ? `${defense.topWeapon.kills} ${focusName ? "of your deaths" : "deaths"}` : undefined}
            hex={defense.topWeapon?.color}
            weapon={defense.topWeapon}
          />
        )}
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

      {/* main analysis row — five lg columns across the very wide pane
          (offense | threat | duels+economy | map | roster); plain vertical
          stack below lg exactly as before */}
      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1.2fr)_minmax(0,1.05fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-3">
        {/* dual-lens: kills (offense) vs deaths (threat) */}
        <WeaponPanel
          title={focusName ? `${focusName} · kills by weapon` : view.side !== "all" ? `${view.side} kills by weapon` : "Kills by weapon"}
          subtitle="click a weapon → map"
          data={offense}
          unit="K"
          empty="No kills in this scope."
          selectedWeapon={weaponSel?.mode === "kills" ? weaponSel.key : null}
          onSelectWeapon={(k) => pickWeapon(k, "kills")}
        />
        {range ? (
          <RangePanel
            data={range}
            selectedWeapon={weaponSel?.mode === "kills" ? weaponSel.key : null}
            onSelectWeapon={(k) => pickWeapon(k, "kills")}
          />
        ) : (
          <WeaponPanel
            title={focusName ? `What kills ${focusName}` : `What kills ${view.side}`}
            subtitle="click a weapon → map"
            data={defense}
            unit="D"
            empty="No deaths in this scope."
            selectedWeapon={weaponSel?.mode === "deaths" ? weaponSel.key : null}
            onSelectWeapon={(k) => pickWeapon(k, "deaths")}
          />
        )}

        {/* head-to-head duels (grows, scrolls) + economy ladder (natural height) */}
        <div className="grid gap-4 lg:flex lg:h-full lg:min-h-0 lg:min-w-0 lg:flex-col lg:gap-3">
          <HeadToHead meta={meta} rounds={rounds} view={view} />
          <BuyMatrixCard meta={meta} rounds={rounds} view={view} />
        </div>

        {/* kill / death map — driven by the shared weapon selection */}
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

        {/* per-player breakdown (offense, whole roster) */}
        <div className="card-2 px-5 py-4 lg:flex lg:h-full lg:min-h-0 lg:min-w-0 lg:flex-col lg:px-4 lg:py-3">
          <div className="mb-3 flex items-center justify-between lg:mb-2 lg:shrink-0">
            <h3 className="stat-label">Per-player weapons</h3>
            <span className="text-[10px] text-faint">click to expand · sets the scoped player</span>
          </div>
          <div className="scroll-slim grid gap-2 lg:min-h-0 lg:flex-1 lg:content-start lg:overflow-y-auto lg:pr-1">
            {roster.players.map((p) => (
              <PlayerCard
                key={p.i}
                p={p}
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

      <p className="text-[10px] leading-relaxed text-faint lg:shrink-0">
        Derived from kill events (killer · weapon · headshot · positions) plus per-round buy values. A kill
        records only the killer&apos;s weapon, so &quot;deaths by weapon&quot; means what killed you, never your own
        gun. The economy ladder needs per-round buy data (re-parse older demos). For aim quality, ADR, KAST and
        economy discipline, see the Insights tab.
      </p>
    </section>
  );
}
