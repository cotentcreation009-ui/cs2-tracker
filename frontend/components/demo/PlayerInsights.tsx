"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { computeTendencies, playstyleSummary, type PlayerTendencies } from "@/lib/demo/tendencies";
import { AccountCheck } from "@/components/demo/AccountCheck";
import { clientFaceit, clientLeetify } from "@/lib/demo/accountClient";
import type { FaceitProfile, LeetifyProfile } from "@/lib/types";
import type { DemoView } from "@/components/demo/MatchToolbar";

const UTIL_KINDS = ["smoke", "flash", "he", "molotov", "decoy"] as const;
type Timing = "early" | "mid" | "late";

const CT = "#5b9dff";
const T = "#e7b53c";
const sideHex = (t: PlayerInsight["team"]) => (t === "T" ? T : CT);
const mmss = (t: number) =>
  `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;

// A single at-a-glance "Impact" rating (~1.0 = solid) from kills/round, ADR and
// survival — for ranking the cards. Labelled Impact, not the official HLTV stat.
function impactRating(p: PlayerInsight): number {
  const surv = p.roundsPlayed ? (p.roundsPlayed - p.deaths) / p.roundsPlayed : 0;
  return Math.max(0, 0.45 * (p.kpr / 0.65) + 0.35 * (p.adr / 78) + 0.2 * (surv / 0.35));
}
const ratingHex = (r: number) => (r >= 1.15 ? "#46d369" : r >= 0.85 ? "#f5b942" : "#f5694a");

const SNIPER_RE = /awp|ssg|scar-?20|g3sg1/i;
// A one-word role from playstyle tendencies + weapon + opening duels.
function roleOf(p: PlayerInsight, tend?: PlayerTendencies): string {
  if (SNIPER_RE.test(p.favoriteWeapons?.[0]?.weapon ?? "")) return "AWPer";
  if (tend && tend.rounds >= 5) {
    if (tend.lurkPct >= 75) return "Lurker";
    if (p.openingAttempts >= 4 && tend.spacePct <= 30) return "Entry";
    if (tend.zoneSamples >= 12 && tend.rotationsPerRound <= 0.5) return "Anchor";
    if (tend.spacePct >= 70) return "Support";
  }
  if (p.openingAttempts >= 5 && p.openingWinPct >= 55) return "Entry";
  return "Rifler";
}

type SortKey = "impact" | "kills" | "adr" | "kd" | "hs" | "cheat";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "impact", label: "Impact" },
  { key: "kills", label: "Kills" },
  { key: "adr", label: "ADR" },
  { key: "kd", label: "K/D" },
  { key: "hs", label: "HS%" },
  { key: "cheat", label: "CheatMeter" },
];
function sortValue(p: PlayerInsight, key: SortKey): number {
  switch (key) {
    case "kills": return p.kills;
    case "adr": return p.adr;
    case "kd": return p.kd;
    case "hs": return p.hsPct;
    case "cheat": return demoCheat(p).score;
    default: return impactRating(p);
  }
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

function SplitBar({ a, b, aHex, bHex }: { a: number; b: number; aHex: string; bHex: string }) {
  const total = a + b || 1;
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-panel">
      <div className="bar-grow" style={{ width: `${(a / total) * 100}%`, background: aHex }} />
      <div className="bar-grow" style={{ width: `${(b / total) * 100}%`, background: bHex }} />
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
        <div className="bar-grow" style={{ width: `${aw}%`, background: "#f5694a" }} />
        <div className="bar-grow" style={{ width: `${mw}%`, background: "#f5b942" }} />
        <div className="bar-grow" style={{ width: `${bw}%`, background: "#5b9dff" }} />
      </div>
    </div>
  );
}

function PlayerCard({
  p,
  rank,
  focused,
  activeKind,
  lean,
  tend,
  onFocus,
  onUtil,
  onCompare,
  comparing,
}: {
  p: PlayerInsight;
  rank?: number;
  focused: boolean;
  activeKind: string | null;
  lean?: PlayerSiteLean;
  tend?: PlayerTendencies;
  onFocus: () => void;
  onUtil: (player: PlayerInsight, kind: string) => void;
  onCompare?: () => void;
  comparing?: boolean;
}) {
  const hex = sideHex(p.team);
  const mk = p.multiKills;
  const area = p.area;
  const areaTotal = area.a + area.b + area.mid || 1;
  const cheat = demoCheat(p);
  const tLines = playstyleSummary(p, tend);
  const hasAim = p.shots >= 1 || p.aimSamples >= 1;
  const rating = impactRating(p);
  const role = roleOf(p, tend);
  return (
    <div
      className={`card lift relative overflow-hidden py-3 pl-3 pr-4 transition ${
        focused ? "ring-1 ring-brand/50" : ""
      }`}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: hex }} />
      <div className="flex w-full items-center gap-2">
        <button
          type="button"
          onClick={onFocus}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title="Focus this player across all tabs"
        >
          {rank != null && (
            <span className="shrink-0 text-xs font-bold tabular-nums text-faint">#{rank}</span>
          )}
          <span className="truncate font-bold">{p.name}</span>
          <span className="pill shrink-0" style={{ background: `${hex}22`, color: hex }}>
            {p.team || "—"}
          </span>
          <span className="pill shrink-0 bg-panel2 text-[10px] text-faint" title="Role inferred from playstyle">
            {role}
          </span>
        </button>
        {onCompare && (
          <button
            type="button"
            onClick={onCompare}
            title="Add to comparison (pick two)"
            className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] transition ${
              comparing
                ? "border-brand/50 bg-brand/15 text-brand"
                : "border-line text-muted hover:bg-panel/50 hover:text-ink"
            }`}
          >
            {comparing ? "✓ vs" : "vs"}
          </button>
        )}
        <Link
          href={`/profiles/${p.steamId}`}
          title="Open full career profile"
          className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-muted transition hover:bg-panel/50 hover:text-ink"
        >
          Profile →
        </Link>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-extrabold tabular-nums" style={{ color: hex }}>
          {p.kills}
        </span>
        <span className="text-sm text-faint">/ {p.deaths}</span>
        {p.assistsApprox > 0 && (
          <span className="text-xs text-faint" title="assists (approx)">/ {p.assistsApprox}a</span>
        )}
        <span className="text-xs text-muted">
          {p.kd.toFixed(2)} K/D · {p.kpr.toFixed(2)} KPR
        </span>
        <span
          className="ml-auto rounded-md px-1.5 py-0.5 text-right text-sm font-bold tabular-nums"
          style={{ color: ratingHex(rating), background: `${ratingHex(rating)}1a` }}
          title="Impact rating — kills/round, ADR & survival (≈1.0 = solid)"
        >
          {rating.toFixed(2)}
          <span className="ml-1 text-[9px] font-normal uppercase tracking-wider opacity-70">impact</span>
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
            className="bar-grow h-full rounded-full"
            style={{ width: `${cheat.score}%`, background: BAND_HEX[cheat.band] }}
          />
        </div>
      </div>

      <div className="mt-2 grid grid-cols-4 gap-1.5">
        <Stat label="ADR" value={p.adr.toFixed(0)} />
        <Stat label="KAST" value={`${p.kastPct.toFixed(0)}%`} />
        <Stat label="HS%" value={`${p.hsPct.toFixed(0)}%`} />
        <Stat label="Trade K" value={`${p.tradeKills}`} sub={`${p.tradeKillPct.toFixed(0)}%`} />
      </div>

      {hasAim && (
        <div className="mt-1.5 grid grid-cols-4 gap-1.5" title="From this demo's per-tick aim capture">
          <Stat label="Accuracy" value={p.shots >= 1 ? `${p.accuracy.toFixed(0)}%` : "—"} />
          <Stat label="HS acc" value={p.shots >= 1 ? `${p.hsAccuracy.toFixed(0)}%` : "—"} />
          <Stat label="Reaction" value={p.aimSamples >= 1 ? `${p.reactionMs.toFixed(0)}ms` : "—"} />
          <Stat label="Pre-aim" value={p.aimSamples >= 1 ? `${p.preaimDeg.toFixed(1)}°` : "—"} />
        </div>
      )}

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

      {p.clutchTotal > 0 && (
        <div className="mt-2.5">
          <div className="flex justify-between text-[11px] text-muted">
            <span>Clutches (1vX)</span>
            <span className="tabular-nums">
              {p.clutchWon}/{p.clutchTotal} won
              {p.clutchBest > 0 && <span className="text-brand"> · best 1v{p.clutchBest}</span>}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {p.clutchBySize.map((c) => (
              <span
                key={c.size}
                className={`pill ${c.won > 0 ? "bg-good/15 text-good" : "bg-panel text-faint"}`}
                title={`${c.won} of ${c.total} 1v${c.size} clutches won`}
              >
                1v{c.size}: {c.won}/{c.total}
              </span>
            ))}
          </div>
        </div>
      )}

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
            <div className="bar-grow" style={{ width: `${(area.a / areaTotal) * 100}%`, background: "#f5694a" }} />
            <div className="bar-grow" style={{ width: `${(area.mid / areaTotal) * 100}%`, background: "#f5b942" }} />
            <div className="bar-grow" style={{ width: `${(area.b / areaTotal) * 100}%`, background: "#5b9dff" }} />
          </div>
        </div>
      ) : null}

      {p.buys.pistol + p.buys.eco + p.buys.semi + p.buys.force + p.buys.full > 0 && (
        <div className="mt-2 flex items-center justify-between text-[10px]">
          <span className="text-muted">Buys</span>
          <span className="text-faint">
            {p.buys.full} full · {p.buys.force} force · {p.buys.semi} semi · {p.buys.eco} eco · {p.buys.pistol} pistol
          </span>
        </div>
      )}

      {tLines.length > 0 && (
        <div className="mt-2.5 space-y-0.5 border-t border-line pt-2">
          <div className="text-[10px] uppercase tracking-wider text-faint">Tendencies (this demo)</div>
          {tLines.map((l, i) => (
            <div key={i} className="text-[11px] leading-snug text-muted">
              {l}
            </div>
          ))}
        </div>
      )}

      <AccountCheck
        steamId={p.steamId}
        name={p.name}
        matchScore={cheat.score}
        matchStats={`${p.kills}-${p.deaths} (K/D ${p.kd.toFixed(2)}, ${p.kpr.toFixed(2)} KPR), ${p.hsPct.toFixed(0)}% HS, ${p.adr.toFixed(0)} ADR, KAST ${p.kastPct.toFixed(0)}%${
          p.clutchTotal > 0 ? `, clutches ${p.clutchWon}/${p.clutchTotal}` : ""
        }${
          p.shots >= 40 ? `, acc ${p.accuracy.toFixed(0)}%/HS-acc ${p.hsAccuracy.toFixed(0)}%` : ""
        }${p.aimSamples >= 6 ? `, reaction ${p.reactionMs.toFixed(0)}ms, snap ${p.snapRate.toFixed(0)}%` : ""}`}
        cheatFactors={cheat.factors.slice(0, 4).map((f) => `${f.label} ${f.display}`).join(", ")}
        tendencyLines={playstyleSummary(p, tend)}
      />
    </div>
  );
}

