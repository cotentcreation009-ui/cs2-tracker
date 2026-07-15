"use client";

// Utility — the grenade lens. This tab specializes in one thing: how this
// lobby uses utility. A full-height throw explorer (animated lineups on the
// radar) is the centerpiece; around it, a utility-ranked roster, the focused
// player's utility card (kinds, victims blinded, burn damage, execute timing,
// team share), their repeated lineups, and a per-round utility timeline.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import {
  computeInsights,
  clusterUtilThrows,
  throwOrigin,
  type PlayerInsight,
  type UtilThrow,
} from "@/lib/demo/insights";
import { classifyBuy } from "@/lib/demo/economy";
import { buildProjection } from "@/lib/demo/projection";
import { loadZones, classifyPosition, type Zone } from "@/lib/maps/zones";
import { KIND_COLOR, KIND_LABEL } from "@/components/demo/RadarMap";
import { UtilThrowMap } from "@/components/demo/UtilThrowMap";
import type { DemoView } from "@/components/demo/MatchToolbar";

const UTIL_KINDS = ["smoke", "flash", "he", "molotov", "decoy"] as const;
type Timing = "early" | "mid" | "late";

// Buy-menu price per grenade (for the died-with-unused-utility estimate).
const NADE_PRICE: [RegExp, number][] = [
  [/smoke/i, 300],
  [/flash/i, 200],
  [/HE|explosive/i, 300],
  [/molotov/i, 400],
  [/incendiary/i, 600],
  [/decoy/i, 50],
];
const GRENADE_RE = /smoke|flash|HE Grenade|explosive|molotov|incendiary|decoy/i;
const nadePrice = (name: string) => NADE_PRICE.find(([re]) => re.test(name))?.[1] ?? 0;

// normalize a raw round-data nade kind to the insights kind vocabulary
const normKind = (k: string) =>
  k === "inferno" || k === "incgrenade" ? "molotov" : k;

