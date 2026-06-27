"use client";

import { useMemo } from "react";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import { computeInsights, type PlayerInsight } from "@/lib/demo/insights";
import { demoCheat, BAND_HEX, BAND_LABEL, type DemoCheat } from "@/lib/demo/cheat";
import { computeTendencies, tendencySummary, type PlayerTendencies } from "@/lib/demo/tendencies";
import { AccountCheck } from "@/components/demo/AccountCheck";
import type { DemoView } from "@/components/demo/MatchToolbar";

const CT = "#5b9dff";
const T = "#e7b53c";

function VerdictCard({ p, cheat, tend }: { p: PlayerInsight; cheat: DemoCheat; tend?: PlayerTendencies }) {
  const col = p.team === "T" ? T : CT;
  const tLines = tendencySummary(tend);
  const cheatFactors = cheat.factors
    .slice(0, 4)
    .map((f) => `${f.label} ${f.display}`)
    .join(", ");
  const matchStats = `${p.kills}-${p.deaths} (K/D ${p.kd.toFixed(2)}, ${p.kpr.toFixed(2)} KPR), ${p.hsPct.toFixed(0)}% HS, ${p.adr.toFixed(0)} ADR${
    p.shots >= 40 ? `, acc ${p.accuracy.toFixed(0)}%/HS-acc ${p.hsAccuracy.toFixed(0)}%` : ""
  }${p.aimSamples >= 6 ? `, reaction ${p.reactionMs.toFixed(0)}ms, snap ${p.snapRate.toFixed(0)}%` : ""}`;

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
        title={`CheatMeter — aim-anomaly signal, not proof. ${cheat.factors
          .slice(0, 4)
          .map((f) => `${f.label} ${f.display}`)
          .join(" · ")}`}
      >
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted">
            CheatMeter <span className="text-faint">· aim, this match</span>
          </span>
          <span className="font-bold tabular-nums" style={{ color: BAND_HEX[cheat.band] }}>
            {cheat.score.toFixed(0)}% {BAND_LABEL[cheat.band]}
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel">
          <div className="h-full rounded-full" style={{ width: `${cheat.score}%`, background: BAND_HEX[cheat.band] }} />
        </div>
        <div className="mt-1 truncate text-[10px] text-faint">
          {cheatFactors || "no aim data"}
          {cheat.confidence < 0.6 && <span className="text-mid"> · low confidence — re-parse for aim data</span>}
        </div>
      </div>

      {tLines.length > 0 && (
        <div className="mt-2 space-y-0.5 border-t border-line pt-1.5">
          <div className="text-[10px] uppercase tracking-wider text-faint">Tendencies</div>
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
        matchStats={matchStats}
        cheatFactors={cheatFactors}
        tendencyLines={tLines}
      />
    </div>
  );
}

/**
 * MatchVerdict — the dedicated "Cheat / AI" tab. One card per player with their
 * in-match CheatMeter (aim-quality only), tactical tendencies from positioning,
 * the combined account verdict, and an on-demand AI write-up. Most-suspicious
 * players first so they're not buried.
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

  // Tendencies are only meaningful match-wide, so always compute on the full set.
  const tend = useMemo(() => computeTendencies(meta, rounds), [meta, rounds]);

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
        Per-player read: the <span className="text-ink">in-match CheatMeter</span> scores only
        aim-quality anomalies (snap kills, accuracy, reaction) — never fragging volume — alongside{" "}
        <span className="text-ink">tactical tendencies</span> from positioning and{" "}
        <span className="text-ink">account signals</span>. Open <span className="text-ink">Account check</span>{" "}
        then <span className="text-ink">✨ AI read</span> for a written analysis. Signals from public data — not proof.
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {players.map(({ p, cheat }) => (
          <VerdictCard key={p.steamId} p={p} cheat={cheat} tend={tend.get(p.steamId)} />
        ))}
      </div>
    </div>
  );
}
