"use client";

// Match scoreboard lens: one dense, sortable per-player table over the parsed
// insights (computeInsights). Rows are grouped by team with a round-wins header
// per side; clicking a row focuses that player across every tab, clicking a
// column header sorts by it. Respects the shared round scope (stats re-derive
// from just that round) and the side filter.

import { useMemo, useState } from "react";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import type { DemoView } from "@/components/demo/MatchToolbar";
import { computeInsights, type PlayerInsight } from "@/lib/demo/insights";
import { teamAStarters, roundWinnerTeam } from "@/lib/demo/score";
import { kdColor } from "@/lib/format";

const CT = "#5b9dff";
const T = "#e7b53c";
const OTHER = "#8a93a5";
// lightened "text on team tint" hues, same pair the toolbar uses
const SOFT: Record<string, string> = { [CT]: "#9cc1ff", [T]: "#f0cd78", [OTHER]: "#c3ccda" };

type SortKey =
  | "name" | "k" | "d" | "a" | "diff" | "kd" | "adr" | "kast"
  | "hs" | "ok" | "od" | "trd" | "mk" | "cl" | "ud";

const COLS: { key: SortKey; label: string; title: string }[] = [
  { key: "k", label: "K", title: "Kills" },
  { key: "d", label: "D", title: "Deaths" },
  { key: "a", label: "A", title: "Assists — trade-based proxy (the demo doesn't credit every assist)" },
  { key: "diff", label: "+/−", title: "Kill − death difference" },
  { key: "kd", label: "K/D", title: "Kills per death" },
  { key: "adr", label: "ADR", title: "Average damage per round" },
  { key: "kast", label: "KAST", title: "% of rounds with a kill, assist, survival or traded death" },
  { key: "hs", label: "HS%", title: "Headshot kill %" },
  { key: "ok", label: "OK", title: "Opening kills (won the round's first duel)" },
  { key: "od", label: "OD", title: "Opening deaths (lost the round's first duel)" },
  { key: "trd", label: "TRD", title: "Trade kills — avenged a teammate within 5s" },
  { key: "mk", label: "MK", title: "Multi-kill rounds (2+ kills)" },
  { key: "cl", label: "1vX", title: "Clutches won / attempted (last alive vs X)" },
  { key: "ud", label: "UD", title: "Utility damage (HE / molotov)" },
];

function sortVal(p: PlayerInsight, key: SortKey): number | string {
  switch (key) {
    case "name": return p.name.toLowerCase();
    case "k": return p.kills;
    case "d": return p.deaths;
    case "a": return p.assistsApprox;
    case "diff": return p.kills - p.deaths;
    case "kd": return p.kd;
    case "adr": return p.adr;
    case "kast": return p.kastPct;
    case "hs": return p.hsPct;
    case "ok": return p.openingKills;
    case "od": return p.openingDeaths;
    case "trd": return p.tradeKills;
    case "mk": return p.multiKillRounds;
    case "cl": return p.clutchWon * 1000 + p.clutchTotal; // won first, attempts break ties
    case "ud": return p.utilDamage;
  }
}

interface Group {
  key: string;
  label: string;
  hex: string;
  wins: number;
  players: PlayerInsight[];
}