const CT = "#5b9dff";
const T = "#e7b53c";
const CT_SOFT_HEX = "#9cc1ff";
const T_SOFT_HEX = "#f0cd78";
const sideHex = (t: PlayerInsight["team"]) => (t === "T" ? T : CT);
const mmss = (t: number) => {
  const total = Math.round(t);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

// ---------------------------------------------------------------- sorting ---
type SortKey = "thrown" | "flashed" | "blind" | "utildmg" | "taken";
const SORTS: { key: SortKey; label: string; title: string }[] = [
  { key: "thrown", label: "Thrown", title: "grenades thrown" },
  { key: "flashed", label: "Flashed", title: "enemies blinded" },
  { key: "blind", label: "Blind time", title: "total enemy blind seconds dealt" },
  { key: "utildmg", label: "Util dmg", title: "grenade damage dealt to enemies" },
  { key: "taken", label: "Taken", title: "grenade damage absorbed from enemies" },
];
function sortValue(p: PlayerInsight, key: SortKey): number {
  switch (key) {
    case "flashed": return p.enemiesFlashed;
    case "blind": return p.flashDuration;
    case "utildmg": return p.utilDamage;
    default: return p.utilNades.length;
  }
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

// award glyphs (viewBox 24, currentColor)
type AwardKind = "util" | "flash" | "burn" | "clock";
const AWARD_PATH: Record<AwardKind, { d: string; fill: boolean }> = {
  util: { d: "M12 2c4 5 7 8.5 7 12a7 7 0 1 1-14 0c0-3.5 3-7 7-12z", fill: true },
  flash: { d: "M13 2L4 14h6l-1 8 9-12h-6l1-8z", fill: true },
  burn: { d: "M12 2l2.9 6.2 6.6.8-4.9 4.6 1.3 6.5-5.9-3.3-5.9 3.3 1.3-6.5L2.5 9l6.6-.8z", fill: true },
  clock: { d: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v5l3.5 2", fill: false },
};
function AwardIcon({ kind, className }: { kind: AwardKind; className?: string }) {
  const g = AWARD_PATH[kind];
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={g.fill ? "currentColor" : "none"}
      stroke={g.fill ? "none" : "currentColor"}
      strokeWidth={g.fill ? 0 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={g.d} />
    </svg>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-panel/50 px-2.5 py-2">
      <div className="stat-label">{label}</div>
      <div className="mt-0.5 text-base font-bold tabular-nums text-ink">{value}</div>
      {sub && <div className="text-[10px] text-faint">{sub}</div>}
    </div>
  );
}

// Clickable utility chip — switches the map to that kind.
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
      aria-pressed={!!active}
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

// One individual throw — click to play its lineup solo on the map.
function ThrowRow({
  tw,
  zone,
  timing,
  active,
  showKind,
  onClick,
  onEnter,
  onLeave,
}: {
  tw: UtilThrow;
  zone: string | null;
  timing: Timing;
  active: boolean;
  showKind?: boolean;
  onClick: () => void;
  onEnter?: () => void;
  onLeave?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      aria-pressed={active}
      className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-left transition ${
        active ? "border-brand/50 bg-brand/5" : "border-line hover:bg-panel/50"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2 text-xs">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_COLOR[tw.kind] }} />
        {showKind && (
          <span className="shrink-0 font-semibold" style={{ color: KIND_COLOR[tw.kind] }}>
            {KIND_LABEL[tw.kind] ?? tw.kind}
          </span>
        )}
        <span className="font-semibold text-ink">R{tw.round}</span>
        {zone && <span className="truncate text-faint">{zone}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-[10px] text-faint">
        {(tw.kind === "he" || tw.kind === "molotov") &&
          (tw.dmg ? (
            <span className="pill bg-bad/10 tabular-nums text-bad" title={`hit ${tw.hit} enem${tw.hit === 1 ? "y" : "ies"}`}>
              {tw.dmg} dmg
            </span>
          ) : (
            <span className="pill bg-panel text-faint" title="detonated without damaging anyone">
              dud
            </span>
          ))}
        <TimingBadge timing={timing} />
        <span className="tabular-nums">{mmss(tw.t)}</span>
      </span>
    </button>
  );
}

// Round-by-round strip: a cell per round showing the player's grenade output,
// click to scope that round across every tab.
function UtilTimeline({
  rounds,
  meta,
  i,
  scope,
  onPick,
}: {
  rounds: ReplayRound[];
  meta: ReplayMeta;
  i: number;
  scope: number | null;
  onPick: (ri: number) => void;
}) {
  if (rounds.length < 2) return null;
  return (
    <div className="card-2 px-3 py-2.5 lg:shrink-0">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="stat-label">
          Utility per round · <span className="text-ink">{meta.players[i]?.name ?? "?"}</span>
        </span>
        <span className="text-[10px] text-faint">click a round to scope every tab to it</span>
      </div>
      <div className="scroll-slim flex flex-wrap gap-1 lg:flex-nowrap lg:overflow-x-auto lg:pb-1">
        {rounds.map((r, ri) => {
          const side = r.ct?.includes(i) ? "CT" : r.t?.includes(i) ? "T" : null;
          const won = !!side && r.winner === side;
          const nades = (r.nades ?? []).filter((n) => n.by === i);
          const kinds: Record<string, number> = {};
          for (const n of nades) kinds[n.k] = (kinds[n.k] ?? 0) + 1;
          const kindStr = Object.entries(kinds)
            .map(([k, c]) => `${c} ${KIND_LABEL[k] ?? k}`)
            .join(" · ");
          const active = scope === ri;
          return (
            <button
              key={ri}
              type="button"
              onClick={() => onPick(ri)}
              aria-pressed={active}
              title={
                side == null
                  ? `Round ${r.n} · did not play`
                  : `Round ${r.n} · ${won ? "won" : "lost"}${nades.length ? ` · ${kindStr}` : " · no utility"}`
              }
              className={`grid h-9 w-7 place-items-center rounded border leading-none transition lg:shrink-0 ${active ? "ring-2 ring-brand" : ""} ${
                side == null
                  ? "border-line bg-panel/40 opacity-40"
                  : won
                    ? "border-good/40 bg-good/10 hover:brightness-150"
                    : "border-bad/30 bg-bad/10 hover:brightness-150"
              }`}
            >
              {side == null ? (
                <span className="text-xs text-faint">–</span>
              ) : (
                <>
                  <span
                    className="text-xs font-bold tabular-nums"
                    style={nades.length >= 3 ? { color: "#f5b942" } : nades.length === 0 ? { opacity: 0.35 } : undefined}
                  >
                    {nades.length}
                  </span>
                  <span className="mt-0.5 flex gap-px">
                    {nades.slice(0, 4).map((n, j) => (
                      <span key={j} className="h-1 w-1 rounded-full" style={{ background: KIND_COLOR[n.k] ?? "#888" }} />
                    ))}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[9px] text-faint">
        <span>number = grenades thrown (gold = 3+)</span>
        <span>dots = kinds</span>
        <span>green / red = round won / lost</span>
      </div>
    </div>
  );
}

interface RosterStat { display: string; frac: number; color: string }

function RosterRow({
  p,
  rank,
  focused,
  stat,
  onFocus,
}: {
  p: PlayerInsight;
  rank: number;
  focused: boolean;
  stat: RosterStat;
  onFocus: () => void;
}) {
  const hex = sideHex(p.team);
  const perRound = p.roundsPlayed ? p.utilNades.length / p.roundsPlayed : 0;
  return (
    <div
      className={`relative flex items-center gap-1.5 overflow-hidden rounded-lg border px-2 py-1 transition ${
        focused ? "border-brand/50 bg-brand/10" : "border-transparent hover:bg-panel/60"
      }`}
    >
      <span
        className="absolute inset-y-1 left-0 w-0.5 rounded-full"
        style={{ background: hex, opacity: focused ? 1 : 0.45 }}
      />
      <button
        type="button"
        onClick={onFocus}
        className="flex min-w-0 flex-1 items-center gap-1.5 pl-1 text-left"
        title={`Break down ${p.name}'s utility`}
      >
        <span className="w-4 shrink-0 text-right text-[10px] font-bold tabular-nums text-faint">{rank}</span>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: hex }} />
        <span className={`min-w-0 flex-1 truncate text-xs font-semibold ${focused ? "text-brand" : "text-ink"}`}>
          {p.name}
        </span>
        <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted" title="grenades per round">
          {perRound.toFixed(1)}/rd
        </span>
        <span className="w-14 shrink-0 text-right">
          <span className="block text-[11px] font-bold leading-tight tabular-nums" style={{ color: stat.color }}>
            {stat.display}
          </span>
          <span className="mt-0.5 block h-1 w-full overflow-hidden rounded-full bg-panel">
            <span
              className="block h-full rounded-full transition-all"
              style={{ width: `${Math.round(stat.frac * 100)}%`, background: stat.color, opacity: 0.85 }}
            />
          </span>
        </span>
      </button>
    </div>
  );
}

// Extra per-player reads joined from the raw rounds (waste + effectiveness).
export interface UtilExtras {
  blankFlashRounds: number; // rounds with 1+ flash thrown and zero enemies blinded
  flashThrows: number;
  diedWithUtilRounds: number[];
  wastedDollars: number; // est. value of grenades still in pocket on death
  ctThrows: number; // by the side they were on THAT round
  tThrows: number;
  utilTaken: number; // HP absorbed from ENEMY grenades
  nadeDeaths: number; // deaths where the kill weapon was a grenade/molotov
  // grenade output by buy tier (per this player's buy bucket that round)
  tier: Record<string, { rds: number; nades: number; low: number }>; // low = rounds with <=1 nade
}

// The focused player's utility card — everything we know about their grenades.
function UtilityCard({
  p,
  teamTotal,
  timingOf,
  activeKind,
  extras,
  execJoin,
  onUtil,
}: {
  p: PlayerInsight;
  teamTotal: number; // nades thrown by their whole team (for the share)
  timingOf: (tw: { t: number; round: number }) => Timing;
  activeKind: string | null;
  extras: UtilExtras;
  execJoin: { joined: number; eligible: number; inExec: number } | null;
  onUtil: (player: PlayerInsight, kind: string) => void;
}) {
  const hex = sideHex(p.team);
  const n = p.utilNades.length;
  const timing = { early: 0, mid: 0, late: 0 };
  for (const tw of p.utilNades) timing[timingOf(tw)]++;
  const share = teamTotal ? (n / teamTotal) * 100 : 0;
  const perRound = p.roundsPlayed ? n / p.roundsPlayed : 0;
  const dmgNades = p.utilNades.filter((tw) => tw.kind === "he" || tw.kind === "molotov");
  const duds = dmgNades.filter((tw) => !tw.dmg).length;
  const perFlash = extras.flashThrows ? p.enemiesFlashed / extras.flashThrows : 0;
  const sideN = extras.ctThrows + extras.tThrows;
  return (
    <div className="card relative overflow-hidden py-3 pl-3 pr-4">
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: hex }} />
      <div className="flex items-center gap-2">
        <span className="truncate font-bold">{p.name}</span>
        <span className="pill bg-panel text-[10px] text-muted">{p.team || "?"}</span>
        <span className="ml-auto text-[11px] tabular-nums text-faint">
          {n} nade{n === 1 ? "" : "s"} · {perRound.toFixed(1)}/round
        </span>
      </div>

      {(p.utilThrown.total > 0 || p.utilDamage > 0 || p.enemiesFlashed > 0) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {p.utilThrown.smoke > 0 && <UtilPill kind="smoke" n={p.utilThrown.smoke} label="smoke" active={activeKind === "smoke"} onClick={() => onUtil(p, "smoke")} />}
          {p.utilThrown.flash > 0 && <UtilPill kind="flash" n={p.utilThrown.flash} label="flash" active={activeKind === "flash"} onClick={() => onUtil(p, "flash")} />}
          {p.utilThrown.he > 0 && <UtilPill kind="he" n={p.utilThrown.he} label="HE" active={activeKind === "he"} onClick={() => onUtil(p, "he")} />}
          {p.utilThrown.molotov > 0 && <UtilPill kind="molotov" n={p.utilThrown.molotov} label="molly" active={activeKind === "molotov"} onClick={() => onUtil(p, "molotov")} />}
          {p.utilThrown.decoy > 0 && <UtilPill kind="decoy" n={p.utilThrown.decoy} label="decoy" active={activeKind === "decoy"} onClick={() => onUtil(p, "decoy")} />}
        </div>
      )}

      {sideN > 0 && (
        <div className="mt-2" title="grenades split by the side they were on that round">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-panel">
            <div className="bar-grow" style={{ width: `${(extras.ctThrows / sideN) * 100}%`, background: CT }} />
            <div className="bar-grow" style={{ width: `${(extras.tThrows / sideN) * 100}%`, background: T }} />
          </div>
          <div className="mt-0.5 flex justify-between text-[9px] tabular-nums text-faint">
            <span style={{ color: "#9cc1ff" }}>CT · {extras.ctThrows}</span>
            <span style={{ color: "#f0cd78" }}>T · {extras.tThrows}</span>
          </div>
        </div>
      )}

      <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        <Stat
          label="Enemies flashed"
          value={`${p.enemiesFlashed}`}
          sub={
            extras.flashThrows > 0
              ? `${perFlash.toFixed(1)}/flash · ${extras.blankFlashRounds} blank rd${extras.blankFlashRounds === 1 ? "" : "s"}`
              : undefined
          }
        />
        <Stat
          label="Util damage"
          value={`${p.utilDamage}`}
          sub={
            dmgNades.length
              ? `${(p.utilDamage / dmgNades.length).toFixed(0)}/nade · ${duds} dud${duds === 1 ? "" : "s"}`
              : "grenade HP dealt"
          }
        />
        <Stat
          label="Early util"
          value={n ? `${Math.round((timing.early / n) * 100)}%` : "—"}
          sub="in first 25s post-freeze"
        />
        <Stat label="Team share" value={`${share.toFixed(0)}%`} sub="of their team's nades" />
        <Stat
          label="Died w/ util"
          value={extras.diedWithUtilRounds.length ? `${extras.diedWithUtilRounds.length} rds` : "0"}
          sub={
            extras.wastedDollars > 0
              ? `~$${extras.wastedDollars.toLocaleString()} unthrown (est.)`
              : "never wasted a nade"
          }
        />
        <Stat
          label="Util taken"
          value={`${extras.utilTaken}`}
          sub={extras.nadeDeaths > 0 ? `died to nades ×${extras.nadeDeaths}` : "HP absorbed from enemy nades"}
        />
      </div>

      {(execJoin?.eligible ?? 0) > 0 && (
        <div
          className="mt-2 text-[10px] tabular-nums text-muted"
          title="team executes = 3+ grenades from their side within 10s; joined = they threw at least one grenade inside it"
        >
          <span className="text-faint">Team executes</span> · joined {execJoin!.joined}/{execJoin!.eligible}
          {n > 0 && <> · {execJoin!.inExec} of {n} nades thrown inside them</>}
        </div>
      )}

      {(() => {
        const tiers = (["full", "force", "semi", "eco", "pistol"] as const)
          .map((k) => ({ k, t: extras.tier[k] }))
          .filter((x) => x.t && x.t.rds > 0);
        if (!tiers.length) return null;
        const full = extras.tier.full;
        const leak = full && full.rds >= 3 && full.low / full.rds >= 0.5;
        return (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] tabular-nums text-muted">
            <span className="text-faint">nades/rd by buy</span>
            {tiers.map(({ k, t }) => (
              <span key={k} title={`${t!.nades} grenades across ${t!.rds} ${k} round${t!.rds === 1 ? "" : "s"}`}>
                {k} {(t!.nades / t!.rds).toFixed(1)}
              </span>
            ))}
            {leak && (
              <span className="rounded-full bg-mid/15 px-1.5 py-0.5 text-mid" title="rounds with a full buy but at most one grenade thrown — money on guns, none on utility">
                full buy, ≤1 nade in {full!.low}/{full!.rds}
              </span>
            )}
          </div>
        );
      })()}

      {n > 0 && (
        <div className="mt-2.5">
          <div className="mb-1 flex justify-between text-[10px] text-faint">
            <span>throw timing</span>
            <span className="tabular-nums">
              <span className="text-good">{timing.early} early</span> · <span className="text-mid">{timing.mid} mid</span> ·{" "}
              <span className="text-bad">{timing.late} late</span>
            </span>
          </div>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-panel">
            <div className="bar-grow" style={{ width: `${(timing.early / n) * 100}%`, background: "var(--color-good)" }} />
            <div className="bar-grow" style={{ width: `${(timing.mid / n) * 100}%`, background: "var(--color-mid)" }} />
            <div className="bar-grow" style={{ width: `${(timing.late / n) * 100}%`, background: "var(--color-bad)" }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- main ---
export default function UtilityBreakdown({
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
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [teamPin, setTeamPin] = useState<number | null>(null); // index into executes
  const [zones, setZones] = useState<Zone[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("thrown");
  const cardRefs = useRef(new Map<number, HTMLDivElement>());

  const proj = useMemo(() => buildProjection(meta.map, rounds), [meta, rounds]);

  // scope to the toolbar's round + side selection
  const scopedRounds = useMemo(
    () =>
      view.scopeRound != null && rounds[view.scopeRound]
        ? [rounds[view.scopeRound]]
        : rounds,
    [rounds, view.scopeRound],
  );
  const data = useMemo(() => computeInsights(meta, scopedRounds), [meta, scopedRounds]);

  const players = useMemo(
    () => data.players.filter((p) => view.side === "all" || p.team === view.side),
    [data, view.side],
  );

  // per-player waste/effectiveness reads joined from the raw rounds
  const extrasOf = useMemo(() => {
    const m = new Map<number, UtilExtras>();
    const get = (i: number) => {
      let v = m.get(i);
      if (!v) {
        v = { blankFlashRounds: 0, flashThrows: 0, diedWithUtilRounds: [], wastedDollars: 0, ctThrows: 0, tThrows: 0, utilTaken: 0, nadeDeaths: 0, tier: {} };
        m.set(i, v);
      }
      return v;
    };
    for (const r of scopedRounds) {
      const flashesBy = new Map<number, number>();
      const thrownBy = new Map<number, number>();
      for (const nd of r.nades ?? []) {
        // damage ABSORBED — credit each damaged victim of an enemy grenade
        for (const [vi, hp] of Object.entries(nd.dmg ?? {})) {
          const v = Number(vi);
          const vCT = r.ct?.includes(v);
          const bCT = nd.by >= 0 ? r.ct?.includes(nd.by) : undefined;
          if (bCT !== undefined && vCT !== undefined && bCT !== vCT) get(v).utilTaken += hp;
        }
        if (nd.by < 0) continue;
        const e = get(nd.by);
        if (r.ct?.includes(nd.by)) e.ctThrows++;
        else if (r.t?.includes(nd.by)) e.tThrows++;
        thrownBy.set(nd.by, (thrownBy.get(nd.by) ?? 0) + 1);
        if (nd.k === "flash") {
          e.flashThrows++;
          flashesBy.set(nd.by, (flashesBy.get(nd.by) ?? 0) + 1);
        }
      }
      for (const k of r.kills ?? []) {
        if (k.v >= 0 && /he.?grenade|molotov|inferno|incendiar/i.test(k.w)) get(k.v).nadeDeaths++;
      }
      // grenade output by the thrower's own buy tier that round
      for (const st of r.stats ?? []) {
        const buy = st.buy ?? (st.equip != null ? classifyBuy(st.equip, r.n).key : null);
        if (!buy) continue;
        const e = get(st.i);
        const t = (e.tier[buy] ??= { rds: 0, nades: 0, low: 0 });
        t.rds++;
        const thrown = thrownBy.get(st.i) ?? 0;
        t.nades += thrown;
        if (thrown <= 1) t.low++;
      }
      for (const [i, nFlash] of flashesBy) {
        if (nFlash > 0 && ((r.stats ?? []).find((s) => s.i === i)?.flashed ?? 0) === 0) {
          get(i).blankFlashRounds++;
        }
      }
      // died holding grenades: freeze-end grenades minus detonations (estimate;
      // mid-round pickups are invisible, in-flight nades count as thrown)
      const dead = new Set((r.kills ?? []).map((k) => k.v));
      for (const s of r.stats ?? []) {
        if (!dead.has(s.i)) continue;
        const carried = (s.bought ?? []).filter((g) => GRENADE_RE.test(g));
        const unused = carried.length - (thrownBy.get(s.i) ?? 0);
        if (unused > 0) {
          const e = get(s.i);
          e.diedWithUtilRounds.push(r.n);
          // price the cheapest `unused` of what they carried (conservative)
          const prices = carried.map(nadePrice).sort((a, b) => a - b);
          e.wastedDollars += prices.slice(0, unused).reduce((a, b) => a + b, 0);
        }
      }
    }
    return (i: number): UtilExtras =>
      m.get(i) ?? { blankFlashRounds: 0, flashThrows: 0, diedWithUtilRounds: [], wastedDollars: 0, ctThrows: 0, tThrows: 0, utilTaken: 0, nadeDeaths: 0, tier: {} };
  }, [scopedRounds]);

  const sortVal = (p: PlayerInsight) =>
    sortKey === "taken" ? extrasOf(p.i).utilTaken : sortValue(p, sortKey);
  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => sortVal(b) - sortVal(a)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [players, sortKey, extrasOf],
  );

  const statMax = useMemo(
    () => Math.max(0.0001, ...players.map((p) => sortVal(p))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [players, sortKey, extrasOf],
  );
  const statFor = (p: PlayerInsight): RosterStat => {
    const v = sortVal(p);
    const frac = v <= 0 ? 0 : Math.min(1, Math.max(0.04, v / statMax));
    const display =
      sortKey === "blind" ? `${v.toFixed(1)}s` : sortKey === "thrown" ? `${p.utilNades.length}` : `${Math.round(v)}`;
    return { display, frac, color: "var(--color-brand)" };
  };

  // utility awards — quick scan + click to focus
  const awards = useMemo(() => {
    if (!players.length) return [];
    const top = (fn: (p: PlayerInsight) => number) =>
      players.reduce((b, p) => (fn(p) > fn(b) ? p : b), players[0]);
    const out: { label: string; p: PlayerInsight; val: string; icon: AwardKind }[] = [];
    const util = top((p) => p.utilNades.length);
    if (util.utilNades.length > 0)
      out.push({ label: "Most utility", p: util, val: `${util.utilNades.length} nades`, icon: "util" });
    const flash = top((p) => p.enemiesFlashed);
    if (flash.enemiesFlashed > 0)
      out.push({
        label: "Flash king",
        p: flash,
        val: `${flash.enemiesFlashed} blinded · ${flash.flashDuration.toFixed(0)}s`,
        icon: "flash",
      });
    const burn = top((p) => p.utilDamage);
    if (burn.utilDamage > 0)
      out.push({ label: "Util damage", p: burn, val: `${burn.utilDamage} dmg`, icon: "burn" });
    // clockwork: the biggest repeated same-spot lineup in the lobby
    let clock: { p: PlayerInsight; kind: string; count: number } | null = null;
    for (const p of players) {
      for (const k of UTIL_KINDS) {
        const throws = p.utilNades.filter((n) => n.kind === k);
        if (throws.length < 3) continue;
        const best = clusterUtilThrows(throws, (x, y) => proj.project(x, y))[0];
        if (best && best.count >= 3 && (!clock || best.count > clock.count)) {
          clock = { p, kind: k, count: best.count };
        }
      }
    }
    if (clock)
      out.push({
        label: "Clockwork",
        p: clock.p,
        val: `same ${KIND_LABEL[clock.kind]?.toLowerCase() ?? clock.kind} ×${clock.count}`,
        icon: "clock",
      });
    return out;
  }, [players, proj]);

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

  // fixed freeze-relative timing windows (same definition the Tendencies tab
  // uses): early = first 25s after freeze, mid = 25-55s, late = later.
  const freezeOf = useMemo(
    () => new Map(rounds.map((r) => [r.n, r.freezeEnd ?? 15])),
    [rounds],
  );
  const timingOf = (tw: { t: number; round: number }): Timing => {
    const rel = tw.t - (freezeOf.get(tw.round) ?? 15);
    return rel < 25 ? "early" : rel < 55 ? "mid" : "late";
  };

  // team executes: 3+ grenades from one side detonating within a 10s window —
  // the coordinated package, with plant correlation and round outcome
  const executes = useMemo(() => {
    const out: {
      rn: number;
      ri: number; // index into `rounds` for scoping
      side: "CT" | "T";
      kinds: Record<string, number>;
      zone: string | null;
      plantDelay: number | null;
      won: boolean;
      bys: number[];
      throws: UtilThrow[];
    }[] = [];
    for (const r of scopedRounds) {
      const ri = rounds.indexOf(r);
      for (const side of ["CT", "T"] as const) {
        const roster = new Set(side === "CT" ? r.ct ?? [] : r.t ?? []);
        const nades = (r.nades ?? [])
          .filter((nd) => roster.has(nd.by) && nd.k !== "decoy")
          .sort((a, b) => a.t - b.t);
        // greedy windows: start at each unconsumed nade, absorb all within 10s
        let s = 0;
        while (s < nades.length) {
          let e = s;
          while (e + 1 < nades.length && nades[e + 1].t - nades[s].t <= 10) e++;
          if (e - s + 1 >= 3) {
            const group = nades.slice(s, e + 1);
            const kinds: Record<string, number> = {};
            for (const nd of group) {
              const k = normKind(nd.k);
              kinds[k] = (kinds[k] ?? 0) + 1;
            }
            const plant = (r.bomb ?? []).find((b) => b.k === "plant" && b.t >= group[0].t);
            out.push({
              rn: r.n,
              ri,
              side,
              kinds,
              zone: null, // classified below once zones load
              plantDelay: plant ? Math.max(0, Math.round(plant.t - group[group.length - 1].t)) : null,
              won: r.winner === side,
              bys: group.map((nd) => nd.by),
              throws: group.map((nd) => {
                const o = throwOrigin(r, nd);
                return {
                  kind: normKind(nd.k), x: nd.x, y: nd.y, round: r.n, t: nd.t,
                  ox: o?.x ?? nd.ox ?? nd.x, oy: o?.y ?? nd.oy ?? nd.y,
                };
              }),
            });
            s = e + 1;
          } else {
            s++;
          }
        }
      }
    }
    return out;
  }, [scopedRounds, rounds]);

  useEffect(() => {
    setZones(loadZones(meta.map));
  }, [meta.map]);

  // reset the drill-down when the scope or side changes
  useEffect(() => {
    setKindSel(null);
    setThrowIdx(null);
    setHoverIdx(null);
    setTeamPin(null);
  }, [view.scopeRound, view.side]);
  useEffect(() => {
    setThrowIdx(null);
    setHoverIdx(null);
    setTeamPin(null);
  }, [focusI]);
  useEffect(() => {
    if (view.focusPlayer != null)
      cardRefs.current.get(view.focusPlayer)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [view.focusPlayer]);

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
  const pickedKind =
    kindSel && kindSel.i === focusI && (kindSel.kind === "all" || selKinds.includes(kindSel.kind))
      ? kindSel.kind
      : null;
  const activeKind =
    pickedKind ??
    (selPlayer && fallback && fallback.i === selPlayer.i && selKinds.includes(fallback.kind)
      ? fallback.kind
      : selKinds[0] ?? null);
  const showAll = activeKind === "all";
  const selThrows =
    selPlayer && activeKind
      ? selPlayer.utilNades
          .filter((n) => showAll || n.kind === activeKind)
          .slice()
          .sort((a, b) => a.round - b.round || a.t - b.t)
      : [];
  const spots = activeKind && !showAll ? clusterUtilThrows(selThrows, (x, y) => proj.project(x, y)) : [];
  const activeKindLabel = showAll ? "util" : (KIND_LABEL[activeKind ?? ""] ?? activeKind ?? "").toLowerCase();
  const shownIdx = hoverIdx ?? throwIdx;
  const soloThrow = shownIdx != null && selThrows[shownIdx] ? selThrows[shownIdx] : null;
  const pinnedExec = teamPin != null ? executes[teamPin] ?? null : null;
  const mapThrows = pinnedExec ? pinnedExec.throws : soloThrow ? [soloThrow] : selThrows;
  const zoneOf = (x: number, y: number) =>
    classifyPosition(meta.map, x, y, zones)?.name ?? null;
  // name an execute by the callout most of its grenades landed in
  const execZone = (ex: (typeof executes)[number]): string | null => {
    const counts = new Map<string, number>();
    for (const tw of ex.throws) {
      const z = zoneOf(tw.x, tw.y);
      if (z) counts.set(z, (counts.get(z) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const stepThrow = (d: number) => {
    setHoverIdx(null);
    setThrowIdx((i) => {
      if (!selThrows.length) return null;
      const next = (i ?? -1) + d;
      return Math.max(0, Math.min(selThrows.length - 1, next < 0 ? 0 : next));
    });
  };

  const pickUtil = (player: PlayerInsight, k: string) => {
    view.setFocusPlayer(player.i);
    setKindSel({ i: player.i, kind: k });
    setThrowIdx(null);
    setHoverIdx(null);
  };
  const pickKind = (k: string) => {
    if (focusI != null) setKindSel({ i: focusI, kind: k });
    setThrowIdx(null);
    setHoverIdx(null);
  };

  const teamTotalOf = (p: PlayerInsight) =>
    data.players.filter((x) => x.team === p.team).reduce((s, x) => s + x.utilNades.length, 0);

  return (
    <div className="space-y-3 lg:flex lg:h-full lg:min-h-0 lg:flex-col">
      {awards.length > 0 && (
        <div className="flex flex-wrap gap-2 lg:shrink-0">
          {awards.map((a) => {
            const hex = sideHex(a.p.team);
            const on = focusI === a.p.i;
            return (
              <button
                key={a.label}
                type="button"
                onClick={() => view.setFocusPlayer(view.focusPlayer === a.p.i ? null : a.p.i)}
                aria-pressed={on}
                title={`Focus ${a.p.name}`}
                className={`flex items-center gap-2.5 rounded-xl border py-1.5 pl-1.5 pr-3 text-left transition ${
                  on ? "border-brand/50 bg-brand/10" : "border-line bg-panel/50 hover:border-brand/40 hover:bg-panel"
                }`}
              >
                <span
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
                  style={{ background: `${hex}1f`, color: hex }}
                >
                  <AwardIcon kind={a.icon} className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[9px] font-bold uppercase leading-tight tracking-wider text-faint">
                    {a.label}
                  </span>
                  <span className="flex items-baseline gap-1.5">
                    <span className="max-w-32 truncate text-sm font-bold leading-tight" style={{ color: hex }}>
                      {a.p.name}
                    </span>
                    <span className="text-[11px] tabular-nums leading-tight text-muted">{a.val}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] lg:grid-rows-[minmax(0,1fr)] lg:gap-3 2xl:grid-cols-[minmax(0,1fr)_minmax(400px,500px)]">
        {/* left: the throw explorer — full-height map, video-player step
            controls on its bottom edge. ◀ ▶ arrow keys step through throws. */}
        <div
          className="card-2 p-3 focus:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 lg:flex lg:h-full lg:min-h-0 lg:min-w-0 lg:flex-col lg:items-center lg:justify-center lg:@container-size"
          tabIndex={selThrows.length ? 0 : -1}
          onKeyDown={(e) => {
            if (!selThrows.length) return;
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              stepThrow(-1);
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              stepThrow(1);
            } else if (e.key === "Escape") {
              setThrowIdx(null);
              setHoverIdx(null);
            }
          }}
        >
          <div className="mb-1.5 flex w-full items-center gap-x-2 lg:w-[min(100cqw,calc(100cqh-72px))]">
            <span className="stat-label shrink-0">Utility breakdown</span>
            {selPlayer && (
              <span className="pill min-w-0 truncate bg-panel text-ink" title={selPlayer.name}>
                {selPlayer.name}
              </span>
            )}
            {selPlayer && (selPlayer.enemiesFlashed > 0 || selPlayer.utilDamage > 0) && (
              <span className="ml-auto hidden min-w-0 truncate text-[10px] tabular-nums text-faint xl:inline">
                {selPlayer.enemiesFlashed > 0 &&
                  `${selPlayer.enemiesFlashed} flashed · ${selPlayer.flashDuration.toFixed(0)}s blind`}
                {selPlayer.enemiesFlashed > 0 && selPlayer.utilDamage > 0 && " · "}
                {selPlayer.utilDamage > 0 && `${selPlayer.utilDamage} util dmg`}
              </span>
            )}
          </div>
          {selPlayer && selKinds.length > 0 && (
            <div className="scroll-slim mb-2 flex w-full flex-wrap gap-1 lg:w-[min(100cqw,calc(100cqh-72px))] lg:flex-nowrap lg:overflow-x-auto">
              {selKinds.length > 1 && (
                <button
                  type="button"
                  onClick={() => pickKind("all")}
                  title="Show every grenade on the map at once"
                  className={`pill shrink-0 whitespace-nowrap font-semibold transition ${
                    showAll ? "bg-brand/15 text-brand" : "bg-panel text-muted hover:text-ink"
                  }`}
                >
                  ✦ All {selPlayer.utilNades.length}
                </button>
              )}
              {selKinds.map((k) => {
                const n = selPlayer.utilNades.filter((x) => x.kind === k).length;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => pickKind(k)}
                    className={`pill shrink-0 whitespace-nowrap transition ${
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
          )}

          {pinnedExec || (selPlayer && activeKind && selThrows.length > 0) ? (
            <div className="relative mx-auto w-full max-w-180 lg:mx-0 lg:w-[min(100cqw,calc(100cqh-72px))] lg:max-w-none">
              <UtilThrowMap map={meta.map} proj={proj} throws={mapThrows} className="w-full" />

              <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-1.5 rounded-b-xl border-t border-line/60 bg-bg/80 px-2.5 py-1.5 backdrop-blur">
                {!pinnedExec && (
                  <button type="button" onClick={() => stepThrow(-1)} title="Previous throw" aria-label="Previous throw" className="btn btn-ghost shrink-0 px-2 py-1 text-xs">◀</button>
                )}
                <div className="min-w-0 flex-1 text-center text-[11px]">
                  {pinnedExec ? (
                    <span>
                      <span className="font-semibold" style={{ color: pinnedExec.side === "T" ? T_SOFT_HEX : CT_SOFT_HEX }}>
                        R{pinnedExec.rn} {pinnedExec.side} execute
                      </span>
                      <span className="text-faint">
                        {" "}· {pinnedExec.throws.length} nades over {Math.round(pinnedExec.throws[pinnedExec.throws.length - 1].t - pinnedExec.throws[0].t)}s
                        {execZone(pinnedExec) ? ` · ${execZone(pinnedExec)}` : ""}
                      </span>
                      <span className={pinnedExec.won ? "text-good" : "text-bad"}> · {pinnedExec.won ? "won" : "lost"}</span>
                    </span>
                  ) : soloThrow ? (
                    <span title="dashed line = thrown from → landed">
                      <span className="font-semibold text-ink">Throw {(shownIdx ?? 0) + 1}/{selThrows.length}</span>
                      <span className="text-faint"> · R{soloThrow.round} · {mmss(soloThrow.t)}</span>
                      {zoneOf(soloThrow.x, soloThrow.y) && <span className="text-faint"> · {zoneOf(soloThrow.x, soloThrow.y)}</span>}
                      <span className="text-brand"> · {timingOf(soloThrow)}</span>
                      {(soloThrow.kind === "he" || soloThrow.kind === "molotov") && (
                        <span className={soloThrow.dmg ? "text-bad" : "text-faint"}>
                          {" "}· {soloThrow.dmg ? `${soloThrow.dmg} dmg` : "dud"}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted">
                      {selThrows.length} {activeKindLabel} — hover a row or ◀ ▶ to step
                    </span>
                  )}
                </div>
                {pinnedExec ? (
                  <button type="button" onClick={() => setTeamPin(null)} title="Back to the focused player's throws" className="btn btn-ghost shrink-0 px-2 py-1 text-[10px]">✕ execute</button>
                ) : (
                  <>
                    {soloThrow && (
                      <button type="button" onClick={() => setThrowIdx(null)} title="Show all" className="btn btn-ghost shrink-0 px-2 py-1 text-[10px]">all</button>
                    )}
                    <button type="button" onClick={() => stepThrow(1)} title="Next throw" aria-label="Next throw" className="btn btn-ghost shrink-0 px-2 py-1 text-xs">▶</button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="grid aspect-square w-full place-items-center rounded-xl border border-dashed border-line px-4 text-center text-sm text-muted lg:aspect-auto lg:min-h-0 lg:w-full lg:flex-1">
              {selPlayer
                ? `${selPlayer.name} threw no trackable utility${
                    view.scopeRound != null ? ` in ${scopeLabel}` : ""
                  }.`
                : "Pick a player to break down their utility."}
            </div>
          )}
        </div>

        {/* right: utility-ranked roster → the focused player's utility detail.
            The column scrolls internally; the map never gives up space. */}
        <div className="scroll-slim space-y-3 self-start lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:gap-2.5 lg:space-y-0 lg:self-stretch lg:overflow-y-auto">
          {executes.length > 0 && (
            <div className="card-2 px-3 py-2.5 lg:shrink-0">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="stat-label">Team executes</span>
                <span className="text-[10px] tabular-nums text-faint">
                  {executes.length} detected · won {executes.filter((e) => e.won).length}
                </span>
              </div>
              <div className="scroll-slim max-h-40 space-y-1 overflow-y-auto pr-1">
                {executes.map((ex, i) => {
                  const z = execZone(ex);
                  const kindStr = Object.entries(ex.kinds)
                    .map(([k, c]) => `${c} ${KIND_LABEL[k]?.toLowerCase() ?? k}`)
                    .join(" + ");
                  const active = teamPin === i;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setTeamPin(active ? null : i)}
                      aria-pressed={active}
                      title="Play this execute's grenades together on the map"
                      className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-left transition ${
                        active ? "border-brand/50 bg-brand/5" : "border-line hover:bg-panel/50"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2 text-xs">
                        <span className="shrink-0 font-semibold" style={{ color: ex.side === "T" ? T_SOFT_HEX : CT_SOFT_HEX }}>
                          R{ex.rn} {ex.side}
                        </span>
                        <span className="truncate text-faint">
                          {z ? `${z} · ` : ""}{kindStr}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-[10px] tabular-nums">
                        {ex.plantDelay != null && <span className="text-mid" title="bomb planted this long after the last grenade">plant +{ex.plantDelay}s</span>}
                        <span className={ex.won ? "text-good" : "text-bad"}>{ex.won ? "won" : "lost"}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-1.5 text-[9px] text-faint">
                3+ grenades from one side detonating within 10s — click to replay the package on the map
              </div>
            </div>
          )}

          <div className="card-2 px-3 py-2.5 lg:shrink-0">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1.5">
              <span className="stat-label">Players</span>
              <div className="flex items-center gap-1">
                <span className="text-[9px] uppercase tracking-wider text-faint">Sort</span>
                <div className="flex flex-wrap rounded-lg border border-line bg-panel p-0.5">
                  {SORTS.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setSortKey(s.key)}
                      aria-pressed={sortKey === s.key}
                      title={s.title}
                      className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium transition ${
                        sortKey === s.key ? "bg-brand/15 text-brand" : "text-muted hover:text-ink"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mb-0.5 flex items-center gap-1.5 px-2 pl-3 text-[9px] uppercase tracking-wider text-faint">
              <span className="w-4" />
              <span className="w-2" />
              <span className="min-w-0 flex-1">Player</span>
              <span className="w-12 text-right">Nades/rd</span>
              <span className="w-14 truncate whitespace-nowrap text-right text-brand/80">
                {SORTS.find((s) => s.key === sortKey)?.label ?? "Thrown"}
              </span>
            </div>
            <div className="space-y-0.5">
              {sortedPlayers.map((p, idx) => (
                <div
                  key={p.i}
                  ref={(el) => {
                    if (el) cardRefs.current.set(p.i, el);
                    else cardRefs.current.delete(p.i);
                  }}
                >
                  <RosterRow
                    p={p}
                    rank={idx + 1}
                    focused={focusI === p.i}
                    stat={statFor(p)}
                    onFocus={() => view.setFocusPlayer(view.focusPlayer === p.i ? null : p.i)}
                  />
                </div>
              ))}
            </div>
          </div>

          {selPlayer && (
            <div className="insight-card-in lg:shrink-0">
              <UtilityCard
                p={selPlayer}
                teamTotal={teamTotalOf(selPlayer)}
                timingOf={timingOf}
                activeKind={activeKind}
                extras={extrasOf(selPlayer.i)}
                execJoin={(() => {
                  const mine = executes.filter((ex) => {
                    const r = rounds[ex.ri];
                    const roster = ex.side === "CT" ? r?.ct : r?.t;
                    return roster?.includes(selPlayer.i);
                  });
                  if (!mine.length) return null;
                  const joined = mine.filter((ex) => ex.bys.includes(selPlayer.i));
                  return {
                    joined: joined.length,
                    eligible: mine.length,
                    inExec: joined.reduce((s, ex) => s + ex.bys.filter((b) => b === selPlayer.i).length, 0),
                  };
                })()}
                onUtil={pickUtil}
              />
            </div>
          )}

          {/* every throw of the active kind — hover previews it, click pins it */}
          {selPlayer && activeKind && selThrows.length > 0 && (
            <div className="card-2 px-3 py-2.5 lg:shrink-0">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="stat-label">
                  {selThrows.length} {activeKindLabel}
                </span>
                <span className="text-[10px] text-faint">hover = preview · click = pin · dashed = throw → land</span>
              </div>
              <div className="scroll-slim max-h-56 space-y-1 overflow-y-auto pr-1 lg:max-h-64">
                {selThrows.map((tw, i) => (
                  <ThrowRow
                    key={`${tw.round}-${tw.t}-${i}`}
                    tw={tw}
                    zone={zoneOf(tw.x, tw.y)}
                    timing={timingOf(tw)}
                    active={shownIdx === i}
                    showKind={showAll}
                    onClick={() => setThrowIdx(throwIdx === i ? null : i)}
                    onEnter={() => setHoverIdx(i)}
                    onLeave={() => setHoverIdx(null)}
                  />
                ))}
              </div>
              {(spots.length > 1 || (spots.length === 1 && spots[0].count >= 2)) && (
                <div className="mt-2 border-t border-line pt-2">
                  <div className="stat-label mb-1">Repeated lineups</div>
                  <div className="flex flex-wrap gap-1">
                    {spots.slice(0, 6).map((sp, i) => {
                      const z = zoneOf(sp.cx, sp.cy);
                      const first = selThrows.indexOf(sp.throws[0]);
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => first >= 0 && setThrowIdx(first)}
                          onMouseEnter={() => first >= 0 && setHoverIdx(first)}
                          onMouseLeave={() => setHoverIdx(null)}
                          title={`${sp.count}× · usually ${timingOf(sp.throws[0])} · avg ${mmss(sp.avgT)} · R${sp.throws.map((t) => t.round).join(", R")}`}
                          className="pill bg-panel text-muted hover:text-ink"
                        >
                          {z ?? "spot"} ×{sp.count}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {selPlayer && (
            <UtilTimeline
              rounds={rounds}
              meta={meta}
              i={selPlayer.i}
              scope={view.scopeRound}
              onPick={(ri) => view.setScopeRound(view.scopeRound === ri ? null : ri)}
            />
          )}

          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 text-[10px] text-faint lg:shrink-0">
            <span className="font-semibold text-muted">Match utility ({scopeLabel}):</span>
            <span className="tabular-nums">
              {u.smoke} smoke · {u.flash} flash · {u.molotov} molly · {u.he} HE · {u.decoy} decoy
            </span>
            <span className="ml-auto tabular-nums">{u.perRound.toFixed(1)}/round</span>
          </div>

          <p className="px-1 text-[10px] leading-relaxed text-faint lg:shrink-0">
            <span className="font-semibold text-muted">Data notes:</span> Flash stats are enemies
            blinded + blind-seconds dealt, not flash-assists (we don&apos;t tie a flash to a
            teammate&apos;s kill). Molotov/HE damage is enemy HP dealt by that grenade. Timing buckets use detonation time relative to each round's freeze end: early = first 25s, mid = 25–55s, late = later.
          </p>

          <div className="flex items-center justify-between gap-2 px-1 text-[11px] text-faint lg:shrink-0">
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
    </div>
  );
}
