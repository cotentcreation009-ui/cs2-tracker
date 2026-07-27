"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import { computeInsights, type PlayerInsight } from "@/lib/demo/insights";
import { demoCheat, BAND_HEX, BAND_LABEL, type DemoCheat } from "@/lib/demo/cheat";
import { computeTendencies, playstyleSummary } from "@/lib/demo/tendencies";
import { cheatMoments, hasAimData, type CheatMoment } from "@/lib/demo/evidence";
import {
  analyzeRotations,
  TRIGGER_LABEL,
  type PlayerRotates,
  type RotateEvent,
  type TriggerKind,
} from "@/lib/demo/rotates";
import { AccountCheck } from "@/components/demo/AccountCheck";
import { cachedAccountScores, fetchAccountScores, getAiRead, setAiRead } from "@/lib/demo/accountStore";
import type { DemoView } from "@/components/demo/MatchToolbar";

const CT = "#5b9dff";
const T = "#e7b53c";
const teamHex = (t: PlayerInsight["team"]) => (t === "T" ? T : t === "CT" ? CT : "var(--color-faint)");
const mmss = (t: number) => {
  const s = Math.max(0, Math.floor(t)); // floor (not round) so 59.6s can't render ":60"
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// A player is "flag-worthy" (drives the lobby count) when the aim-anomaly read
// is at least moderate AND backed by real data.
const FLAG_SCORE = 40;
const isFlagged = (c: DemoCheat) => c.score >= FLAG_SCORE && c.confidence >= 0.5;

const FACTOR_HINT: Record<string, string> = {
  snap: "Landed a kill almost instantly despite the crosshair being far off target — a superhuman correction. The strongest tell, and it doesn't punish good angle-holding.",
  acc: "Share of fired bullets that hit — volume-independent gun accuracy.",
  rot: "Cross-map rotations begun AFTER the enemy team committed elsewhere but BEFORE any information pointed at the destination — no kills, enemy utility, bomb action, or audible contact on that side of the map. Legit hunches split evenly right/wrong and timer reads are slow; fast, consistently-correct blind rotates read like a radar. ✓ correct · ✗ wrong (subtracts).",
  hsacc: "Share of fired bullets that hit the head.",
  react: "Time from an enemy first becoming visible to the kill. Only very low (trigger-like) reads flag.",
  hs: "Headshot percentage of kills. Strong players run high too, so it's a weak corroborator.",
};

const VERDICT_UI: Record<RotateEvent["verdict"], { label: string; cls: string }> = {
  "blind-correct": { label: "before any info — correct", cls: "bg-bad/15 text-bad" },
  "blind-wrong": { label: "blind guess — wrong", cls: "bg-good/15 text-good" },
  hunch: { label: "blind hunch", cls: "bg-panel text-muted" },
  informed: { label: "after info — normal", cls: "bg-panel text-faint" },
};
const VERDICT_ORDER: Record<RotateEvent["verdict"], number> = {
  "blind-correct": 0,
  "blind-wrong": 1,
  hunch: 2,
  informed: 3,
};

// compact factor names for the narrow suspicion-rail rows (full labels truncate)
const FACTOR_SHORT: Record<string, string> = {
  snap: "snap kills",
  acc: "accuracy",
  hsacc: "HS acc",
  react: "reaction",
  hs: "HS %",
  rot: "rotates",
};

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

// ── suspicion leaderboard row ──────────────────────────────────────────────
function SuspectRow({
  p,
  cheat,
  rank,
  selected,
  onSelect,
}: {
  p: PlayerInsight;
  cheat: DemoCheat;
  rank: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const hex = teamHex(p.team);
  const top = cheat.factors[0];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition ${
        selected ? "border-brand/50 bg-brand/10" : "border-transparent hover:bg-panel/60"
      }`}
    >
      <span className="w-4 shrink-0 text-right text-[10px] font-bold tabular-nums text-faint">{rank}</span>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: hex }} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-xs font-semibold ${selected ? "text-brand" : "text-ink"}`}>{p.name}</span>
        <span className="mt-0.5 block h-1 w-full overflow-hidden rounded-full bg-panel">
          <span
            className="block h-full rounded-full"
            style={{ width: `${cheat.score}%`, background: BAND_HEX[cheat.band] }}
          />
        </span>
      </span>
      <span className="w-14 shrink-0 text-right">
        <span className="block text-xs font-bold tabular-nums" style={{ color: BAND_HEX[cheat.band] }}>
          {cheat.score.toFixed(0)}%
        </span>
        <span className="block truncate text-[9px] uppercase tracking-wide text-faint">
          {top ? FACTOR_SHORT[top.key] ?? top.label : cheat.confidence < 0.5 ? "low data" : "clean"}
        </span>
      </span>
    </button>
  );
}