export function MatchScoreboard({
  meta,
  rounds,
  view,
}: {
  meta: ReplayMeta;
  rounds: ReplayRound[];
  view: DemoView;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "k", dir: -1 });

  const { groups, scopeLabel, roundCount } = useMemo(() => {
    const r = view.scopeRound != null ? rounds[view.scopeRound] : undefined;
    const scoped = r ? [r] : rounds;
    const { players } = computeInsights(meta, scoped);
    const teamA = teamAStarters(rounds);

    // Stable team membership for the whole-match view. The round-1 snapshot
    // alone would dump late connectors (absent from round 1's rosters) onto
    // the wrong team — so for those, look at the FIRST round they appear in
    // and match them against where team A is playing that round (roster
    // overlap, robust to side swaps).
    const memberOfA = (i: number): boolean => {
      if (teamA.has(i)) return true;
      for (const rr of rounds) {
        const inCT = rr.ct?.includes(i);
        const inT = rr.t?.includes(i);
        if (!inCT && !inT) continue;
        const aOnCT =
          (rr.ct?.filter((p) => teamA.has(p)).length ?? 0) >=
          (rr.t?.filter((p) => teamA.has(p)).length ?? 0);
        return inCT ? aOnCT : !aOnCT;
      }
      return false;
    };

    // which side a player counts for: the scoped round's actual side, else the
    // stable team identified by the side it STARTED on (matches the header
    // scoreline — sides swap at half).
    const sideOfP = (i: number): "CT" | "T" | "" =>
      r
        ? r.ct?.includes(i) ? "CT" : r.t?.includes(i) ? "T" : ""
        : teamA.size
          ? memberOfA(i) ? "CT" : "T"
          : (meta.players[i]?.team ?? "");

    // round wins over the current scope, per group
    let winsCT = 0;
    let winsT = 0;
    if (r) {
      if (r.winner === "CT") winsCT = 1;
      else if (r.winner === "T") winsT = 1;
    } else if (teamA.size) {
      for (const rr of rounds) {
        const tm = roundWinnerTeam(rr, teamA);
        if (tm === "A") winsCT++;
        else if (tm === "B") winsT++;
      }
    } else {
      winsCT = rounds.filter((rr) => rr.winner === "CT").length;
      winsT = rounds.filter((rr) => rr.winner === "T").length;
    }

    const cmp = (a: PlayerInsight, b: PlayerInsight) => {
      const va = sortVal(a, sort.key);
      const vb = sortVal(b, sort.key);
      const d = typeof va === "string" || typeof vb === "string"
        ? String(va).localeCompare(String(vb))
        : va - (vb as number);
      return d !== 0 ? sort.dir * d : b.kills - a.kills;
    };
    const bySide = (s: "CT" | "T" | "") =>
      players
        .filter((p) => sideOfP(p.i) === s)
        .filter((p) => view.side === "all" || sideOfP(p.i) === view.side)
        .sort(cmp);

    const groups: Group[] = [
      { key: "ct", label: r ? "CT" : "CT start", hex: CT, wins: winsCT, players: bySide("CT") },
      { key: "t", label: r ? "T" : "T start", hex: T, wins: winsT, players: bySide("T") },
      { key: "other", label: "Unassigned", hex: OTHER, wins: 0, players: bySide("") },
    ].filter((g) => g.players.length > 0);

    return { groups, scopeLabel: r ? `Round ${r.n}` : "Whole match", roundCount: scoped.length };
  }, [meta, rounds, view.scopeRound, view.side, sort]);

  const onSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: (s.dir * -1) as 1 | -1 }
        : { key, dir: key === "name" ? 1 : -1 },
    );

  const arrow = (key: SortKey) =>
    sort.key === key ? (
      <span className="ml-0.5 text-brand">{sort.dir === -1 ? "▾" : "▴"}</span>
    ) : null;

  const thBase =
    "sticky top-0 z-10 cursor-pointer select-none border-b border-line bg-panel2 py-2 text-[10px] font-semibold uppercase tracking-wider text-faint transition hover:text-ink";

  return (
    <div className="card overflow-hidden lg:flex lg:h-full lg:min-h-0 lg:flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <span className="stat-label">Scoreboard</span>
        <span className="text-[11px] tabular-nums text-faint">
          {scopeLabel} · {roundCount} round{roundCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="scroll-slim max-h-[70vh] overflow-auto lg:max-h-none lg:min-h-0 lg:flex-1">
        <table className="w-full min-w-215 border-collapse text-xs">
          <thead>
            <tr>
              <th
                scope="col"
                onClick={() => onSort("name")}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSort("name"); } }}
                aria-sort={sort.key === "name" ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                title="Player — click to sort by name"
                className={`${thBase} px-3 text-left`}
              >
                Player{arrow("name")}
              </th>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  onClick={() => onSort(c.key)}
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSort(c.key); } }}
                  aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                  title={`${c.title} — click to sort`}
                  className={`${thBase} px-2 text-right`}
                >
                  {c.label}
                  {arrow(c.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <FragmentRows key={g.key} group={g} view={view} />
            ))}
            {groups.length === 0 && (
              <tr>
                <td colSpan={COLS.length + 1} className="px-4 py-6 text-center text-muted">
                  No player stats in this scope.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="border-t border-line px-4 py-2 text-[10px] text-faint">
        Click a column to sort · click a row to focus that player across every tab. A is a
        trade-based proxy (the demo doesn&apos;t credit every assist); OK/OD are the round&apos;s
        opening duel.
      </div>
    </div>
  );
}

