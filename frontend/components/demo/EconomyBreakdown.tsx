"use client";

// Economy lens: the match's money story, previously trapped in one per-round
// popup. Three layers over ReplayPlayerStat economy fields (equip/buy/
// startMoney/money/bought/pickedUp):
//   1. team bank chart — each roster's equipment value per round, with win
//      markers and the halftime divider
//   2. buy strip — one cell per (round, team): tier-tinted, win-barred,
//      click-to-scope (the HLTV-style round history)
//   3. reads — round win rate by buy tier per team, and a per-player table
//      (avg equip, cash spent/held, buy mix, picked-up guns)
// Teams are STARTING rosters (halftime swap safe), matching the scoreboard.

import { useMemo } from "react";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import type { DemoView } from "@/components/demo/MatchToolbar";
import { classifyBuy, buyTierOf, BUY_KEYS, type BuyKey } from "@/lib/demo/economy";
import { teamAStarters, roundWinnerTeam } from "@/lib/demo/score";

const CT = "#5b9dff";
const T = "#e7b53c";

const TIER_HEX: Record<BuyKey, string> = {
  full: "#46d369",
  force: "#e7b53c",
  semi: "#e7953c",
  eco: "#7f8ea3",
  pistol: "#8a7dff",
};
const TIER_LABEL: Record<BuyKey, string> = {
  full: "Full buy",
  force: "Force",
  semi: "Semi-buy",
  eco: "Eco",
  pistol: "Pistol",
};