// Compact scoreboard row — click to make this THE focused player (the tab
// shows one player's breakdown at a time).
function RosterRow({
  p,
  rank,
  focused,
  comparing,
  onFocus,
  onCompare,
}: {
  p: PlayerInsight;
  rank: number;
  focused: boolean;
  comparing: boolean;
  onFocus: () => void;
  onCompare: () => void;
}) {
  const hex = sideHex(p.team);
  const rating = impactRating(p);
  return (
    <div
      className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 transition ${
        focused ? "border-brand/50 bg-brand/10" : "border-transparent hover:bg-panel/60"
      }`}
    >
      <button
        type="button"
        onClick={onFocus}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        title={`Show ${p.name}'s full breakdown`}
      >
        <span className="w-4 shrink-0 text-right text-[10px] font-bold tabular-nums text-faint">{rank}</span>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: hex }} />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">{p.name}</span>
        <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted">
          {p.kills}-{p.deaths}
        </span>
        <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-faint">{p.adr.toFixed(0)}</span>
        <span
          className="w-10 shrink-0 text-right text-[11px] font-bold tabular-nums"
          style={{ color: ratingHex(rating) }}
          title="Impact rating (≈1.0 = solid)"
        >
          {rating.toFixed(2)}
        </span>
      </button>
      <button
        type="button"
        onClick={onCompare}
        title="Add to comparison (pick two)"
        className={`shrink-0 rounded border px-1 py-0.5 text-[9px] transition ${
          comparing
            ? "border-brand/50 bg-brand/15 text-brand"
            : "border-line text-faint hover:bg-panel/50 hover:text-ink"
        }`}
      >
        {comparing ? "✓" : "vs"}
      </button>
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
  onEnter,
  onLeave,
}: {
  tw: UtilThrow;
  zone: string | null;
  timing: Timing;
  active: boolean;
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

// Round-by-round strip for one player: a cell per round (won/lost tint, kills,
// survived/died), click to scope that round across every tab.
function RoundTimeline({
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
          Round-by-round · <span className="text-ink">{meta.players[i]?.name ?? "?"}</span>
        </span>
        <span className="text-[10px] text-faint">click a round to scope every tab to it</span>
      </div>
      <div className="flex flex-wrap gap-1 lg:flex-nowrap lg:overflow-x-auto lg:pb-1">
        {rounds.map((r, ri) => {
          const side = r.ct?.includes(i) ? "CT" : r.t?.includes(i) ? "T" : null;
          const won = !!side && r.winner === side;
          const kills = (r.kills ?? []).filter((k) => k.k === i).length;
          const died = (r.kills ?? []).some((k) => k.v === i);
          const dmg = (r.stats ?? []).find((s) => s.i === i)?.dmg ?? 0;
          const util = (r.nades ?? []).filter((n) => n.by === i).length;
          const active = scope === ri;
          return (
            <button
              key={ri}
              type="button"
              onClick={() => onPick(ri)}
              title={
                side == null
                  ? `Round ${r.n} · did not play`
                  : `Round ${r.n} · ${won ? "won" : "lost"} · ${kills}K · ${dmg} dmg · ${died ? "died" : "survived"}${util ? ` · ${util} util` : ""}`
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
                    style={kills >= 3 ? { color: "#f5b942" } : undefined}
                  >
                    {kills}
                  </span>
                  <span className="mt-0.5 text-[8px]">
                    {died ? <span className="text-bad">✕</span> : <span className="text-good">•</span>}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[9px] text-faint">
        <span>number = kills</span>
        <span><span className="text-good">•</span> survived · <span className="text-bad">✕</span> died</span>
        <span>green / red = round won / lost</span>
      </div>
    </div>
  );
}

// Side-by-side stat comparison of two players; the better value in each row is
// bolded green (deaths/reaction are lower-is-better).
type CareerSide = { faceit: FaceitProfile | null; leetify: LeetifyProfile | null };

function CompareTable({ a, b, onClose }: { a: PlayerInsight; b: PlayerInsight; onClose: () => void }) {
  // pull each player's CAREER profile so the demo compare also shows who they are
  // outside this match (Leetify aim, Premier, FACEIT ELO / K-D / win%).
  const [career, setCareer] = useState<{ a: CareerSide; b: CareerSide } | null>(null);
  const [careerState, setCareerState] = useState<"loading" | "done">("loading");
  useEffect(() => {
    let cancelled = false;
    setCareer(null);
    setCareerState("loading");
    const grab = (id: string) =>
      Promise.all([clientFaceit(id).catch(() => null), clientLeetify(id).catch(() => null)]).then(
        ([faceit, leetify]) => ({ faceit, leetify }),
      );
    Promise.all([grab(a.steamId), grab(b.steamId)]).then(([ca, cb]) => {
      if (cancelled) return;
      setCareer({ a: ca, b: cb });
      setCareerState("done");
    });
    return () => {
      cancelled = true;
    };
  }, [a.steamId, b.steamId]);

  const rows: { label: string; av?: number; bv?: number; fmt: (n: number) => string; lower?: boolean; show?: boolean }[] = [
    { label: "Impact", av: impactRating(a), bv: impactRating(b), fmt: (n: number) => n.toFixed(2) },
    { label: "Kills", av: a.kills, bv: b.kills, fmt: (n: number) => `${n}` },
    { label: "Deaths", av: a.deaths, bv: b.deaths, fmt: (n: number) => `${n}`, lower: true },
    { label: "K/D", av: a.kd, bv: b.kd, fmt: (n: number) => n.toFixed(2) },
    { label: "KPR", av: a.kpr, bv: b.kpr, fmt: (n: number) => n.toFixed(2) },
    { label: "ADR", av: a.adr, bv: b.adr, fmt: (n: number) => n.toFixed(0) },
    { label: "KAST", av: a.kastPct, bv: b.kastPct, fmt: (n: number) => `${n.toFixed(0)}%` },
    { label: "HS%", av: a.hsPct, bv: b.hsPct, fmt: (n: number) => `${n.toFixed(0)}%` },
    { label: "Opening W%", av: a.openingWinPct, bv: b.openingWinPct, fmt: (n: number) => `${n.toFixed(0)}%` },
    { label: "Clutches won", av: a.clutchWon, bv: b.clutchWon, fmt: (n: number) => `${n}` },
    { label: "Multi-K rds", av: a.multiKillRounds, bv: b.multiKillRounds, fmt: (n: number) => `${n}` },
    { label: "Trade K", av: a.tradeKills, bv: b.tradeKills, fmt: (n: number) => `${n}` },
    { label: "Utility", av: a.utilNades.length, bv: b.utilNades.length, fmt: (n: number) => `${n}` },
    { label: "Accuracy", av: a.accuracy, bv: b.accuracy, fmt: (n: number) => `${n.toFixed(0)}%`, show: a.shots >= 20 && b.shots >= 20 },
    { label: "Reaction", av: a.reactionMs, bv: b.reactionMs, fmt: (n: number) => `${n.toFixed(0)}ms`, lower: true, show: a.aimSamples >= 5 && b.aimSamples >= 5 },
  ];

  const careerRows: typeof rows = career
    ? [
        { label: "Leetify aim", av: career.a.leetify?.rating.aim, bv: career.b.leetify?.rating.aim, fmt: (n: number) => n.toFixed(1) },
        { label: "Leetify clutch", av: career.a.leetify?.rating.clutch, bv: career.b.leetify?.rating.clutch, fmt: (n: number) => n.toFixed(1) },
        { label: "Premier", av: career.a.leetify?.ranks.premier, bv: career.b.leetify?.ranks.premier, fmt: (n: number) => n.toLocaleString() },
        { label: "FACEIT ELO", av: career.a.faceit?.elo, bv: career.b.faceit?.elo, fmt: (n: number) => `${n}` },
        { label: "FACEIT lvl", av: career.a.faceit?.skillLevel, bv: career.b.faceit?.skillLevel, fmt: (n: number) => `${n}` },
        { label: "Career K/D", av: career.a.faceit?.kdRatio, bv: career.b.faceit?.kdRatio, fmt: (n: number) => n.toFixed(2) },
        { label: "Career win%", av: career.a.faceit?.winRatePct, bv: career.b.faceit?.winRatePct, fmt: (n: number) => `${n.toFixed(0)}%` },
      ].filter((r) => r.av != null || r.bv != null)
    : [];

  const winner = (av?: number, bv?: number, lower?: boolean) =>
    av == null || bv == null || av === bv ? 0 : (lower ? av < bv : av > bv) ? -1 : 1;
  const Row = (r: (typeof rows)[number]) => {
    const w = winner(r.av, r.bv, r.lower);
    return (
      <div key={r.label} className="grid break-inside-avoid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs">
        <span className={`text-right tabular-nums ${w === -1 ? "font-bold text-good" : "text-muted"}`}>
          {r.av == null ? "—" : r.fmt(r.av)}
        </span>
        <span className="w-24 text-center text-[10px] uppercase tracking-wider text-faint">{r.label}</span>
        <span className={`tabular-nums ${w === 1 ? "font-bold text-good" : "text-muted"}`}>
          {r.bv == null ? "—" : r.fmt(r.bv)}
        </span>
      </div>
    );
  };
  return (
    <div className="card-2 px-4 py-3 lg:max-h-80 lg:shrink-0 lg:overflow-y-auto">
      <div className="mb-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <span className="truncate text-right text-sm font-bold" style={{ color: sideHex(a.team) }}>{a.name}</span>
        <span className="text-[10px] uppercase tracking-wider text-faint">vs</span>
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-bold" style={{ color: sideHex(b.team) }}>{b.name}</span>
          <button type="button" onClick={onClose} className="ml-auto shrink-0 text-sm text-faint hover:text-ink" title="Clear comparison">✕</button>
        </div>
      </div>
      <div className="space-y-0.5 lg:columns-2 lg:gap-x-10">
        <div className="mb-1 text-center text-[10px] uppercase tracking-wider text-faint">This match</div>
        {rows.filter((r) => r.show !== false).map(Row)}

        <div className="mt-2 mb-1 break-inside-avoid border-t border-line pt-2 text-center text-[10px] uppercase tracking-wider text-faint">
          Career
        </div>
        {careerState === "loading" && (
          <div className="text-center text-[11px] text-faint">loading career stats…</div>
        )}
        {careerState === "done" && careerRows.length === 0 && (
          <div className="text-center text-[11px] text-faint">no public career data for either player</div>
        )}
        {careerRows.map(Row)}
      </div>
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
  const [kindSel, setKindSel] = useState<{ i: number; kind: string } | null>(null);
  const [throwIdx, setThrowIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("impact");
  const [compare, setCompare] = useState<number[]>([]);
  const cardRefs = useRef(new Map<number, HTMLDivElement>());

  const proj = useMemo(() => buildProjection(meta.map, rounds), [meta, rounds]);

  // scope the insights to the toolbar's round + side selection
  const data = useMemo(() => {
    const scoped =
      view.scopeRound != null && rounds[view.scopeRound]
        ? [rounds[view.scopeRound]]
        : rounds;
    return computeInsights(meta, scoped);
  }, [meta, rounds, view.scopeRound]);

  // tendencies are match-wide (not scoped to one round) — keyed by steamId
  const tendMap = useMemo(() => computeTendencies(meta, rounds), [meta, rounds]);

  const players = useMemo(
    () => data.players.filter((p) => view.side === "all" || p.team === view.side),
    [data, view.side],
  );

  // display order (ranked) — kept separate from `players` so fallback/timing/
  // lean logic stays order-independent.
  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => sortValue(b, sortKey) - sortValue(a, sortKey)),
    [players, sortKey],
  );

  // "best of the match" highlights — quick scan + click to focus.
  const awards = useMemo(() => {
    if (!players.length) return [];
    const top = (fn: (p: PlayerInsight) => number) =>
      players.reduce((b, p) => (fn(p) > fn(b) ? p : b), players[0]);
    const out: { label: string; p: PlayerInsight; val: string }[] = [];
    const frag = top((p) => p.kills);
    out.push({ label: "Top fragger", p: frag, val: `${frag.kills} kills` });
    const imp = top((p) => impactRating(p));
    out.push({ label: "Best impact", p: imp, val: impactRating(imp).toFixed(2) });
    const entry = top((p) => p.openingKills);
    if (entry.openingKills > 0) out.push({ label: "Entry king", p: entry, val: `${entry.openingKills} opening K` });
    const util = top((p) => p.utilNades.length);
    if (util.utilNades.length > 0) out.push({ label: "Most utility", p: util, val: `${util.utilNades.length} nades` });
    return out;
  }, [players]);

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
    setHoverIdx(null);
    setCompare([]);
  }, [view.scopeRound, view.side]);

  const toggleCompare = (i: number) =>
    setCompare((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i].slice(-2)));
  const cmpA = compare[0] != null ? data.players.find((p) => p.i === compare[0]) ?? null : null;
  const cmpB = compare[1] != null ? data.players.find((p) => p.i === compare[1]) ?? null : null;
  // kind is player-scoped (see pickedKind), so changing player resets it
  // implicitly; the throw selection AND any lingering hover preview (the row
  // may unmount without firing onMouseLeave) need an explicit reset here.
  useEffect(() => {
    setThrowIdx(null);
    setHoverIdx(null);
  }, [focusI]);
  // bring the card into view ONLY on an explicit pick (award chip / toolbar / card)
  // — not the auto-fallback, which would scroll on every tab open.
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
  // hovering a throw row previews it on the map; clicking pins it.
  const shownIdx = hoverIdx ?? throwIdx;
  const soloThrow = shownIdx != null && selThrows[shownIdx] ? selThrows[shownIdx] : null;
  const mapThrows = soloThrow ? [soloThrow] : selThrows;
  const zoneOf = (x: number, y: number) =>
    classifyPosition(meta.map, x, y, zones)?.name ?? null;
  const stepThrow = (d: number) => {
    setHoverIdx(null); // keyboard/buttons take priority over a transient hover preview
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

  return (
    <div className="space-y-3 lg:flex lg:h-full lg:min-h-0 lg:flex-col">
      {awards.length > 0 && (
        <div className="flex flex-wrap gap-2 lg:shrink-0">
          {awards.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={() => view.setFocusPlayer(view.focusPlayer === a.p.i ? null : a.p.i)}
              title={`Focus ${a.p.name}`}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-left transition ${
                focusI === a.p.i ? "border-brand/50 bg-brand/10" : "border-line bg-panel/50 hover:border-brand/40 hover:bg-panel"
              }`}
            >
              <span className="text-[10px] uppercase tracking-wider text-faint">{a.label}</span>
              <span className="text-sm font-bold" style={{ color: sideHex(a.p.team) }}>{a.p.name}</span>
              <span className="text-[11px] tabular-nums text-muted">{a.val}</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] lg:grid-rows-[minmax(0,1fr)] lg:gap-3 2xl:grid-cols-[minmax(0,1fr)_minmax(400px,500px)]">
      {/* left: the utility explorer IS this tab's centerpiece — a full-height
          map with the step controls overlaying its bottom edge (video-player
          style, like the replay radar). ◀ ▶ arrow keys step through throws. */}
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
        {/* header (two fixed rows, both aligned to the map width): whose
            utility on top, the kind switcher below — every item can shrink or
            truncate, so short viewports can never break the alignment */}
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
          <div className="mb-2 flex w-full flex-wrap gap-1 lg:w-[min(100cqw,calc(100cqh-72px))] lg:flex-nowrap lg:overflow-x-auto">
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

        {selPlayer && activeKind && selThrows.length > 0 ? (
          <div className="relative mx-auto w-full max-w-180 lg:mx-0 lg:w-[min(100cqw,calc(100cqh-72px))] lg:max-w-none">
            <UtilThrowMap map={meta.map} proj={proj} throws={mapThrows} className="w-full" />

            {/* step controls — translucent overlay on the map's bottom edge */}
            <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-1.5 rounded-b-xl border-t border-line/60 bg-bg/80 px-2.5 py-1.5 backdrop-blur">
              <button type="button" onClick={() => stepThrow(-1)} title="Previous throw" aria-label="Previous throw" className="btn btn-ghost shrink-0 px-2 py-1 text-xs">◀</button>
              <div className="min-w-0 flex-1 text-center text-[11px]">
                {soloThrow ? (
                  <span title="dashed line = thrown from → landed">
                    <span className="font-semibold text-ink">Throw {(shownIdx ?? 0) + 1}/{selThrows.length}</span>
                    <span className="text-faint"> · R{soloThrow.round} · {mmss(soloThrow.t)}</span>
                    {zoneOf(soloThrow.x, soloThrow.y) && <span className="text-faint"> · {zoneOf(soloThrow.x, soloThrow.y)}</span>}
                    <span className="text-brand"> · {timingOf(soloThrow.t)}</span>
                  </span>
                ) : (
                  <span className="text-muted">
                    {selThrows.length} {(KIND_LABEL[activeKind] ?? activeKind).toLowerCase()} — hover a row or ◀ ▶ to step
                  </span>
                )}
              </div>
              {soloThrow && (
                <button type="button" onClick={() => setThrowIdx(null)} title="Show all" className="btn btn-ghost shrink-0 px-2 py-1 text-[10px]">all</button>
              )}
              <button type="button" onClick={() => stepThrow(1)} title="Next throw" aria-label="Next throw" className="btn btn-ghost shrink-0 px-2 py-1 text-xs">▶</button>
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

      {/* right: one player at a time — a compact scoreboard picks the player,
          then just THAT player's detail shows. The column scrolls internally;
          the map never gives up space. */}
      <div className="space-y-3 self-start lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:gap-2.5 lg:space-y-0 lg:self-stretch lg:overflow-y-auto">
        {/* scoreboard */}
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
          <div className="mb-0.5 flex items-center gap-1.5 px-2 text-[9px] uppercase tracking-wider text-faint">
            <span className="w-4" />
            <span className="w-2" />
            <span className="min-w-0 flex-1">Player</span>
            <span className="w-12 text-right">K-D</span>
            <span className="w-8 text-right">ADR</span>
            <span className="w-10 text-right">Impact</span>
            <span className="w-6" />
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
                  comparing={compare.includes(p.i)}
                  onFocus={() => view.setFocusPlayer(view.focusPlayer === p.i ? null : p.i)}
                  onCompare={() => toggleCompare(p.i)}
                />
              </div>
            ))}
          </div>
        </div>

        {cmpA && cmpB && <CompareTable a={cmpA} b={cmpB} onClose={() => setCompare([])} />}

        {/* every throw of the active kind — hover previews it, click pins it */}
        {selPlayer && activeKind && selThrows.length > 0 && (
          <div className="card-2 px-3 py-2.5 lg:shrink-0">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="stat-label">
                {selThrows.length} {(KIND_LABEL[activeKind] ?? activeKind).toLowerCase()}
              </span>
              <span className="text-[10px] text-faint">hover = preview · click = pin · dashed = throw → land</span>
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto pr-1 lg:max-h-64">
              {selThrows.map((tw, i) => (
                <ThrowRow
                  key={`${tw.round}-${tw.t}-${i}`}
                  tw={tw}
                  zone={zoneOf(tw.x, tw.y)}
                  timing={timingOf(tw.t)}
                  active={shownIdx === i}
                  onClick={() => setThrowIdx(throwIdx === i ? null : i)}
                  onEnter={() => setHoverIdx(i)}
                  onLeave={() => setHoverIdx(null)}
                />
              ))}
            </div>
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
                        onMouseEnter={() => first >= 0 && setHoverIdx(first)}
                        onMouseLeave={() => setHoverIdx(null)}
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
          </div>
        )}

        {/* the ONE player card — the focused player's full breakdown */}
        {selPlayer && (
          <div className="insight-card-in lg:shrink-0">
            <PlayerCard
              p={selPlayer}
              rank={sortedPlayers.findIndex((x) => x.i === selPlayer.i) + 1}
              focused
              activeKind={activeKind}
              lean={siteLean.get(selPlayer.i)}
              tend={tendMap.get(selPlayer.steamId)}
              onFocus={() => view.setFocusPlayer(selPlayer.i)}
              onUtil={pickUtil}
              onCompare={() => toggleCompare(selPlayer.i)}
              comparing={compare.includes(selPlayer.i)}
            />
          </div>
        )}

        {focusI != null && (
          <RoundTimeline
            rounds={rounds}
            meta={meta}
            i={focusI}
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
          <span className="font-semibold text-muted">Data notes:</span>{" "}
          {PLAYER_INSIGHTS_LIMITATIONS}
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
