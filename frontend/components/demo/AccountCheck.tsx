"use client";

import { useState } from "react";
import Link from "next/link";
import { getFaceit, getSteamExtras, getSteamStats, getLeetify } from "@/lib/api";
import { accountScores, BAND_HEX, BAND_LABEL, type AccountScores, type Band } from "@/lib/demo/account";

function ScoreBar({
  label,
  score,
  band,
  reasons,
}: {
  label: string;
  score: number;
  band: Band;
  reasons: string[];
}) {
  return (
    <div title={reasons.join(" · ")}>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted">{label}</span>
        <span className="font-bold tabular-nums" style={{ color: BAND_HEX[band] }}>
          {score.toFixed(0)}% {BAND_LABEL[band]}
        </span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-panel">
        <div className="h-full rounded-full" style={{ width: `${score}%`, background: BAND_HEX[band] }} />
      </div>
      {reasons.length > 0 && (
        <div className="mt-0.5 truncate text-[10px] text-faint">{reasons.join(" · ")}</div>
      )}
    </div>
  );
}

// On-demand account-level scores for one demo player (Steam/FACEIT/Leetify by
// steamId). One lookup per click, so we never auto-fire 10 profile fetches.
export function AccountCheck({ steamId, name }: { steamId: string; name: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [data, setData] = useState<AccountScores | null>(null);
  const [err, setErr] = useState("");

  if (!steamId) return null;

  const run = async () => {
    if (state === "loading") return;
    setState("loading");
    setErr("");
    try {
      const [faceit, extras, steamStats, leetify] = await Promise.all([
        getFaceit(steamId).catch(() => null),
        getSteamExtras(steamId).catch(() => null),
        getSteamStats(steamId).catch(() => null),
        getLeetify(steamId).catch(() => null),
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

  return (
    <div className="mt-2 space-y-1.5 rounded-md border border-line bg-bg/40 p-2">
      {data.cheat && (
        <ScoreBar
          label="CheatMeter · career"
          score={data.cheat.score}
          band={data.cheat.band}
          reasons={data.cheat.factors.filter((f) => f.score >= 40).slice(0, 3).map((f) => `${f.label} ${f.display}`)}
        />
      )}
      {data.smurf && <ScoreBar label="Smurf" score={data.smurf.score} band={data.smurf.band} reasons={data.smurf.reasons} />}
      {data.boosted && <ScoreBar label="Boosted" score={data.boosted.score} band={data.boosted.band} reasons={data.boosted.reasons} />}
      {data.trust != null && (
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted">Trust</span>
          <span
            className="font-bold tabular-nums"
            style={{ color: data.trust >= 60 ? "#46d369" : data.trust >= 35 ? "#f5b942" : "#f5694a" }}
          >
            {data.trust.toFixed(0)}/100
          </span>
        </div>
      )}
      <Link href={`/profiles/${steamId}`} className="block text-center text-[10px] text-brand hover:underline">
        full profile →
      </Link>
    </div>
  );
}
