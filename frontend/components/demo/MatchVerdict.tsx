"use client";

import { useMemo } from "react";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import { computeInsights, type PlayerInsight } from "@/lib/demo/insights";
import { demoCheat, BAND_HEX, BAND_LABEL, type DemoCheat } from "@/lib/demo/cheat";
import { AccountCheck } from "@/components/demo/AccountCheck";
import type { DemoView } from "@/components/demo/MatchToolbar";

const CT = "#5b9dff";
const T = "#e7b53c";

function VerdictCard({ p, cheat }: { p: PlayerInsight; cheat: DemoCheat }) {
  const col = p.team === "T" ? T : CT;
  const matchStats = `${p.kills}-${p.deaths} (K/D ${p.kd.toFixed(2)}, ${p.kpr.toFixed(2)} KPR), ${p.hsPct.toFixed(0)}% HS, ${p.adr.toFixed(0)} ADR, opening ${p.openingWinPct.toFixed(0)}%${
    p.aimSamples >= 5
      ? `, reaction ${p.reactionMs.toFixed(0)}ms, pre-aim ${p.preaimDeg.toFixed(1)}°`
      : ""
  }`;

  return (
    <div className="card-2 px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: col }} />
        <span className="truncate text-sm font-bold">{p.name}</span>
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-faint">
          {p.kills}-{p.deaths} · {p.adr.toFixed(0)} ADR
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
            className="h-full rounded-full"
            style={{ width: `${cheat.score}%`, background: BAND_HEX[cheat.band] }}
          />
        </div>
        <div className="mt-1 truncate text-[10px] text-faint">
          {cheat.factors
            .slice(0, 3)
            .map((f) => `${f.label} ${f.display}`)
            .join(" · ")}
        </div>
      </div>

      <AccountCheck steamId={p.steamId} name={p.name} matchScore={cheat.score} matchStats={matchStats} />
    </div>
  );
}

/**
 * MatchVerdict — a dedicated cheat/smurf read for the match. One card per player
 * with their in-match CheatMeter, the combined account verdict, and an on-demand
 * AI write-up. Most-suspicious players first so they're not buried.
 */
export default function MatchVerdict({
  meta,
  rounds,
  view,
}: {
  meta: ReplayMeta;
  rounds: ReplayRound[];
  view: DemoView;
}) {
  const data = useMemo(() => {
    const scoped =
      view.scopeRound != null && rounds[view.scopeRound] ? [rounds[view.scopeRound]] : rounds;
    return computeInsights(meta, scoped);
  }, [meta, rounds, view.scopeRound]);

  const players = useMemo(() => {
    return data.players
      .filter((p) => view.side === "all" || p.team === view.side)
      .map((p) => ({ p, cheat: demoCheat(p) }))
      .sort((a, b) => b.cheat.score - a.cheat.score);
  }, [data, view.side]);

  if (players.length === 0) {
    return <div className="card-2 px-4 py-6 text-sm text-muted">No player data in this scope.</div>;
  }

  return (
    <div>
      <div className="mb-3 rounded-lg border border-line bg-panel/40 px-4 py-2.5 text-xs text-muted">
        Per-player read combining the <span className="text-ink">in-match CheatMeter</span> (aim,
        HS%, reaction, pre-aim) with <span className="text-ink">account signals</span> (Smurf /
        Boosted / Trust, bans). Open <span className="text-ink">Account check</span> for the combined
        verdict, then <span className="text-ink">✨ AI read</span> for a written analysis. These are
        signals from public stats — not proof.
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {players.map(({ p, cheat }) => (
          <VerdictCard key={p.steamId} p={p} cheat={cheat} />
        ))}
      </div>
    </div>
  );
}
