"use client";

import { useMemo } from "react";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import {
  computeInsights,
  weaponLabel,
  PLAYER_INSIGHTS_LIMITATIONS,
  type PlayerInsight,
} from "@/lib/demo/insights";

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

function PlayerCard({ p }: { p: PlayerInsight }) {
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
        <Stat label="HS%" value={`${p.hsPct.toFixed(0)}%`} />
        <Stat label="Assist*" value={`${p.assistsApprox}`} />
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.players.map((p) => (
          <PlayerCard key={p.i} p={p} />
        ))}
      </div>

      {/* Match-wide utility (no per-player thrower in our data) */}
      <div className="card-2 px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="stat-label">Utility used</span>
          <span className="pill bg-panel text-faint">match-wide · no per-player thrower</span>
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
    </div>
  );
}
