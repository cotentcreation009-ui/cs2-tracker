"use client";

// Utility — the grenade lens. This tab specializes in one thing: how this
// lobby uses utility. A full-height throw explorer (animated lineups on the
// radar) is the centerpiece; players are picked via the toolbar chips, and
// the rail carries the focused player's utility card (kinds, victims blinded,
// burn damage, execute timing, team share), their repeated lineups, and the
// per-side team packages ("Team util by round").

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

// Victim split for one flash throw, classified against that round's rosters.
// Built from ReplayNade.vic — absent on old parses, so callers degrade to null.
interface FlashVic {
  e: number; // enemies blinded
  tm: number; // teammates blinded (self excluded)
  self: number;
  eDur: number; // blind seconds
  tmDur: number;
  selfDur: number;
}
const vicTitle = (v: FlashVic) => {
  const parts: string[] = [];
  if (v.e) parts.push(`${v.e} enem${v.e === 1 ? "y" : "ies"} (${v.eDur.toFixed(1)}s)`);
  if (v.tm) parts.push(`${v.tm} teammate${v.tm === 1 ? "" : "s"} (${v.tmDur.toFixed(1)}s)`);
  if (v.self) parts.push(`self (${v.selfDur.toFixed(1)}s)`);
  return parts.length ? `blinded ${parts.join(" · ")}` : "detonated without blinding anyone";
};

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

function Stat({ label, value, sub, title }: { label: string; value: ReactNode; sub?: ReactNode; title?: string }) {
  return (
    <div className="rounded-lg bg-panel/50 px-2.5 py-2" title={title}>
      <div className="stat-label">{label}</div>
      <div className="mt-0.5 text-base font-bold tabular-nums text-ink">{value}</div>
      {sub != null && sub !== "" && <div className="text-[10px] text-faint">{sub}</div>}
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
// "Copy practice command" — the Refrag-style trick from data we already store:
// teleport to the throw origin facing the landing spot on a private server
// (sv_cheats 1). The demo records positions, not view angles, so the pitch
// points AT the landing — the thrower arcs their aim up from there.
function CopyThrowButton({ tw }: { tw: UtilThrow }) {
  const [ok, setOk] = useState(false);
  const oz = tw.oz; // capture so the closure keeps the narrowing
  if (oz == null) return null; // legacy parse — no origin height recorded
  const copy = () => {
    const dx = tw.x - tw.ox;
    const dy = tw.y - tw.oy;
    const dz = (tw.z ?? oz) - oz;
    const yaw = (Math.atan2(dy, dx) * 180) / Math.PI;
    const pitch = -(Math.atan2(dz, Math.hypot(dx, dy)) * 180) / Math.PI;
    // origin is the projectile spawn (eye-ish) — drop ~60u so setpos lands feet
    const cmd = `setpos_exact ${tw.ox.toFixed(1)} ${tw.oy.toFixed(1)} ${(oz - 60).toFixed(1)}; setang ${pitch.toFixed(1)} ${yaw.toFixed(1)} 0`;
    void navigator.clipboard?.writeText(cmd).then(() => {
      setOk(true);
      setTimeout(() => setOk(false), 1200);
    });
  };
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy a practice-server command — teleports you to this throw's spot facing the landing (needs sv_cheats 1; demos don't record view angles, so raise your aim to arc it)"
      className={`pill shrink-0 self-center transition ${ok ? "bg-good/15 text-good" : "bg-panel text-faint hover:text-brand"}`}
    >
      {ok ? "copied ✓" : "practice"}
    </button>
  );
}

