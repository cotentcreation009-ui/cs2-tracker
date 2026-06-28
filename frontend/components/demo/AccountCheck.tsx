"use client";

import { useState } from "react";
import Link from "next/link";
import {
  clientFaceit,
  clientSteamExtras,
  clientSteamStats,
  clientLeetify,
} from "@/lib/demo/accountClient";
import { accountScores, verdict, BAND_HEX, BAND_LABEL, TONE_HEX, type AccountScores, type Band } from "@/lib/demo/account";
import { band5 } from "@/lib/suspicion";

// One score bar with the inputs/reasons that drove it listed beneath (the
// "stats used"), so the number is explainable rather than a black box.
function ScoreBar({
  label,
  score,
  band,
  reasons,
  hint,
}: {
  label: string;
  score: number;
  band: Band;
  reasons: string[];
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-muted">
          {label}
          {hint && <span className="ml-1 text-[10px] text-faint">· {hint}</span>}
        </span>
        <span className="shrink-0 font-bold tabular-nums" style={{ color: BAND_HEX[band] }}>
          {score.toFixed(0)}% {BAND_LABEL[band]}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel">
        <div className="bar-grow h-full rounded-full" style={{ width: `${score}%`, background: BAND_HEX[band] }} />
      </div>
      {reasons.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {reasons.map((r, k) => (
            <li key={k} className="flex gap-1 text-[10px] leading-snug text-faint">
              <span className="text-line2">›</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// On-demand account-level scores for one demo player (Steam/FACEIT/Leetify by
// steamId). One lookup per click, so we never auto-fire 10 profile fetches.
export function AccountCheck({
  steamId,
  name,
  matchScore = 0,
  matchStats = "",
  cheatFactors = "",
  tendencyLines = [],
}: {
  steamId: string;
  name: string;
  matchScore?: number;
  matchStats?: string;
  cheatFactors?: string; // top in-match aim tells, "label value" joined
  tendencyLines?: string[]; // tactical tendencies from positioning/routes
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [data, setData] = useState<AccountScores | null>(null);
  const [err, setErr] = useState("");
  const [aiState, setAiState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [aiText, setAiText] = useState("");
  const [aiErr, setAiErr] = useState("");

  if (!steamId) return null;

  const runAi = async () => {
    if (!data || aiState === "loading") return;
    setAiState("loading");
    setAiErr("");
    const summary = [
      `Player: ${name}`,
      matchStats ? `This-match stats: ${matchStats}` : "",
      `This-match CheatMeter: ${matchScore.toFixed(0)}%${cheatFactors ? ` (aim tells: ${cheatFactors})` : ""}`,
      ...(tendencyLines.length ? ["Playstyle tendencies (from positioning/routes):", ...tendencyLines.map((l) => `- ${l}`)] : []),
      data.cheat
        ? `Career CheatMeter: ${data.cheat.score.toFixed(0)}% — ${
            data.cheat.factors.filter((f) => f.score >= 40).map((f) => `${f.label} ${f.display}`).join(", ") ||
            "no standout factors"
          }`
        : "Career CheatMeter: no data",
      data.smurf ? `Smurf: ${data.smurf.score.toFixed(0)}%${data.smurf.reasons.length ? ` — ${data.smurf.reasons.join(", ")}` : ""}` : "",
      data.boosted ? `Boosted: ${data.boosted.score.toFixed(0)}%${data.boosted.reasons.length ? ` — ${data.boosted.reasons.join(", ")}` : ""}` : "",
      data.trust != null ? `Trust: ${data.trust.toFixed(0)}/100` : "",
      data.banned ? "Has a ban on record." : "No bans on record.",
    ]
      .filter(Boolean)
      .join("\n");
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
      setAiText(text);
      setAiState("done");
    } catch (e) {
      setAiErr(e instanceof Error ? e.message : "failed");
      setAiState("error");
    }
  };

  const run = async () => {
    if (state === "loading") return;
    setState("loading");
    setErr("");
    try {
      const [faceit, extras, steamStats, leetify] = await Promise.all([
        clientFaceit(steamId).catch(() => null),
        clientSteamExtras(steamId).catch(() => null),
        clientSteamStats(steamId).catch(() => null),
        clientLeetify(steamId).catch(() => null),
      ]);
      setData(accountScores(faceit, extras, steamStats, leetify));
      setState("done");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "lookup failed");
      setState("error");
    }
  };

  if (state === "idle") {
    return (
      <button
        type="button"
        onClick={run}
        className="mt-2 w-full rounded-md border border-line py-1 text-[11px] text-muted transition hover:bg-panel/50 hover:text-ink"
      >
        Account check · Smurf / Boosted / Trust
      </button>
    );
  }
  if (state === "loading") return <div className="mt-2 text-[11px] text-faint">Looking up {name}…</div>;
  if (state === "error") return <div className="mt-2 text-[11px] text-bad">Couldn&apos;t look up — {err}</div>;
  if (!data || !data.hasData)
    return <div className="mt-2 text-[11px] text-faint">No public profile data for this player.</div>;

  const v = verdict(matchScore, data);
  return (
    <div className="mt-2 space-y-1.5 rounded-md border border-line bg-bg/40 p-2">
      <div className="rounded-md px-2 py-1.5" style={{ background: `${TONE_HEX[v.tone]}1f` }}>
        <div className="text-[10px] uppercase tracking-wider text-faint">Verdict</div>
        <div className="text-sm font-bold" style={{ color: TONE_HEX[v.tone] }}>
          {v.label}
        </div>
        {v.evidence.length > 0 && (
          <div className="text-[10px] text-muted">{v.evidence.join(" · ")}</div>
        )}
      </div>
      {/* CheatMeter: this match vs career, each with the stats behind it */}
      <div className="space-y-2 border-t border-line pt-2">
        <div className="stat-label">
          CheatMeter · aim anomaly{" "}
          <span className="font-normal normal-case text-faint">(not proof)</span>
        </div>
        <ScoreBar
          label="This match"
          score={matchScore}
          band={band5(matchScore)}
          reasons={cheatFactors ? cheatFactors.split(", ").filter(Boolean) : []}
        />
        {data.cheat && (
          <ScoreBar
            label="Career"
            score={data.cheat.score}
            band={data.cheat.band}
            reasons={data.cheat.factors.filter((f) => f.score >= 40).slice(0, 4).map((f) => `${f.label} ${f.display}`)}
          />
        )}
      </div>

      {data.smurf && (
        <ScoreBar
          label="Smurf"
          hint="low investment + high skill"
          score={data.smurf.score}
          band={data.smurf.band}
          reasons={data.smurf.reasons.length ? data.smurf.reasons : ["no strong smurf signals"]}
        />
      )}
      {data.boosted && (
        <ScoreBar
          label="Boosted"
          hint="high rank, weak mechanics"
          score={data.boosted.score}
          band={data.boosted.band}
          reasons={data.boosted.reasons.length ? data.boosted.reasons : ["no strong boosted signals"]}
        />
      )}
      {data.trust != null && (
        <div className="flex items-center justify-between border-t border-line pt-1.5 text-[11px]">
          <span className="text-muted">
            Trust <span className="text-[10px] text-faint">· 100 − strongest flag{data.banned ? " − ban" : ""}</span>
          </span>
          <span
            className="font-bold tabular-nums"
            style={{ color: data.trust >= 60 ? "#46d369" : data.trust >= 35 ? "#f5b942" : "#f5694a" }}
          >
            {data.trust.toFixed(0)}/100
          </span>
        </div>
      )}
      <div className="border-t border-line pt-1.5">
        {aiState === "idle" && (
          <button
            type="button"
            onClick={runAi}
            className="w-full rounded-md border border-line py-1 text-[11px] text-muted transition hover:bg-panel/50 hover:text-ink"
          >
            ✨ AI read
          </button>
        )}
        {aiState === "loading" && <div className="text-[11px] text-faint">Analysing {name}…</div>}
        {aiState === "error" && <div className="text-[11px] text-bad">AI couldn&apos;t run — {aiErr}</div>}
        {aiState === "done" && (
          <p className="whitespace-pre-line text-[11px] leading-relaxed text-muted">{aiText}</p>
        )}
      </div>

      <Link href={`/profiles/${steamId}`} className="block text-center text-[10px] text-brand hover:underline">
        full profile →
      </Link>
    </div>
  );
}