// ── one flagged moment (jump-to-replay evidence) ───────────────────────────
function MomentRow({ m, onWatch }: { m: CheatMoment; onWatch: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-panel/40 px-2 py-1.5">
      <span
        className="grid h-6 w-8 shrink-0 place-items-center rounded text-[9px] font-black"
        style={{ background: `${m.weaponColor}22`, color: m.weaponColor }}
      >
        {m.weaponLabel.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="font-bold tabular-nums text-ink">R{m.roundN}</span>
          <span className="tabular-nums text-faint">{mmss(m.t)}</span>
          <span className="truncate text-muted">→ {m.victim}</span>
          {m.hs && <span className="shrink-0 text-bad" title="headshot">⌖</span>}
          {(m.extraKills ?? 0) > 0 && (
            <span
              className="shrink-0 rounded-full bg-panel px-1.5 text-[9px] font-medium text-faint"
              title="This round's other flagged kills share the same round-level tells — one row covers them"
            >
              +{m.extraKills} more kill{(m.extraKills ?? 0) > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {m.tags.slice(0, 4).map((tg, i) => (
            <span key={i} className="rounded-full bg-panel px-1.5 text-[9px] font-medium text-faint">
              {tg}
            </span>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={onWatch}
        title="Watch this kill in the Replay tab"
        className="shrink-0 rounded-md border border-brand/40 bg-brand/10 px-2 py-1 text-[11px] font-semibold text-brand transition hover:bg-brand/20"
      >
        ▶ Watch
      </button>
    </div>
  );
}

// ── one analyzed rotation (jump-to-replay evidence) ────────────────────────
function RotateRow({ ev, onWatch }: { ev: RotateEvent; onWatch: () => void }) {
  const ui = VERDICT_UI[ev.verdict];
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-panel/40 px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="font-bold tabular-nums text-ink">R{ev.roundN}</span>
          <span className="tabular-nums text-faint">{mmss(ev.t0)}</span>
          <span className="truncate font-semibold text-muted">
            {ev.from} → {ev.to}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          <span className={`rounded-full px-1.5 text-[9px] font-bold ${ui.cls}`}>{ui.label}</span>
          {ev.verdict === "blind-correct" && ev.reactSec != null && (
            <span className="rounded-full bg-panel px-1.5 text-[9px] font-medium text-faint">
              {ev.reactSec.toFixed(0)}s after the enemy shift
            </span>
          )}
          {ev.verdict === "blind-correct" && (
            <span className="rounded-full bg-panel px-1.5 text-[9px] font-medium text-faint">
              {ev.firstInfo != null ? `no info until ${mmss(ev.firstInfo)}` : "no info all round"}
            </span>
          )}
          {ev.verdict === "informed" && ev.trigger != null && (
            <span className="rounded-full bg-panel px-1.5 text-[9px] font-medium text-faint">
              ↳ {ev.trigger.label} {mmss(ev.trigger.t)} · moved +{Math.max(0, ev.t0 - ev.trigger.t).toFixed(0)}s
            </span>
          )}
          {ev.verdict === "hunch" && (
            <span className="rounded-full bg-panel px-1.5 text-[9px] font-medium text-faint">
              no info, enemies uncommitted — a read/guess
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onWatch}
        title="Watch this rotation in the Replay tab"
        className="shrink-0 rounded-md border border-brand/40 bg-brand/10 px-2 py-1 text-[11px] font-semibold text-brand transition hover:bg-brand/20"
      >
        ▶ Watch
      </button>
    </div>
  );
}

// ── the case file for one selected suspect ─────────────────────────────────
function CaseFile({
  p,
  cheat,
  rot,
  rotReason,
  meta,
  rounds,
  view,
  demoId,
  autoRunAccount,
  onWatch,
}: {
  p: PlayerInsight;
  cheat: DemoCheat;
  rot: PlayerRotates | null;
  rotReason?: string;
  meta: ReplayMeta;
  rounds: ReplayRound[];
  view: DemoView;
  demoId: string;
  autoRunAccount: boolean;
  onWatch: (round: number, t: number, player: number | null) => void;
}) {
  const hex = teamHex(p.team);
  const tend = useMemo(() => computeTendencies(meta, rounds), [meta, rounds]);
  const tendLines = useMemo(() => playstyleSummary(p, tend.get(p.steamId)), [p, tend]);
  const moments = useMemo(() => cheatMoments(meta, rounds, p.i), [meta, rounds, p.i]);
  const aimBacked = useMemo(() => hasAimData(rounds), [rounds]);

  const rotEvents = useMemo(
    () =>
      (rot?.events ?? [])
        .slice()
        .sort(
          (a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || a.roundN - b.roundN,
        )
        .slice(0, 8),
    [rot],
  );

  const cheatFactors = cheat.factors.slice(0, 4).map((f) => `${f.label} ${f.display}`).join(", ");
  const matchStats = `${p.kills}-${p.deaths} (K/D ${p.kd.toFixed(2)}, ${p.kpr.toFixed(2)} KPR), ${p.hsPct.toFixed(0)}% HS, ${p.adr.toFixed(0)} ADR${
    p.shots >= 40 ? `, acc ${p.accuracy.toFixed(0)}%/HS-acc ${p.hsAccuracy.toFixed(0)}%` : ""
  }${p.aimSamples >= 6 ? `, reaction ${p.reactionMs.toFixed(0)}ms, snap ${p.snapRate.toFixed(0)}%` : ""}`;

  return (
    <div className="scroll-slim card-2 flex flex-col gap-3 px-4 py-3 lg:h-full lg:min-h-0 lg:gap-2.5 lg:overflow-y-auto">
      {/* identity */}
      <div className="flex items-center gap-2 lg:shrink-0">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-black" style={{ background: `${hex}22`, color: hex }}>
          {(p.name || "?").slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="truncate text-base font-extrabold">{p.name}</div>
          <div className="text-[11px] tabular-nums text-faint">
            {p.team || "—"} · {p.kills}-{p.deaths} · {p.adr.toFixed(0)} ADR · {p.hsPct.toFixed(0)}% HS
          </div>
        </div>
        <Link
          href={`/profiles/${p.steamId}`}
          className="ml-auto shrink-0 rounded border border-line px-2 py-1 text-[11px] text-muted transition hover:bg-panel/50 hover:text-ink"
        >
          Profile →
        </Link>
      </div>

      {/* CheatMeter headline + factor breakdown */}
      <div className="rounded-lg border border-line bg-panel/30 px-3 py-2.5 lg:shrink-0">
        <div className="flex items-end justify-between">
          <div>
            <div className="stat-label">In-match CheatMeter</div>
            <div className="text-[10px] text-faint">aim + information anomalies — never fragging volume · not proof</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-extrabold leading-none tabular-nums" style={{ color: BAND_HEX[cheat.band] }}>
              {cheat.score.toFixed(0)}%
            </div>
            <div className="text-[10px] font-bold uppercase" style={{ color: BAND_HEX[cheat.band] }}>
              {BAND_LABEL[cheat.band]}
            </div>
          </div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel">
          <div className="h-full rounded-full" style={{ width: `${cheat.score}%`, background: BAND_HEX[cheat.band] }} />
        </div>
        {cheat.confidence < 0.6 && (
          <div className="mt-1 text-[10px] text-mid">
            Low confidence ({(cheat.confidence * 100).toFixed(0)}%) — re-parse the demo for full aim data.
          </div>
        )}
        {cheat.factors.length > 0 ? (
          <div className="mt-2 space-y-1.5 border-t border-line pt-2">
            {cheat.factors.map((f) => (
              <div key={f.key} title={FACTOR_HINT[f.key]}>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted">{f.label}</span>
                  <span className="tabular-nums" style={{ color: BAND_HEX[f.band] }}>
                    {f.display} · {f.score.toFixed(0)}
                  </span>
                </div>
                <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-panel">
                  <div className="h-full rounded-full" style={{ width: `${f.score}%`, background: BAND_HEX[f.band] }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 border-t border-line pt-2 text-[11px] text-faint">
            No aim tells captured — re-parse for snap/accuracy data.
          </div>
        )}
      </div>

      {/* rotation review — the information-anomaly evidence. Sits above the
          flagged moments: it's the newest read and even an all-informed list
          is a finding ("every rotate followed real information"). */}
      <div className="lg:shrink-0">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="stat-label">Rotation review</span>
          {rot && rot.total > 0 && (
            <span className="text-[10px] tabular-nums text-faint">
              {rot.total} rotate{rot.total > 1 ? "s" : ""} · {rot.blindCorrect} pre-info
              {rot.avgReactSec != null ? ` · ~${rot.avgReactSec.toFixed(0)}s react` : ""}
            </span>
          )}
        </div>
        {rotReason ? (
          <div className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-[11px] text-faint">
            Rotation analysis unavailable — {rotReason}.
          </div>
        ) : !rot || rot.total === 0 ? (
          <div className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-[11px] text-faint">
            No cross-map rotations detected for this player — nothing to read here.
          </div>
        ) : (
          <div className="space-y-1.5">
            {rot.blindCorrect === 0 && rot.blindWrong === 0 && rot.hunch === 0 && (
              <div className="flex items-center gap-1.5 px-1 pb-0.5 text-[10px] text-good">
                <span className="h-1.5 w-1.5 rounded-full bg-good" />
                Every rotation followed real information — normal map sense, no radar tell.
              </div>
            )}
            {rot.informed > 0 && Object.keys(rot.byTrigger).length > 0 && (
              <div className="px-1 pb-0.5 text-[10px] leading-relaxed text-muted">
                Rotates on{" "}
                {Object.entries(rot.byTrigger)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, n]) => `${TRIGGER_LABEL[k as TriggerKind]} ×${n}`)
                  .join(" · ")}
                {rot.avgResponseSec != null &&
                  ` — typically moves ~${rot.avgResponseSec.toFixed(0)}s after the info appears`}
                {rot.hunch > 0 && ` · plus ${rot.hunch} pure read${rot.hunch > 1 ? "s" : ""} (no info)`}
              </div>
            )}
            {rotEvents.map((ev, i) => (
              <RotateRow
                key={`${ev.roundIdx}-${ev.t0}-${i}`}
                ev={ev}
                onWatch={() => onWatch(ev.roundIdx, Math.max(0, ev.t0 - 3), p.i)}
              />
            ))}
            {rot.total > rotEvents.length && (
              <div className="px-1 text-[10px] text-faint">
                +{rot.total - rotEvents.length} more (informed rotations trimmed)
              </div>
            )}
          </div>
        )}
      </div>

      {/* flagged moments — the reviewable evidence */}
      <div className="lg:shrink-0">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="stat-label">Flagged moments</span>
          <span className="text-[10px] text-faint">{moments.length} to review · click ▶</span>
        </div>
        {moments.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-[11px] text-faint">
            {aimBacked
              ? "No standout kills — nothing this player did reads as anomalous."
              : "No per-round aim data (older parse). Re-parse to surface reviewable moments."}
          </div>
        ) : (
          <div className="space-y-1.5">
            {moments.map((m, i) => (
              <MomentRow key={`${m.roundIdx}-${m.t}-${i}`} m={m} onWatch={() => onWatch(m.roundIdx, m.t, p.i)} />
            ))}
          </div>
        )}
      </div>

      {/* tendencies */}
      {tendLines.length > 0 && (
        <div className="lg:shrink-0">
          <div className="stat-label mb-1">Tendencies</div>
          <div className="space-y-0.5">
            {tendLines.map((l, i) => (
              <div key={i} className="text-[11px] leading-snug text-muted">
                {l}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* account check + AI read (session-cached, demo-scoped) */}
      <div className="lg:shrink-0">
        <AccountCheck
          steamId={p.steamId}
          name={p.name}
          matchScore={cheat.score}
          matchStats={matchStats}
          cheatFactors={cheatFactors}
          tendencyLines={tendLines}
          aiKey={`player:${demoId}:${p.steamId}`}
          autoRun={autoRunAccount ? 0 : null}
        />
      </div>
    </div>
  );
}

/**
 * MatchVerdict — the "Cheat / AI" tab, rebuilt as an investigation console:
 * a lobby verdict + a suspicion leaderboard on the left, and a deep case file
 * on the right whose flagged moments jump straight to the Replay. The
 * CheatMeter is aim-anomaly only (not fragging volume) and is always a
 * "look here", never proof. Reads are match-wide (aim needs samples), honoring
 * only the side filter.
 */
export default function MatchVerdict({
  meta,
  rounds,
  view,
  demoId,
  onWatch,
}: {
  meta: ReplayMeta;
  rounds: ReplayRound[];
  view: DemoView;
  demoId: string;
  onWatch: (round: number, t: number, player: number | null) => void;
}) {
  const data = useMemo(() => computeInsights(meta, rounds), [meta, rounds]);
  const rotReport = useMemo(() => analyzeRotations(meta, rounds), [meta, rounds]);

  const players = useMemo(
    () =>
      data.players
        .filter((p) => view.side === "all" || p.team === view.side)
        .map((p) => ({
          p,
          rot: rotReport.byPlayer.get(p.i) ?? null,
          cheat: demoCheat(p, rotReport.byPlayer.get(p.i) ?? null),
        }))
        .sort((a, b) => b.cheat.score - a.cheat.score),
    [data, rotReport, view.side],
  );

  const [selId, setSelId] = useState<string | null>(null);
  const selected = players.find((x) => x.p.steamId === selId) ?? players[0] ?? null;
  useEffect(() => {
    if (players.length && !players.some((x) => x.p.steamId === selId)) setSelId(players[0].p.steamId);
  }, [players, selId]);

  const flaggedCount = players.filter((x) => isFlagged(x.cheat)).length;

  // lobby-level rotation read — one line proving the check ran and what it found
  const rotTotals = useMemo(
    () => ({
      total: rotReport.events.length,
      bc: rotReport.events.filter((e) => e.verdict === "blind-correct").length,
    }),
    [rotReport],
  );

  // "Check all" prefetches every player's account scores (staggered + deduped)
  // so the AI match read is enriched and any case file opens instantly.
  const [checkAll, setCheckAll] = useState(false);
  useEffect(() => {
    if (!checkAll) return;
    const timers = players.map((x, idx) =>
      setTimeout(() => {
        void fetchAccountScores(x.p.steamId);
      }, idx * 350),
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkAll, players.length]);
  // Reads are match-wide (aim needs samples), so the AI cache is scope-
  // INDEPENDENT — keying it by round scope would re-bill an identical prompt on
  // every scope change. The match read still depends on `side` (it filters the
  // player set); a per-player read depends on neither.
  const matchKey = `match:${demoId}:${view.side}`;
  const cachedMatchAi = getAiRead(matchKey);
  const [matchAi, setMatchAi] = useState<"idle" | "loading" | "done" | "error">(cachedMatchAi ? "done" : "idle");
  const [matchAiText, setMatchAiText] = useState(cachedMatchAi ?? "");
  const [matchAiErr, setMatchAiErr] = useState("");
  const [matchAiOpen, setMatchAiOpen] = useState(!!cachedMatchAi);
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
    const lines = players.map(({ p, cheat, rot }) => {
      const acct = cachedAccountScores(p.steamId);
      const acctBits = acct
        ? `${acct.banned ? ", BAN on record" : ""}${acct.trust != null ? `, trust ${acct.trust.toFixed(0)}/100` : ""}`
        : "";
      const tells = cheat.factors.slice(0, 2).map((f) => `${f.label} ${f.display}`).join(", ");
      const rotBits =
        rot && rot.blindCorrect + rot.blindWrong > 0
          ? `, blind rotates ${rot.blindCorrect}✓/${rot.blindWrong}✗`
          : "";
      const rotStyle =
        rot && rot.informed > 0 && rot.avgResponseSec != null
          ? `, rotates ~${rot.avgResponseSec.toFixed(0)}s after info (${Object.entries(rot.byTrigger)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 2)
              .map(([k]) => TRIGGER_LABEL[k as TriggerKind])
              .join(", ")})`
          : "";
      return `- ${safeName(p.name)} (${p.team || "?"}): ${p.kills}-${p.deaths}, ADR ${p.adr.toFixed(0)}, HS ${p.hsPct.toFixed(0)}%, CheatMeter ${cheat.score.toFixed(0)}%${tells ? ` (${tells})` : ""}${rotBits}${rotStyle}${acctBits}`;
    });
    const summary = [
      `MATCH-LEVEL read: a ${rounds.length}-round game on ${meta.map} with ${players.length} players (in-match CheatMeter covers aim anomalies plus information anomalies — "blind rotates" are cross-map rotations made before any info existed, ✓ correct / ✗ wrong; not proof; account data included where already checked). Assess the LOBBY: which players (if any) warrant a closer look and why, who reads clean, and one overall line. Be measured and concrete.`,
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

  const lobbyRead =
    flaggedCount === 0
      ? "No standout aim anomalies — this lobby reads clean"
      : `${flaggedCount} player${flaggedCount > 1 ? "s" : ""} worth a closer look`;

  return (
    <div className="lg:flex lg:h-full lg:min-h-0 lg:flex-col">
      {/* lobby verdict header */}
      <div className="mb-3 flex flex-col gap-2 rounded-lg border border-line bg-panel/40 px-4 py-2.5 lg:mb-2 lg:shrink-0 lg:flex-row lg:items-center lg:px-3 lg:py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: flaggedCount ? BAND_HEX[players[0].cheat.band] : "#46d369" }}
            />
            <span className="text-sm font-bold">{lobbyRead}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted">
            CheatMeter scores aim anomalies (snap kills, accuracy, reaction) and information anomalies
            (rotations before any info existed) — never fragging volume. Pick a player for their case file;
            ▶ a moment to watch it. Signals from public data — not proof.
          </p>
          <div className="mt-1 flex items-center gap-1.5 text-[10px]">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                !rotReport.available ? "bg-faint/40" : rotTotals.bc ? "bg-bad" : "bg-good"
              }`}
            />
            <span className="min-w-0 truncate text-faint" title="Cross-map rotations vs. the information that could justify them — the radar-hack read">
              {!rotReport.available
                ? `Rotation read unavailable — ${rotReport.reason}.`
                : rotTotals.total === 0
                  ? "Rotation read: no cross-map rotations this match."
                  : `Rotation read: ${rotTotals.total} rotation${rotTotals.total > 1 ? "s" : ""} analyzed · ${
                      rotTotals.bc
                        ? `${rotTotals.bc} began before any info — review in the case files`
                        : "every one followed real information"
                    }`}
            </span>
          </div>
        </div>
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
            title="One AI write-up for the whole lobby"
            className="rounded-md border border-brand/40 bg-brand/10 px-2.5 py-1 text-[11px] font-semibold text-brand transition hover:bg-brand/20 disabled:opacity-50"
          >
            {matchAi === "loading" ? "Analysing…" : "✨ AI match read"}
          </button>
        </div>
      </div>

      {matchAiOpen && matchAi !== "idle" && (
        <div className="scroll-slim mb-3 rounded-lg border border-brand/30 bg-brand/5 px-4 py-2.5 lg:mb-2 lg:max-h-36 lg:shrink-0 lg:overflow-y-auto lg:px-3 lg:py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="stat-label">AI match read</span>
            <button type="button" onClick={() => setMatchAiOpen(false)} className="text-xs text-faint transition hover:text-ink">
              ✕
            </button>
          </div>
          {matchAi === "loading" && <div className="mt-1 text-[11px] text-faint">Reading the lobby…</div>}
          {matchAi === "error" && <div className="mt-1 text-[11px] text-bad">AI couldn&apos;t run — {matchAiErr}</div>}
          {matchAi === "done" && <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-muted">{matchAiText}</p>}
        </div>
      )}

      {/* leaderboard | case file */}
      <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] lg:gap-3">
        <div className="card-2 flex flex-col px-3 py-2.5 lg:min-h-0 lg:px-2.5 lg:py-2">
          <div className="mb-1.5 flex items-center justify-between lg:shrink-0">
            <span className="stat-label">Suspicion ranking</span>
            <span className="text-[10px] text-faint">aim + info anomaly ↓</span>
          </div>
          <div className="scroll-slim space-y-0.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-0.5">
            {players.map(({ p, cheat }, idx) => (
              <SuspectRow
                key={p.steamId}
                p={p}
                cheat={cheat}
                rank={idx + 1}
                selected={selected?.p.steamId === p.steamId}
                onSelect={() => setSelId(p.steamId)}
              />
            ))}
          </div>
        </div>

        {selected && (
          <CaseFile
            key={selected.p.steamId}
            p={selected.p}
            cheat={selected.cheat}
            rot={selected.rot}
            rotReason={rotReport.available ? undefined : rotReport.reason}
            meta={meta}
            rounds={rounds}
            view={view}
            demoId={demoId}
            autoRunAccount={checkAll}
            onWatch={onWatch}
          />
        )}
      </div>
    </div>
  );
}
