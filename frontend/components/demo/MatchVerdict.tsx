"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import { computeInsights, type PlayerInsight } from "@/lib/demo/insights";
import { demoCheat, BAND_HEX, BAND_LABEL, type DemoCheat } from "@/lib/demo/cheat";
import { computeTendencies, playstyleSummary, type PlayerTendencies } from "@/lib/demo/tendencies";
import { AccountCheck } from "@/components/demo/AccountCheck";
import { cachedAccountScores, getAiRead, setAiRead } from "@/lib/demo/accountStore";
import type { DemoView } from "@/components/demo/MatchToolbar";

const CT = "#5b9dff";
const T = "#e7b53c";

// strip control chars + angle brackets from attacker-controlled names before
// they enter an AI prompt (same rule as the per-player read).
function safeName(name: string): string {
  return (
    [...String(name)]
      .filter((ch) => {
        const c = ch.codePointAt(0) ?? 0;
        return c >= 0x20 && c !== 0x7f && ch !== "<" && ch !== ">";
      })
      .join("")
      .trim()
      .slice(0, 64) || "Unknown"
  );
}

function VerdictCard({
  p,
  cheat,
  tend,
  autoRun,
  aiScope,
}: {
  p: PlayerInsight;
  cheat: DemoCheat;
  tend?: PlayerTendencies;
  autoRun?: number | null;
  aiScope: string; // demo+scope identity for the AI-read cache key
}) {
  const col = p.team === "T" ? T : CT;
  const tLines = playstyleSummary(p, tend);
  const cheatFactors = cheat.factors
    .slice(0, 4)
    .map((f) => `${f.label} ${f.display}`)
    .join(", ");
  const matchStats = `${p.kills}-${p.deaths} (K/D ${p.kd.toFixed(2)}, ${p.kpr.toFixed(2)} KPR), ${p.hsPct.toFixed(0)}% HS, ${p.adr.toFixed(0)} ADR${
    p.shots >= 40 ? `, acc ${p.accuracy.toFixed(0)}%/HS-acc ${p.hsAccuracy.toFixed(0)}%` : ""
  }${p.aimSamples >= 6 ? `, reaction ${p.reactionMs.toFixed(0)}ms, snap ${p.snapRate.toFixed(0)}%` : ""}`;

  return (
    // At lg+ the grid row bounds the card's height; anything past it (expanded
    // account check, long AI write-ups) scrolls inside the card, never the pane.
    <div className="card-2 px-3.5 py-3 lg:min-h-0 lg:overflow-y-auto lg:px-3 lg:py-2.5">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: col }} />
        <span className="truncate text-sm font-bold">{p.name}</span>
        <Link
          href={`/profiles/${p.steamId}`}
          title="Open full career profile"
          className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-muted transition hover:bg-panel/50 hover:text-ink"
        >
          Profile →
        </Link>
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
        autoRun={autoRun}
        aiKey={`player:${aiScope}:${p.steamId}`}
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
  demoId,
}: {
  meta: ReplayMeta;
  rounds: ReplayRound[];
  view: DemoView;
  demoId: string;
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

  // "Check all" drives every card's AccountCheck via a staggered autoRun.
  const [checkAll, setCheckAll] = useState(false);

  // Match-level AI read — one write-up for the whole lobby, session-cached per
  // DEMO + scope so tab switches / re-clicks don't re-bill the endpoint, and
  // two different demos can never collide (the store outlives navigation).
  const aiScope = `${demoId}:${view.scopeRound ?? "all"}:${view.side}`;
  const matchKey = `match:${aiScope}`;
  const cachedMatchAi = getAiRead(matchKey);
  const [matchAi, setMatchAi] = useState<"idle" | "loading" | "done" | "error">(
    cachedMatchAi ? "done" : "idle",
  );
  const [matchAiText, setMatchAiText] = useState(cachedMatchAi ?? "");
  const [matchAiErr, setMatchAiErr] = useState("");
  const [matchAiOpen, setMatchAiOpen] = useState(!!cachedMatchAi);

  // scope/side changes swap the matchKey — re-sync the panel from the cache so
  // it can never show the previous scope's write-up (useState initializers
  // don't re-run on key change).
  const matchKeyRef = useRef(matchKey);
  useEffect(() => {
    matchKeyRef.current = matchKey;
    const hit = getAiRead(matchKey);
    setMatchAiText(hit ?? "");
    setMatchAi(hit ? "done" : "idle");
    setMatchAiOpen(!!hit);
    setMatchAiErr("");
  }, [matchKey]);

  const runMatchAi = async () => {
    if (matchAi === "loading") return;
    const key = matchKey;
    const hit = getAiRead(key);
    if (hit) {
      setMatchAiText(hit);
      setMatchAi("done");
      setMatchAiOpen(true);
      return;
    }
    setMatchAi("loading");
    setMatchAiErr("");
    setMatchAiOpen(true);
    const lines = players.map(({ p, cheat }) => {
      const acct = cachedAccountScores(p.steamId);
      const acctBits = acct
        ? `${acct.banned ? ", BAN on record" : ""}${acct.trust != null ? `, trust ${acct.trust.toFixed(0)}/100` : ""}`
        : "";
      const tells = cheat.factors.slice(0, 2).map((f) => `${f.label} ${f.display}`).join(", ");
      return `- ${safeName(p.name)} (${p.team || "?"}): ${p.kills}-${p.deaths}, ADR ${p.adr.toFixed(0)}, HS ${p.hsPct.toFixed(0)}%, CheatMeter ${cheat.score.toFixed(0)}%${tells ? ` (${tells})` : ""}${acctBits}`;
    });
    const summary = [
      `MATCH-LEVEL read requested: a ${rounds.length}-round game on ${meta.map} with ${players.length} players (in-match CheatMeter is aim-anomaly only, not proof; account data included where already looked up). Assess the LOBBY: which players (if any) warrant a closer look and why, who reads clean, and an overall one-line take. Be measured and concrete.`,
      ...lines,
    ].join("\n");
    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ summary }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || `AI request failed (${res.status})`);
      }
      const { text } = (await res.json()) as { text: string };
      setAiRead(key, text);
      // if the scope changed while the request was in flight, the cache write
      // above is still correct — just don't paint it over the new scope's panel
      if (matchKeyRef.current !== key) return;
      setMatchAiText(text);
      setMatchAi("done");
    } catch (e) {
      if (matchKeyRef.current !== key) return;
      setMatchAiErr(e instanceof Error ? e.message : "failed");
      setMatchAi("error");
    }
  };

  if (players.length === 0) {
    return <div className="card-2 px-4 py-6 text-sm text-muted">No player data in this scope.</div>;
  }

  return (
    // Viewport-locked at lg+: fill the pane exactly — intro strip on top, then
    // the card grid takes the rest. Rows split the remaining height evenly
    // (auto-rows-fr) so every card is bounded and scrolls internally instead of
    // growing the pane.
    <div className="lg:flex lg:h-full lg:min-h-0 lg:flex-col">
      <div className="mb-3 flex flex-col gap-2 rounded-lg border border-line bg-panel/40 px-4 py-2.5 text-xs text-muted lg:mb-2 lg:shrink-0 lg:flex-row lg:items-center lg:px-3 lg:py-1.5">
        <p className="min-w-0 flex-1">
          The <span className="text-ink">in-match CheatMeter</span> scores only aim-quality anomalies
          (snap kills, accuracy, reaction) — never fragging volume — alongside{" "}
          <span className="text-ink">tendencies</span> and <span className="text-ink">account signals</span>.
          Signals from public data — not proof.
        </p>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={() => setCheckAll(true)}
            disabled={checkAll}
            title="Run the Smurf/Boosted/Trust account check for every player"
            className="rounded-md border border-line px-2.5 py-1 text-[11px] font-medium text-muted transition hover:bg-panel/60 hover:text-ink disabled:opacity-50"
          >
            {checkAll ? "Checks queued ✓" : "Check all accounts"}
          </button>
          <button
            type="button"
            onClick={runMatchAi}
            disabled={matchAi === "loading"}
            title="One AI write-up for the whole lobby (runs on the players below; account data included where checked)"
            className="rounded-md border border-brand/40 bg-brand/10 px-2.5 py-1 text-[11px] font-semibold text-brand transition hover:bg-brand/20 disabled:opacity-50"
          >
            {matchAi === "loading" ? "Analysing…" : "✨ AI match read"}
          </button>
        </div>
      </div>

      {matchAiOpen && matchAi !== "idle" && (
        <div className="mb-3 rounded-lg border border-brand/30 bg-brand/5 px-4 py-2.5 lg:mb-2 lg:max-h-40 lg:shrink-0 lg:overflow-y-auto lg:px-3 lg:py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="stat-label">AI match read</span>
            <button
              type="button"
              onClick={() => setMatchAiOpen(false)}
              title="Hide"
              className="text-xs text-faint transition hover:text-ink"
            >
              ✕
            </button>
          </div>
          {matchAi === "loading" && <div className="mt-1 text-[11px] text-faint">Reading the lobby…</div>}
          {matchAi === "error" && <div className="mt-1 text-[11px] text-bad">AI couldn&apos;t run — {matchAiErr}</div>}
          {matchAi === "done" && (
            <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-muted">{matchAiText}</p>
          )}
        </div>
      )}

      {/* Wide pane → go horizontal: 4–5 columns at lg+ so 10 players land in
          2 rows at ~1080p. min-h-0 + flex-1 keeps the grid bounded so the
          per-card scrollers actually get a height. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:min-h-0 lg:flex-1 lg:auto-rows-fr lg:grid-cols-4 lg:gap-2.5 xl:grid-cols-5">
        {players.map(({ p, cheat }, idx) => (
          <VerdictCard
            key={p.steamId}
            p={p}
            cheat={cheat}
            tend={tend.get(p.steamId)}
            autoRun={checkAll ? idx * 350 : null}
            aiScope={aiScope}
          />
        ))}
      </div>
    </div>
  );
}
