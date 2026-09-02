"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { analyzeMatch } from "@/lib/demo/parseClient";
import { saveMatch } from "@/lib/demo/store";
import { mapLabel } from "@/lib/format";

// How long Valve keeps GOTV replays. Older Valve matches get a disabled button
// instead of a doomed request (FACEIT keeps demos much longer).
const VALVE_REPLAY_MAX_AGE_MS = 31 * 24 * 3600 * 1000;

/**
 * AnalyzeDemoButton — one-click demo analysis for a match listed on a profile.
 * Kicks the server-side pipeline (Leetify game id → share code / FACEIT id →
 * demo → parse), saves the report to the local demo library, and navigates to
 * the full report. Renders its own progress/error states inline.
 */
// One bar from three unequal stages. Each stage owns a span of the bar sized
// to how long it actually takes on the server, and the stage's own percent
// fills its span — so the bar moves at roughly the pace of real work instead
// of a spinner that only ever says "still going". Ranges are inclusive floors:
// a stage that has not reported a percent yet sits at its floor.
const STAGES: Record<string, [number, number]> = {
  queued: [0, 5],
  running: [5, 8], // picked up, nothing measured yet
  downloading: [8, 55],
  parsing: [55, 95],
  saving: [95, 99],
  done: [100, 100],
};

function overallPct(server: { phase: string; pct: number } | null): number {
  if (!server) return 2;
  const span = STAGES[server.phase] ?? STAGES.running;
  const within = Math.max(0, Math.min(100, server.pct)) / 100;
  return Math.round(span[0] + (span[1] - span[0]) * within);
}

function stageLabel(server: { phase: string; pct: number } | null): string {
  if (!server) return "starting…";
  switch (server.phase) {
    case "queued":
      return "waiting in queue…";
    case "downloading":
      return server.pct > 0 ? `downloading ${server.pct}%` : "downloading…";
    case "parsing":
      return server.pct > 0 ? `parsing ${server.pct}%` : "parsing…";
    case "saving":
      return "saving…";
    default:
      return "working…";
  }
}

export function AnalyzeDemoButton({
  gameId,
  steamId,
  dataSource,
  finishedAt,
  mapName,
  score,
}: {
  gameId: string;
  steamId: string;
  dataSource: string;
  finishedAt: string;
  mapName: string;
  score?: number[];
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The worker's stage and that stage's own percent, straight off the poll.
  const [server, setServer] = useState<{ phase: string; pct: number } | null>(null);
  const busyRef = useRef(false);

  const isValve = dataSource !== "faceit";
  const age = Date.now() - new Date(finishedAt).getTime();
  const expired = isValve && Number.isFinite(age) && age > VALVE_REPLAY_MAX_AGE_MS;

  const run = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    try {
      const { meta, rounds } = await analyzeMatch(
        gameId,
        { steamId, finishedAt, score },
        {
          onPhase: setPhase,
          onServerProgress: (ph, pct) => setServer({ phase: ph, pct }),
        },
      );
      const saved = await saveMatch(meta, rounds, mapLabel(mapName) || "Match");
      router.push(`/demos/${saved.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase(null);
      setServer(null);
      busyRef.current = false;
    }
  };

  if (expired) {
    return (
      <span
        className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs text-faint"
        title="Valve keeps match replays for ~30 days — this one has expired"
      >
        Replay expired
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void run()}
        disabled={phase != null}
        className="inline-flex items-center gap-1.5 rounded-lg border border-brand/40 bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand transition hover:bg-brand/20 disabled:cursor-wait disabled:opacity-70"
        title="Fetch and analyze this match's demo on our servers"
      >
        {phase != null ? (
          <span
            className="inline-flex items-center gap-2"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={overallPct(server)}
            aria-label={stageLabel(server)}
          >
            <span className="relative h-1.5 w-24 overflow-hidden rounded-full bg-line/70">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-brand transition-[width] duration-500 ease-out"
                style={{ width: `${overallPct(server)}%` }}
              />
            </span>
            <span className="tabular-nums">{stageLabel(server)}</span>
          </span>
        ) : (
          <>
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 3l14 9-14 9V3z" />
            </svg>
            Analyze demo
          </>
        )}
      </button>
      {error && <span className="text-xs text-bad">{error}</span>}
    </span>
  );
}