// One team's header row + its player rows (kept together so the table stays a
// single element — required for aligned columns and the sticky header).
function FragmentRows({ group, view }: { group: Group; view: DemoView }) {
  const soft = SOFT[group.hex] ?? "var(--color-ink)";
  return (
    <>
      <tr style={{ background: `${group.hex}14` }}>
        <td colSpan={COLS.length + 1} className="px-3 py-1.5">
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: group.hex }} />
            <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: soft }}>
              {group.label}
            </span>
            <span className="text-[10px] tabular-nums text-faint">
              {group.wins} round{group.wins === 1 ? "" : "s"} won
            </span>
          </span>
        </td>
      </tr>
      {group.players.map((p) => {
        const focused = view.focusPlayer === p.i;
        const diff = p.kills - p.deaths;
        return (
          <tr
            key={p.i}
            onClick={() => view.setFocusPlayer(focused ? null : p.i)}
            title={`${focused ? "Unfocus" : "Focus"} ${p.name} across every tab`}
            className={`cursor-pointer border-t border-line/40 transition ${
              focused ? "bg-brand/10" : "hover:bg-panel2/70"
            }`}
          >
            <td
              className="max-w-44 truncate px-3 py-1.5 font-medium"
              style={{
                color: focused ? "var(--color-brand)" : soft,
                boxShadow: `inset 2px 0 0 ${group.hex}66`,
              }}
            >
              {p.name}
            </td>
            <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{p.kills}</td>
            <td className="px-2 py-1.5 text-right tabular-nums text-muted">{p.deaths}</td>
            <td className="px-2 py-1.5 text-right tabular-nums text-muted">{p.assistsApprox}</td>
            <td
              className={`px-2 py-1.5 text-right tabular-nums ${
                diff > 0 ? "text-good" : diff < 0 ? "text-bad" : "text-muted"
              }`}
            >
              {diff > 0 ? `+${diff}` : diff}
            </td>
            <td className={`px-2 py-1.5 text-right tabular-nums ${kdColor(p.kd)}`}>
              {p.kd.toFixed(2)}
            </td>
            <td className="px-2 py-1.5 text-right tabular-nums">{p.adr.toFixed(0)}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{p.kastPct.toFixed(0)}%</td>
            <td className="px-2 py-1.5 text-right tabular-nums text-muted">{p.hsPct.toFixed(0)}%</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{p.openingKills}</td>
            <td className="px-2 py-1.5 text-right tabular-nums text-muted">{p.openingDeaths}</td>
            <td className="px-2 py-1.5 text-right tabular-nums text-muted">{p.tradeKills}</td>
            <td className="px-2 py-1.5 text-right tabular-nums text-muted">{p.multiKillRounds}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">
              {p.clutchTotal > 0 ? (
                <span className={p.clutchWon > 0 ? "text-good" : "text-muted"}>
                  {p.clutchWon}/{p.clutchTotal}
                </span>
              ) : (
                <span className="text-faint">—</span>
              )}
            </td>
            <td className="px-2 py-1.5 text-right tabular-nums text-muted">{p.utilDamage}</td>
          </tr>
        );
      })}
    </>
  );
}