function ThrowRow({
  tw,
  zone,
  timing,
  active,
  showKind,
  vic,
  onClick,
  onEnter,
  onLeave,
}: {
  tw: UtilThrow;
  zone: string | null;
  timing: Timing;
  active: boolean;
  showKind?: boolean;
  vic?: FlashVic | null; // flash throws on new parses only
  onClick: () => void;
  onEnter?: () => void;
  onLeave?: () => void;
}) {
  return (
    // wrapper keeps the hover-preview alive while reaching the practice chip;
    // the chip is a SIBLING button (interactive-inside-interactive is invalid)
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className={`flex w-full items-stretch gap-1 rounded-lg border px-1 transition ${
        active ? "border-brand/50 bg-brand/5" : "border-line hover:bg-panel/50"
      }`}
    >
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2 py-1.5 text-left"
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
        {tw.kind === "flash" &&
          vic &&
          (vic.e + vic.tm + vic.self > 0 ? (
            <span className="pill bg-panel tabular-nums text-muted" title={vicTitle(vic)}>
              {vic.e}E
              {vic.tm > 0 && <span className="text-bad"> · {vic.tm}T ⚠</span>}
            </span>
          ) : (
            <span className="pill bg-panel text-faint" title="detonated without blinding anyone">
              blank
            </span>
          ))}
        <TimingBadge timing={timing} />
        <span className="tabular-nums">{mmss(tw.t)}</span>
      </span>
    </button>
    <CopyThrowButton tw={tw} />
    </div>
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
    // slim full-width band living right under the toolbar's round chips —
    // header + legend share one line, the cells stretch across the width
    <div className="card-2 px-3 py-2 lg:shrink-0">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
        <span className="stat-label">
          Utility per round · <span className="text-ink">{meta.players[i]?.name ?? "?"}</span>
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-x-3 text-[9px] text-faint">
          <span>number = thrown (gold 3+)</span>
          <span>dots = kinds</span>
          <span>
            <span className="text-good">green</span> / <span className="text-bad">red</span> = won / lost
          </span>
          <span className="text-muted">click a round to scope every tab to it</span>
        </span>
      </div>
      <div className="scroll-slim flex flex-wrap justify-center gap-1 lg:flex-nowrap lg:overflow-x-auto lg:pb-0.5">
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
              className={`flex h-11 w-8 shrink-0 flex-col items-center justify-center gap-0.5 rounded border leading-none transition ${active ? "ring-2 ring-brand" : ""} ${
                side == null
                  ? "border-line bg-panel/40 opacity-40"
                  : won
                    ? "border-good/40 bg-good/10 hover:brightness-150"
                    : "border-bad/30 bg-bad/10 hover:brightness-150"
              }`}
            >
              <span className="text-[8px] tabular-nums leading-none text-faint">{r.n}</span>
              {side == null ? (
                <span className="text-xs leading-none text-faint">–</span>
              ) : (
                <>
                  <span
                    className="text-xs font-bold leading-none tabular-nums"
                    style={nades.length >= 3 ? { color: "#f5b942" } : nades.length === 0 ? { opacity: 0.35 } : undefined}
                  >
                    {nades.length}
                  </span>
                  <span className="flex gap-px">
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
  tf: number; // teammates flashed (new parses only — 0 on old parses)
  tfDur: number; // teammate blind seconds dealt
  fa: number; // flash assists — kills where a teammate finished an enemy they blinded
  // grenade output by buy tier (per this player's buy bucket that round)
  tier: Record<string, { rds: number; nades: number; low: number }>; // low = rounds with <=1 nade
}

function UtilityCard({
  p,
  teamTotal,
  timingOf,
  activeKind,
  extras,
  execJoin,
  hasTf,
  hasFa,
  onUtil,
}: {
  p: PlayerInsight;
  teamTotal: number; // nades thrown by their whole team (for the share)
  timingOf: (tw: { t: number; round: number }) => Timing;
  activeKind: string | null;
  extras: UtilExtras;
  execJoin: { joined: number; eligible: number; inExec: number } | null;
  hasTf: boolean; // this parse tracks teammates flashed
  hasFa: boolean; // this parse tracks flash assists
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
          title={
            hasTf
              ? `enemies: ${p.enemiesFlashed} blinded, ${p.flashDuration.toFixed(1)}s · teammates: ${extras.tf} blinded, ${extras.tfDur.toFixed(1)}s`
              : undefined
          }
          sub={
            extras.flashThrows > 0 || hasTf ? (
              <>
                {extras.flashThrows > 0 &&
                  `${perFlash.toFixed(1)}/flash · ${extras.blankFlashRounds} blank rd${extras.blankFlashRounds === 1 ? "" : "s"}`}
                {hasTf && (
                  <>
                    {extras.flashThrows > 0 && " · "}
                    <span className={extras.tf > 0 ? "text-bad" : undefined}>
                      {extras.tf} teammate{extras.tf === 1 ? "" : "s"}
                      {extras.tf > 0 ? " ⚠" : ""}
                    </span>
                  </>
                )}
              </>
            ) : undefined
          }
        />
        {hasFa && (
          <Stat
            label="Flash assists"
            value={`${extras.fa}`}
            sub="teammate kills off their flashes"
          />
        )}
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
          title="team util rounds = their side threw 3+ grenades that round; joined = this player contributed at least one of them"
        >
          <span className="text-faint">Team util rounds</span> · joined {execJoin!.joined}/{execJoin!.eligible}
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

// ------------------------------------------------- lobby-wide util table ---

type LobbyCol = "npr" | "dmg" | "ef" | "tf" | "blank" | "waste" | "fa";

/** Every player's utility discipline in one sortable strip — the lobby
 *  comparison the per-player card can't give. Click a header to re-rank,
 *  click a row to focus that player everywhere. */
function LobbyUtilTable({
  players,
  extrasOf,
  hasTf,
  hasFa,
  hasStats,
  focusI,
  onFocus,
}: {
  players: PlayerInsight[];
  extrasOf: (i: number) => UtilExtras;
  hasTf: boolean;
  hasFa: boolean;
  hasStats: boolean; // per-round stats exist — blank rounds are attestable
  focusI: number | null;
  onFocus: (i: number) => void;
}) {
  const [sortBy, setSortBy] = useState<LobbyCol>("npr");
  const val = (p: PlayerInsight, c: LobbyCol): number => {
    const e = extrasOf(p.i);
    switch (c) {
      case "npr": return p.roundsPlayed ? p.utilNades.length / p.roundsPlayed : 0;
      case "dmg": return p.utilDamage;
      case "ef": return p.enemiesFlashed;
      case "tf": return e.tf;
      case "blank": return e.blankFlashRounds;
      case "waste": return e.wastedDollars;
      case "fa": return e.fa;
    }
  };
  const cols: { key: LobbyCol; label: string; bad?: boolean; title: string }[] = [
    { key: "npr", label: "n/rd", title: "grenades thrown per round played" },
    { key: "dmg", label: "dmg", title: "HP dealt with HE/molotov" },
    { key: "ef", label: "blind", title: "enemies flashed (hover a row for blind seconds)" },
    ...(hasTf ? [{ key: "tf" as const, label: "tm⚠", bad: true, title: "teammates flashed — lower is better" }] : []),
    ...(hasStats
      ? [{ key: "blank" as const, label: "blank", bad: true, title: "rounds with 1+ flash thrown and zero enemies blinded — lower is better" }]
      : []),
    { key: "waste", label: "$ lost", bad: true, title: "est. value of grenades still in pocket on death — lower is better" },
    ...(hasFa ? [{ key: "fa" as const, label: "FA", title: "flash assists — teammate kills off their flashes" }] : []),
  ];
  const rows = players.slice().sort((a, b) => val(b, sortBy) - val(a, sortBy));
  const max = new Map<LobbyCol, number>(cols.map((c) => [c.key, Math.max(...rows.map((p) => val(p, c.key)))]));
  const fmt = (c: LobbyCol, v: number) =>
    c === "npr" ? v.toFixed(1) : c === "waste" ? (v > 0 ? `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}` : "0") : String(v);
  return (
    <div className="card-2 px-3 py-2.5 lg:shrink-0">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="stat-label">Lobby utility</span>
        <span className="text-[10px] text-faint">click a column to rank · row = focus</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_repeat(var(--nc),minmax(34px,auto))] items-center gap-x-2 gap-y-0.5" style={{ "--nc": cols.length } as React.CSSProperties}>
        <span />
        {cols.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setSortBy(c.key)}
            aria-pressed={sortBy === c.key}
            title={c.title}
            className={`text-right text-[9px] font-bold uppercase tracking-wide transition ${
              sortBy === c.key ? "text-brand" : "text-faint hover:text-ink"
            }`}
          >
            {c.label}
          </button>
        ))}
        {rows.map((p) => {
          const e = extrasOf(p.i);
          const on = focusI === p.i;
          return (
            <button
              key={p.i}
              type="button"
              onClick={() => onFocus(p.i)}
              aria-pressed={on}
              title={`${p.name} · ${p.utilNades.length} nades in ${p.roundsPlayed} rounds${p.flashDuration > 0 ? ` · ${p.flashDuration.toFixed(1)}s enemy blind dealt` : ""}${hasTf && e.tfDur > 0 ? ` · ${e.tfDur.toFixed(1)}s teammate blind` : ""}`}
              className={`col-span-full grid grid-cols-subgrid items-center rounded px-0 py-0.5 text-left transition ${
                on ? "bg-brand/10" : "hover:bg-panel/60"
              }`}
            >
              <span className="flex min-w-0 items-center gap-1.5 text-[11px]">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: sideHex(p.team) }} />
                <span className={`truncate ${on ? "font-bold text-brand" : "text-ink"}`}>{p.name}</span>
              </span>
              {cols.map((c) => {
                const v = val(p, c.key);
                const isMax = v > 0 && v === max.get(c.key);
                return (
                  <span
                    key={c.key}
                    className={`text-right text-[11px] tabular-nums ${
                      isMax ? (c.bad ? "font-bold text-bad" : "font-bold text-ink") : v === 0 ? "text-faint" : "text-muted"
                    }`}
                  >
                    {fmt(c.key, v)}
                  </span>
                );
              })}
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 text-[9px] text-faint">
        bold = lobby-leading (<span className="text-bad">red</span> where leading is bad) · $ lost is a conservative estimate
      </div>
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
  // CT/T filter for the focused player's throws (halftime-aware, match view)
  const [nadeSide, setNadeSide] = useState<"all" | "CT" | "T">("all");
  const [throwIdx, setThrowIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [teamPin, setTeamPin] = useState<number | null>(null); // index into executes
  const [zones, setZones] = useState<Zone[]>([]);

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

  // Halftime-aware roster: PlayerInsight.team is the match-START side, but
  // teams switch at half — when a round is scoped, resolve each player's side
  // from THAT round's roster (same semantics as the Scoreboard), so the side
  // filter matches what's on screen instead of silently dropping the player.
  const players = useMemo(() => {
    const scopedR = view.scopeRound != null ? rounds[view.scopeRound] : null;
    const resolved = data.players.map((p) => {
      if (!scopedR) return p;
      const side = scopedR.ct?.includes(p.i) ? "CT" : scopedR.t?.includes(p.i) ? "T" : p.team;
      return side === p.team ? p : { ...p, team: side as PlayerInsight["team"] };
    });
    return resolved.filter((p) => view.side === "all" || p.team === view.side);
  }, [data, view.side, view.scopeRound, rounds]);

  // per-player waste/effectiveness reads joined from the raw rounds
  const extrasOf = useMemo(() => {
    const m = new Map<number, UtilExtras>();
    const get = (i: number) => {
      let v = m.get(i);
      if (!v) {
        v = { blankFlashRounds: 0, flashThrows: 0, diedWithUtilRounds: [], wastedDollars: 0, ctThrows: 0, tThrows: 0, utilTaken: 0, nadeDeaths: 0, tf: 0, tfDur: 0, fa: 0, tier: {} };
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
        // flash assists (new parses): credit the assister when the assist was a flash
        if (k.fa && (k.a ?? 0) > 0) get(k.a! - 1).fa++;
      }
      // grenade output by the thrower's own buy tier that round
      for (const st of r.stats ?? []) {
        const e = get(st.i);
        // team-flash discipline (new parses — fields absent on old parses)
        e.tf += st.tf ?? 0;
        e.tfDur += st.tfDur ?? 0;
        const buy = st.buy ?? (st.equip != null ? classifyBuy(st.equip, r.n).key : null);
        if (!buy) continue;
        const t = (e.tier[buy] ??= { rds: 0, nades: 0, low: 0 });
        t.rds++;
        const thrown = thrownBy.get(st.i) ?? 0;
        t.nades += thrown;
        if (thrown <= 1) t.low++;
      }
      for (const [i, nFlash] of flashesBy) {
        // a blank round needs a stats entry to ATTEST zero enemies blinded —
        // on stats-less old parses the ?? 0 fallback would brand every flash
        // round blank (while the blinded column reads 0), a confident lie
        const st = (r.stats ?? []).find((s) => s.i === i);
        if (nFlash > 0 && st && (st.flashed ?? 0) === 0) {
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
      m.get(i) ?? { blankFlashRounds: 0, flashThrows: 0, diedWithUtilRounds: [], wastedDollars: 0, ctThrows: 0, tThrows: 0, utilTaken: 0, nadeDeaths: 0, tf: 0, tfDur: 0, fa: 0, tier: {} };
  }, [scopedRounds]);

  // capability probes — the new parser fields are omitted when zero, so "present
  // anywhere in the demo" is the best available signal. When absent everywhere
  // (old parse, or nothing to report) every surface degrades to the old view.
  const hasTf = useMemo(
    () => rounds.some((r) => (r.stats ?? []).some((s) => (s.tf ?? 0) > 0 || (s.tfDur ?? 0) > 0)),
    [rounds],
  );
  const hasFa = useMemo(
    () => rounds.some((r) => (r.kills ?? []).some((k) => k.fa && (k.a ?? 0) > 0)),
    [rounds],
  );
  // per-round stats present at all — without them "blank flash rounds" can't be
  // attested and that column must not render
  const hasStats = useMemo(() => rounds.some((r) => (r.stats ?? []).length > 0), [rounds]);

  // per-flash victim splits from ReplayNade.vic (new parses), keyed so a
  // UtilThrow (round n + time + thrower) can find its raw nade again
  const flashVics = useMemo(() => {
    const m = new Map<string, FlashVic>();
    for (const r of rounds) {
      for (const nd of r.nades ?? []) {
        if (nd.k !== "flash" || !nd.vic || nd.by < 0) continue;
        const byCT = r.ct?.includes(nd.by);
        const byT = r.t?.includes(nd.by);
        if (!byCT && !byT) continue; // no roster — can't classify victims
        const fv: FlashVic = { e: 0, tm: 0, self: 0, eDur: 0, tmDur: 0, selfDur: 0 };
        for (const [vi, dur] of Object.entries(nd.vic)) {
          const v = Number(vi);
          if (v === nd.by) {
            fv.self++;
            fv.selfDur += dur;
          } else if (byCT ? r.ct?.includes(v) : r.t?.includes(v)) {
            fv.tm++;
            fv.tmDur += dur;
          } else if (byCT ? r.t?.includes(v) : r.ct?.includes(v)) {
            fv.e++;
            fv.eDur += dur;
          }
        }
        m.set(`${r.n}:${nd.t}:${nd.by}`, fv);
      }
    }
    return m;
  }, [rounds]);
  const flashVicOf = (tw: { round: number; t: number }, by: number): FlashVic | null =>
    flashVics.get(`${tw.round}:${tw.t}:${by}`) ?? null;


  // utility awards — quick scan + click to focus
  const awards = useMemo(() => {
    if (!players.length) return [];
    const top = (fn: (p: PlayerInsight) => number) =>
      players.reduce((b, p) => (fn(p) > fn(b) ? p : b), players[0]);
    const out: { label: string; p: PlayerInsight; val: string; warn?: string; icon: AwardKind }[] = [];
    const util = top((p) => p.utilNades.length);
    if (util.utilNades.length > 0)
      out.push({ label: "Most utility", p: util, val: `${util.utilNades.length} nades`, icon: "util" });
    // rank by NET flashes (enemies − teammates) when the parse tracks team-flashes
    const flash = top((p) => p.enemiesFlashed - (hasTf ? extrasOf(p.i).tf : 0));
    if (flash.enemiesFlashed > 0) {
      const tf = hasTf ? extrasOf(flash.i).tf : 0;
      out.push({
        label: "Flash king",
        p: flash,
        val: `${flash.enemiesFlashed} blinded · ${flash.flashDuration.toFixed(0)}s`,
        warn: tf > 0 ? `${tf} tm` : undefined,
        icon: "flash",
      });
    }
    const burn = top((p) => p.utilDamage);
    if (burn.utilDamage > 0)
      out.push({ label: "Util damage", p: burn, val: `${burn.utilDamage} dmg`, icon: "burn" });
    // clockwork: the biggest repeated same-spot lineup in the lobby
    let clock: { p: PlayerInsight; kind: string; count: number } | null = null;
    for (const p of players) {
      for (const k of UTIL_KINDS) {
        const throws = p.utilNades.filter((n) => n.kind === k);
        if (throws.length < 3) continue;
        const best = clusterUtilThrows(throws, (x, y, z) => proj.project(x, y, z))[0];
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
  }, [players, proj, hasTf, extrasOf]);

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

  // Team util, ROUND-scoped: one package per (round, side) covering ALL the
  // grenades that side threw that round — the full coordinated picture, not
  // window fragments (a 10s-window splitter used to chop one round's execute
  // into 2-3 disconnected "executes" and glue unrelated pokes together).
  // Coordination is a PROPERTY of the round instead: the tightest burst of
  // 3+ detonations. Tight burst = a real execute; no burst = spread poking.
  const executes = useMemo(() => {
    const out: {
      rn: number;
      ri: number; // index into `rounds` for scoping
      side: "CT" | "T";
      kinds: Record<string, number>;
      /** tightest span (s) containing 3+ detonations, null when < 3 nades */
      burst: number | null;
      /** throw indices (into `throws`) inside that tightest burst */
      burstIdx: Set<number>;
      plantDelay: number | null;
      won: boolean;
      bys: number[];
      throws: UtilThrow[];
    }[] = [];
    for (const r of scopedRounds) {
      const ri = rounds.indexOf(r);
      for (const side of ["CT", "T"] as const) {
        const roster = new Set(side === "CT" ? r.ct ?? [] : r.t ?? []);
        // EVERY grenade the side threw — decoys included, nothing left out
        const nades = (r.nades ?? [])
          .filter((nd) => roster.has(nd.by))
          .sort((a, b) => a.t - b.t);
        if (!nades.length) continue;
        const kinds: Record<string, number> = {};
        for (const nd of nades) {
          const k = normKind(nd.k);
          kinds[k] = (kinds[k] ?? 0) + 1;
        }
        // tightest 3-detonation burst — the execute signal
        let burst: number | null = null;
        let burstStart = 0;
        for (let i = 0; i + 2 < nades.length; i++) {
          const span = nades[i + 2].t - nades[i].t;
          if (burst == null || span < burst) {
            burst = span;
            burstStart = i;
          }
        }
        const burstIdx = new Set<number>();
        if (burst != null) {
          // absorb every nade inside the winning window's span
          const t0 = nades[burstStart].t;
          const t1 = nades[burstStart + 2].t;
          nades.forEach((nd, i) => {
            if (nd.t >= t0 && nd.t <= t1) burstIdx.add(i);
          });
        }
        // plant delay: time from the last grenade at/before the plant
        const plant = (r.bomb ?? []).find((b) => b.k === "plant");
        let plantDelay: number | null = null;
        if (plant) {
          const before = nades.filter((nd) => nd.t <= plant.t).pop();
          if (before) plantDelay = Math.max(0, Math.round(plant.t - before.t));
        }
        out.push({
          rn: r.n,
          ri,
          side,
          kinds,
          burst: burst != null ? Math.round(burst) : null,
          burstIdx,
          plantDelay,
          won: r.winner === side,
          bys: nades.map((nd) => nd.by),
          throws: nades.map((nd) => {
            const o = throwOrigin(r, nd);
            return {
              kind: normKind(nd.k), x: nd.x, y: nd.y, round: r.n, t: nd.t,
              ox: o?.x ?? nd.ox ?? nd.x, oy: o?.y ?? nd.oy ?? nd.y,
            };
          }),
        });
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
    setNadeSide("all");
    setThrowIdx(null);
    setHoverIdx(null);
    setTeamPin(null);
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
  // Which side was the thrower on when a given nade left their hand? Teams
  // switch at half, so this reads the THROW's round roster — powering the
  // CT/T nade filter next to the map.
  const roundByN = useMemo(() => {
    const m = new Map<number, ReplayRound>();
    for (const r of rounds) m.set(r.n, r);
    return m;
  }, [rounds]);
  const throwSide = (tw: UtilThrow, pi: number): "CT" | "T" | null => {
    const r = roundByN.get(tw.round);
    return r?.ct?.includes(pi) ? "CT" : r?.t?.includes(pi) ? "T" : null;
  };
  // side filter for the focused player's throws (match view only — a scoped
  // round is single-sided already); resets when the focus changes
  const sideNades = selPlayer
    ? selPlayer.utilNades.filter(
        (n) => view.scopeRound != null || nadeSide === "all" || throwSide(n, selPlayer.i) === nadeSide,
      )
    : [];
  const selKinds: string[] = selPlayer
    ? UTIL_KINDS.filter((k) => sideNades.some((n) => n.kind === k))
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
      ? sideNades
          .filter((n) => showAll || n.kind === activeKind)
          .slice()
          .sort((a, b) => a.round - b.round || a.t - b.t)
      : [];
  const spots = activeKind && !showAll ? clusterUtilThrows(selThrows, (x, y, z) => proj.project(x, y, z)) : [];
  const activeKindLabel = showAll ? "util" : (KIND_LABEL[activeKind ?? ""] ?? activeKind ?? "").toLowerCase();
  const shownIdx = hoverIdx ?? throwIdx;
  const soloThrow = shownIdx != null && selThrows[shownIdx] ? selThrows[shownIdx] : null;
  const pinnedExec = teamPin != null ? executes[teamPin] ?? null : null;
  const mapThrows = pinnedExec ? pinnedExec.throws : soloThrow ? [soloThrow] : selThrows;
  const zoneOf = (x: number, y: number, z?: number) =>
    classifyPosition(meta.map, x, y, zones, z)?.name ?? null;
  // name a round package by the top 1-2 callouts its grenades landed in
  const execZone = (ex: (typeof executes)[number]): string | null => {
    const counts = new Map<string, number>();
    for (const tw of ex.throws) {
      const z = zoneOf(tw.x, tw.y, tw.z);
      if (z) counts.set(z, (counts.get(z) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
    if (!top.length) return null;
    // only show the runner-up when it actually matters (2+ nades there)
    return top[1] && top[1][1] >= 2 ? `${top[0][0]} + ${top[1][0]}` : top[0][0];
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
      {/* per-round utility strip — sits directly under the toolbar's round
          chips so the round story reads top-down */}
      {selPlayer && (
        <UtilTimeline
          rounds={rounds}
          meta={meta}
          i={selPlayer.i}
          scope={view.scopeRound}
          onPick={(ri) => view.setScopeRound(view.scopeRound === ri ? null : ri)}
        />
      )}
      {/* awards — one slim band, not a row of floating cards */}
      {awards.length > 0 && (
        <div className="card-2 flex flex-wrap items-center gap-x-1 gap-y-1 px-2 py-1.5 lg:shrink-0">
          {awards.map((a, ai) => {
            const hex = sideHex(a.p.team);
            const on = focusI === a.p.i;
            return (
              <span key={a.label} className="flex min-w-0 items-center">
                {ai > 0 && <span className="mx-1.5 hidden h-3 w-px bg-line sm:block" />}
                <button
                  type="button"
                  onClick={() => view.setFocusPlayer(view.focusPlayer === a.p.i ? null : a.p.i)}
                  aria-pressed={on}
                  title={`Focus ${a.p.name}`}
                  className={`flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-left transition ${
                    on ? "bg-brand/10" : "hover:bg-panel"
                  }`}
                >
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md" style={{ background: `${hex}1f`, color: hex }}>
                    <AwardIcon kind={a.icon} className="h-3 w-3" />
                  </span>
                  <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-faint">{a.label}</span>
                  <span className="max-w-28 truncate text-xs font-bold" style={{ color: hex }}>
                    {a.p.name}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-muted">{a.val}</span>
                  {a.warn && (
                    <span className="shrink-0 text-[10px] tabular-nums text-bad" title="teammates flashed — counted against this ranking">
                      ⚠ {a.warn}
                    </span>
                  )}
                </button>
              </span>
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
          <div className="mb-1.5 flex w-full items-center gap-x-2">
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
                {selPlayer.enemiesFlashed > 0 && hasTf && extrasOf(selPlayer.i).tf > 0 && (
                  <span
                    className="text-bad"
                    title={`flashed ${extrasOf(selPlayer.i).tf} teammates for ${extrasOf(selPlayer.i).tfDur.toFixed(1)}s`}
                  >
                    {" "}· {extrasOf(selPlayer.i).tf} tm ⚠
                  </span>
                )}
                {selPlayer.enemiesFlashed > 0 && selPlayer.utilDamage > 0 && " · "}
                {selPlayer.utilDamage > 0 && `${selPlayer.utilDamage} util dmg`}
              </span>
            )}
          </div>
          {selPlayer && selKinds.length > 0 && (
            <div className="scroll-slim mb-2 flex w-full flex-wrap gap-1 lg:flex-nowrap lg:overflow-x-auto">
              {selKinds.length > 1 && (
                <button
                  type="button"
                  onClick={() => pickKind("all")}
                  title="Show every grenade on the map at once"
                  className={`pill shrink-0 whitespace-nowrap font-semibold transition ${
                    showAll ? "bg-brand/15 text-brand" : "bg-panel text-muted hover:text-ink"
                  }`}
                >
                  ✦ All {sideNades.length}
                </button>
              )}
              {view.scopeRound == null && (
                <span className="ml-auto flex shrink-0 rounded-lg border border-line bg-panel p-0.5" title="Only their grenades thrown while playing this side — teams switch at half, so this follows the round rosters">
                  {(["all", "CT", "T"] as const).map((sd) => (
                    <button
                      key={sd}
                      type="button"
                      onClick={() => setNadeSide(sd)}
                      aria-pressed={nadeSide === sd}
                      className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition ${
                        nadeSide === sd ? "bg-brand/15 text-brand" : "text-muted hover:text-ink"
                      }`}
                      style={nadeSide === sd && sd !== "all" ? { color: sd === "T" ? T_SOFT_HEX : CT_SOFT_HEX } : undefined}
                    >
                      {sd === "all" ? "Both" : sd}
                    </button>
                  ))}
                </span>
              )}
              {selKinds.map((k) => {
                const n = sideNades.filter((x) => x.kind === k).length;
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
            <div className="flex w-full flex-col gap-3 lg:min-h-0 lg:flex-1 lg:flex-row lg:items-stretch">
            <div className="relative mx-auto w-full max-w-180 self-center lg:mx-0 lg:w-[min(calc(100cqw-17.5rem),calc(100cqh-72px))] lg:max-w-none lg:shrink-0">
              <UtilThrowMap map={meta.map} proj={proj} throws={mapThrows} timeline={!!pinnedExec} className="w-full" />

              <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-1.5 rounded-b-xl border-t border-line/60 bg-bg/80 px-2.5 py-1.5 backdrop-blur">
                {!pinnedExec && (
                  <button type="button" onClick={() => stepThrow(-1)} title="Previous throw" aria-label="Previous throw" className="btn btn-ghost shrink-0 px-2 py-1 text-xs">◀</button>
                )}
                <div className="min-w-0 flex-1 text-center text-[11px]">
                  {pinnedExec ? (
                    <span>
                      <span className="font-semibold" style={{ color: pinnedExec.side === "T" ? T_SOFT_HEX : CT_SOFT_HEX }}>
                        R{pinnedExec.rn} {pinnedExec.side} team util
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
                      {zoneOf(soloThrow.x, soloThrow.y, soloThrow.z) && <span className="text-faint"> · {zoneOf(soloThrow.x, soloThrow.y, soloThrow.z)}</span>}
                      <span className="text-brand"> · {timingOf(soloThrow)}</span>
                      {(soloThrow.kind === "he" || soloThrow.kind === "molotov") && (
                        <span className={soloThrow.dmg ? "text-bad" : "text-faint"}>
                          {" "}· {soloThrow.dmg ? `${soloThrow.dmg} dmg` : "dud"}
                        </span>
                      )}
                      {soloThrow.kind === "flash" &&
                        selPlayer &&
                        (() => {
                          const fv = flashVicOf(soloThrow, selPlayer.i);
                          if (!fv) return null;
                          return fv.e + fv.tm + fv.self > 0 ? (
                            <span title={vicTitle(fv)}>
                              {" "}· <span className="text-ink">{fv.e}E</span>
                              {fv.tm > 0 && <span className="text-bad"> · {fv.tm}T ⚠</span>}
                            </span>
                          ) : (
                            <span className="text-faint"> · blank</span>
                          );
                        })()}
                    </span>
                  ) : (
                    <span className="text-muted">
                      {selThrows.length} {activeKindLabel} — hover a row or ◀ ▶ to step
                    </span>
                  )}
                </div>
                {pinnedExec ? (
                  <button type="button" onClick={() => setTeamPin(null)} title="Back to the focused player's throws" className="btn btn-ghost shrink-0 px-2 py-1 text-[10px]">✕ team util</button>
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

            {/* the throw list lives beside the map: hover previews, click pins */}
            {selPlayer && activeKind && selThrows.length > 0 && (
              <div className="min-w-0 flex-1 rounded-xl border border-line/60 bg-panel/20 px-3 py-2.5 lg:flex lg:min-h-0 lg:flex-col">
                <div className="mb-1.5 flex items-center justify-between gap-2 lg:shrink-0">
                  <span className="stat-label">
                    {selThrows.length} {activeKindLabel}
                  </span>
                  <span className="hidden text-[10px] text-faint min-[1400px]:inline">hover = preview · click = pin</span>
                </div>
                <div className="scroll-slim max-h-56 space-y-1 overflow-y-auto pr-1 lg:max-h-none lg:min-h-0 lg:flex-1">
                  {selThrows.map((tw, i) => (
                    <ThrowRow
                      key={`${tw.round}-${tw.t}-${i}`}
                      tw={tw}
                      zone={zoneOf(tw.x, tw.y, tw.z)}
                      timing={timingOf(tw)}
                      active={shownIdx === i}
                      showKind={showAll}
                      vic={tw.kind === "flash" ? flashVicOf(tw, selPlayer.i) : null}
                      onClick={() => setThrowIdx(throwIdx === i ? null : i)}
                      onEnter={() => setHoverIdx(i)}
                      onLeave={() => setHoverIdx(null)}
                    />
                  ))}
                </div>
                {(spots.length > 1 || (spots.length === 1 && spots[0].count >= 2)) && (
                  <div className="mt-2 border-t border-line pt-2 lg:shrink-0">
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

        {/* right: the focused player's utility detail (players are picked via
            the toolbar chips). The column scrolls internally; the map never
            gives up space. */}
        <div className="scroll-slim space-y-3 self-start lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:gap-2.5 lg:space-y-0 lg:self-stretch lg:overflow-y-auto">
          {selPlayer && (
            <div className="insight-card-in lg:shrink-0">
              <UtilityCard
                p={selPlayer}
                teamTotal={teamTotalOf(selPlayer)}
                timingOf={timingOf}
                activeKind={activeKind}
                extras={extrasOf(selPlayer.i)}
                hasTf={hasTf}
                hasFa={hasFa}
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

          {players.length > 1 && (
            <LobbyUtilTable
              players={players}
              extrasOf={extrasOf}
              hasTf={hasTf}
              hasFa={hasFa}
              hasStats={hasStats}
              focusI={focusI}
              onFocus={(i) => view.setFocusPlayer(view.focusPlayer === i ? null : i)}
            />
          )}

          {executes.length > 0 && (
            <div className="card-2 px-3 py-2.5 lg:shrink-0">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="stat-label">Team util by round</span>
                <span className="text-[10px] tabular-nums text-faint">
                  {executes.length} rounds · won {executes.filter((e) => e.won).length}
                </span>
              </div>
              <div className="scroll-slim max-h-56 space-y-1 overflow-y-auto pr-1">
                {executes.map((ex, i) => {
                  const z = execZone(ex);
                  const active = teamPin === i;
                  // tight burst of 3+ detonations = a real execute; otherwise
                  // the util was spread through the round
                  const tight = ex.burst != null && ex.burst <= 12;
                  const showBadge = ex.throws.length >= 3;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setTeamPin(active ? null : i)}
                      aria-pressed={active}
                      title="Replay ALL of this side's grenades for the round on the map"
                      className={`w-full rounded-lg border px-3 py-1.5 text-left transition ${
                        active ? "border-brand/50 bg-brand/5" : "border-line hover:bg-panel/50"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2 text-xs">
                          <span className="shrink-0 font-semibold" style={{ color: ex.side === "T" ? T_SOFT_HEX : CT_SOFT_HEX }}>
                            R{ex.rn} {ex.side}
                          </span>
                          {showBadge && (tight ? (
                            <span
                              className="shrink-0 rounded-full bg-brand/10 px-1.5 text-[9px] font-bold tracking-wide text-brand"
                              title={`Execute — 3+ grenades detonated within ${ex.burst}s of each other`}
                            >
                              EXECUTE {ex.burst}s
                            </span>
                          ) : (
                            <span
                              className="shrink-0 rounded-full bg-panel px-1.5 text-[9px] font-bold tracking-wide text-faint"
                              title={
                                ex.burst != null
                                  ? `Spread — the tightest 3 detonations span ${ex.burst}s`
                                  : "Spread through the round"
                              }
                            >
                              SPREAD
                            </span>
                          ))}
                          {z && <span className="truncate text-muted">{z}</span>}
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-[10px] tabular-nums">
                          {ex.plantDelay != null && (
                            <span className="text-mid" title="bomb planted this long after their last grenade before it">
                              plant +{ex.plantDelay}s
                            </span>
                          )}
                          <span className={ex.won ? "text-good" : "text-bad"}>{ex.won ? "won" : "lost"}</span>
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 text-[10px] text-faint">
                        {UTIL_KINDS.filter((k) => ex.kinds[k]).map((k) => (
                          <span key={k} className="flex items-center gap-1 tabular-nums">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: KIND_COLOR[k] ?? "#8a7dff" }} />
                            {ex.kinds[k]} {KIND_LABEL[k]?.toLowerCase() ?? k}
                          </span>
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-1.5 text-[9px] text-faint">
                Every grenade a side threw that round — EXECUTE = a tight 3-nade burst · replay animates in true throw order
              </div>
            </div>
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
            blinded + blind-seconds dealt.{" "}
            {hasFa
              ? "Flash assists (a teammate killing an enemy this player blinded) are counted from the kill feed."
              : "No flash assists recorded — parses made before flash-assist tracking don't capture them; re-parse older demos to add them."}{" "}
            Molotov/HE damage is enemy HP dealt by that grenade. Timing buckets use detonation time relative to each round's freeze end: early = first 25s, mid = 25–55s, late = later.
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