const kd = (n: number) => `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;

interface TeamRound {
  equip: number; // roster's total equipment value this round
  tier: BuyKey | null; // classified from the per-player average
  won: boolean;
}

export function EconomyBreakdown({
  meta,
  rounds,
  view,
}: {
  meta: ReplayMeta;
  rounds: ReplayRound[];
  view: DemoView;
}) {
  const data = useMemo(() => {
    const teamA = teamAStarters(rounds);
    const perRound: { n: number; a: TeamRound; b: TeamRound; winner: "A" | "B" | null }[] = [];
    let hasEcon = false;

    rounds.forEach((r) => {
      const stats = new Map((r.stats ?? []).map((s) => [s.i, s]));
      const aOnCT =
        (r.ct?.filter((i) => teamA.has(i)).length ?? 0) >=
        (r.t?.filter((i) => teamA.has(i)).length ?? 0);
      const rosterA = (aOnCT ? r.ct : r.t) ?? [];
      const rosterB = (aOnCT ? r.t : r.ct) ?? [];
      const teamOf = (roster: number[]): TeamRound => {
        let equip = 0;
        let n = 0;
        for (const i of roster) {
          const s = stats.get(i);
          if (s?.equip != null) {
            equip += s.equip;
            n++;
          }
        }
        if (n > 0) hasEcon = true;
        return {
          equip,
          tier: n > 0 ? classifyBuy(equip / n, r.n).key : null,
          won: false,
        };
      };
      const a = teamOf(rosterA);
      const b = teamOf(rosterB);
      const winner = roundWinnerTeam(r, teamA);
      if (winner === "A") a.won = true;
      if (winner === "B") b.won = true;
      perRound.push({ n: r.n, a, b, winner });
    });

    // round win rate by buy tier, per team
    const tierStats = (pick: (row: (typeof perRound)[number]) => TeamRound) => {
      const m = new Map<BuyKey, { rounds: number; wins: number }>();
      for (const row of perRound) {
        const t = pick(row);
        if (!t.tier) continue;
        const v = m.get(t.tier) ?? { rounds: 0, wins: 0 };
        v.rounds++;
        if (t.won) v.wins++;
        m.set(t.tier, v);
      }
      return m;
    };

    // per-player economy over the match
    const players = meta.players
      .map((pl, i) => {
        let equip = 0,
          spent = 0,
          left = 0,
          nEquip = 0,
          nCash = 0,
          picked = 0;
        const mix = { full: 0, force: 0, semi: 0, eco: 0, pistol: 0 } as Record<BuyKey, number>;
        for (const r of rounds) {
          const s = (r.stats ?? []).find((x) => x.i === i);
          if (!s) continue;
          if (s.equip != null) {
            equip += s.equip;
            nEquip++;
          }
          if (s.startMoney != null && s.money != null) {
            spent += Math.max(0, s.startMoney - s.money);
            left += s.money;
            nCash++;
          }
          picked += s.pickedUp?.length ?? 0;
          const t = buyTierOf(s, r.n);
          if (t) mix[t]++;
        }
        return {
          i,
          name: pl.name || `P${i + 1}`,
          isA: teamA.has(i),
          avgEquip: nEquip ? equip / nEquip : 0,
          spent,
          avgLeft: nCash ? left / nCash : 0,
          mix,
          picked,
          nEquip,
        };
      })
      .filter((p) => p.nEquip > 0)
      .sort((x, y) => y.avgEquip - x.avgEquip);

    const maxEquip = Math.max(1, ...perRound.map((r) => Math.max(r.a.equip, r.b.equip)));
    // halftime = first round where team A leaves the side it started on
    let half = -1;
    for (let i = 1; i < rounds.length; i++) {
      const r = rounds[i];
      const aOnCT =
        (r.ct?.filter((x) => teamA.has(x)).length ?? 0) >=
        (r.t?.filter((x) => teamA.has(x)).length ?? 0);
      const r0 = rounds[0];
      const aStartedCT =
        (r0.ct?.filter((x) => teamA.has(x)).length ?? 0) >=
        (r0.t?.filter((x) => teamA.has(x)).length ?? 0);
      if (aOnCT !== aStartedCT) {
        half = i;
        break;
      }
    }

    return {
      perRound,
      tiersA: tierStats((r) => r.a),
      tiersB: tierStats((r) => r.b),
      players,
      maxEquip,
      half,
      hasEcon,
    };
  }, [meta, rounds]);

  if (!data.hasEcon) {
    return (
      <div className="card px-5 py-6 text-sm text-muted">
        No economy data in this demo — re-parse it to capture money, buys and equipment values.
      </div>
    );
  }

  // the parser's pickup heuristic rarely fires — drop the column when the
  // whole match recorded none rather than render a wall of dashes
  const anyPicked = data.players.some((p) => p.picked > 0);
  const N = data.perRound.length;
  const W = Math.max(360, N * 34);
  const H = 150;
  const PAD = 8;
  const x = (i: number) => PAD + ((i + 0.5) / N) * (W - PAD * 2);
  const y = (v: number) => H - 24 - (v / data.maxEquip) * (H - 44);
  const line = (pick: (r: (typeof data.perRound)[number]) => number) =>
    data.perRound.map((r, i) => `${x(i).toFixed(1)},${y(pick(r)).toFixed(1)}`).join(" ");

  const scoped = view.scopeRound;

  return (
    <div className="space-y-4">
      {/* team bank chart */}
      <div className="card px-4 py-3">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <span className="stat-label">Team economy by round</span>
          <span className="flex items-center gap-3 text-[10px] text-faint">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-3 rounded-full" style={{ background: CT }} /> CT start
            </span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-3 rounded-full" style={{ background: T }} /> T start
            </span>
            <span>equipment value taken into each round · dot = round winner · click a round to scope it</span>
          </span>
        </div>
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: W }} className="h-40 w-full">
            {/* y grid: quarter lines of the biggest bank */}
            {[0.25, 0.5, 0.75].map((f) => (
              <g key={f}>
                <line x1={PAD} x2={W - PAD} y1={y(data.maxEquip * f)} y2={y(data.maxEquip * f)} stroke="var(--color-line)" strokeWidth="0.6" opacity="0.5" />
                <text x={PAD + 1} y={y(data.maxEquip * f) - 2} fontSize="7" fill="var(--color-faint)">
                  {kd(data.maxEquip * f)}
                </text>
              </g>
            ))}
            {/* halftime divider */}
            {data.half > 0 && (
              <line x1={(x(data.half - 1) + x(data.half)) / 2} x2={(x(data.half - 1) + x(data.half)) / 2} y1={6} y2={H - 18} stroke="var(--color-faint)" strokeWidth="0.8" strokeDasharray="3 2.5" opacity="0.6" />
            )}
            <polyline points={line((r) => r.a.equip)} fill="none" stroke={CT} strokeWidth="2" strokeLinejoin="round" />
            <polyline points={line((r) => r.b.equip)} fill="none" stroke={T} strokeWidth="2" strokeLinejoin="round" />
            {data.perRound.map((r, i) => (
              <g key={i}>
                {/* win marker on top */}
                {r.winner && <circle cx={x(i)} cy={9} r={2.6} fill={r.winner === "A" ? CT : T} />}
                <circle cx={x(i)} cy={y(r.a.equip)} r={2} fill={CT} />
                <circle cx={x(i)} cy={y(r.b.equip)} r={2} fill={T} />
                {/* round number every 3rd */}
                {(i === 0 || (i + 1) % 3 === 0) && (
                  <text x={x(i)} y={H - 8} fontSize="7.5" fill="var(--color-faint)" textAnchor="middle">
                    {r.n}
                  </text>
                )}
                {/* hover/click hit area */}
                <rect
                  x={x(i) - (W - PAD * 2) / N / 2}
                  y={0}
                  width={(W - PAD * 2) / N}
                  height={H}
                  fill={scoped === i ? "rgba(56,214,255,0.10)" : "transparent"}
                  style={{ cursor: "pointer" }}
                  onClick={() => view.setScopeRound(scoped === i ? null : i)}
                >
                  <title>{`R${r.n} — CT start ${kd(r.a.equip)}${r.a.tier ? ` (${TIER_LABEL[r.a.tier]})` : ""} · T start ${kd(r.b.equip)}${r.b.tier ? ` (${TIER_LABEL[r.b.tier]})` : ""}${r.winner ? ` · won by ${r.winner === "A" ? "CT start" : "T start"}` : ""}`}</title>
                </rect>
              </g>
            ))}
          </svg>
        </div>

        {/* buy strip: tier-tinted cells, win bar on top, click to scope */}
        <div className="mt-2 space-y-1 overflow-x-auto">
          {(["a", "b"] as const).map((tk) => (
            <div key={tk} className="flex items-center gap-1" style={{ minWidth: W }}>
              <span className="w-14 shrink-0 text-[9px] font-bold uppercase tracking-wide" style={{ color: tk === "a" ? CT : T }}>
                {tk === "a" ? "CT start" : "T start"}
              </span>
              <div className="flex flex-1 gap-0.5">
                {data.perRound.map((r, i) => {
                  const t = r[tk];
                  const hex = t.tier ? TIER_HEX[t.tier] : "#3a4661";
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => view.setScopeRound(scoped === i ? null : i)}
                      title={`R${r.n} · ${t.tier ? TIER_LABEL[t.tier] : "no data"} · ${kd(t.equip)}${t.won ? " · won" : " · lost"}`}
                      className={`h-6 min-w-6 flex-1 rounded-sm text-[8px] font-bold tabular-nums transition hover:brightness-125 ${
                        scoped === i ? "ring-1 ring-brand" : ""
                      }`}
                      style={{
                        background: `${hex}2e`,
                        color: hex,
                        boxShadow: t.won ? `inset 0 2px 0 ${tk === "a" ? CT : T}` : undefined,
                      }}
                    >
                      {t.equip > 0 ? Math.round(t.equip / 1000) : "·"}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="pl-14 text-[9px] text-faint" style={{ minWidth: W }}>
            cell = $k of gear · colour = buy tier ({BUY_KEYS.map((k) => TIER_LABEL[k].toLowerCase()).join(" / ")}) · top bar = round won
          </div>
        </div>
      </div>

      {/* win rate by buy tier */}
      <div className="grid gap-4 sm:grid-cols-2">
        {(["a", "b"] as const).map((tk) => {
          const m = tk === "a" ? data.tiersA : data.tiersB;
          const hex = tk === "a" ? CT : T;
          return (
            <div key={tk} className="card px-4 py-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: hex }} />
                <span className="stat-label">{tk === "a" ? "CT start" : "T start"} · round wins by buy</span>
              </div>
              <div className="space-y-1.5">
                {BUY_KEYS.filter((k) => m.has(k)).map((k) => {
                  const v = m.get(k)!;
                  const pct = v.rounds ? (v.wins / v.rounds) * 100 : 0;
                  return (
                    <div key={k} className="flex items-center gap-2 text-[11px]">
                      <span className="w-16 shrink-0" style={{ color: TIER_HEX[k] }}>
                        {TIER_LABEL[k]}
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: TIER_HEX[k] }} />
                      </div>
                      <span className="w-20 shrink-0 text-right tabular-nums text-muted">
                        {v.wins}/{v.rounds} · {pct.toFixed(0)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* per-player economy */}
      <div className="card overflow-hidden">
        <div className="border-b border-line px-4 py-2.5">
          <span className="stat-label">Player economy</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-130 border-collapse text-xs">
            <thead>
              <tr className="border-b border-line bg-panel2 text-[10px] font-semibold uppercase tracking-wider text-faint">
                <th className="px-3 py-2 text-left">Player</th>
                <th className="px-2 py-2 text-right" title="Average equipment value taken into a round">Avg gear</th>
                <th className="px-2 py-2 text-right" title="Total cash spent buying across the match">Spent</th>
                <th className="px-2 py-2 text-right" title="Average cash still in pocket after buying — high on a loss streak can mean over-saving">Avg left</th>
                {anyPicked && (
                  <th className="px-2 py-2 text-right" title="Guns picked up off the ground instead of bought">Picked up</th>
                )}
                <th className="px-3 py-2 text-right" title="Rounds per buy tier">Buy mix</th>
              </tr>
            </thead>
            <tbody>
              {data.players
                .filter((p) => view.side === "all" || (view.side === "CT") === p.isA)
                .map((p) => (
                  <tr
                    key={p.i}
                    onClick={() => view.setFocusPlayer(view.focusPlayer === p.i ? null : p.i)}
                    className={`cursor-pointer border-t border-line/40 transition ${
                      view.focusPlayer === p.i ? "bg-brand/10" : "hover:bg-panel2/70"
                    }`}
                  >
                    <td className="max-w-44 truncate px-3 py-1.5 font-medium" style={{ color: p.isA ? "#9cc1ff" : "#f0cd78" }}>
                      {p.name}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{kd(p.avgEquip)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted">{kd(p.spent)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted">{kd(p.avgLeft)}</td>
                    {anyPicked && (
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted">{p.picked || "—"}</td>
                    )}
                    <td className="px-3 py-1.5">
                      <span className="flex justify-end gap-1">
                        {BUY_KEYS.filter((k) => p.mix[k] > 0).map((k) => (
                          <span
                            key={k}
                            title={`${TIER_LABEL[k]}: ${p.mix[k]} round${p.mix[k] > 1 ? "s" : ""}`}
                            className="rounded-full px-1.5 text-[9px] font-bold tabular-nums"
                            style={{ background: `${TIER_HEX[k]}22`, color: TIER_HEX[k] }}
                          >
                            {TIER_LABEL[k][0]}
                            {p.mix[k]}
                          </span>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line px-4 py-2 text-[10px] text-faint">
          Rows follow the starting rosters · click a row to focus that player · &quot;Avg left&quot; stays high when someone
          hoards cash their team needed.
        </div>
      </div>
    </div>
  );
}
