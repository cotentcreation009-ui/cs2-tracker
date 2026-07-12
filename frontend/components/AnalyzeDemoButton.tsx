"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { analyzeMatch } from "@/lib/demo/parseClient";
import { saveMatch } from "@/lib/demo/store";
import { mapLabel } from "@/lib/format";

// How long Valve keeps GOTV replays. Older Valve matches get a disabled button
// instead of a doomed request (FACEIT keeps demos much longer).
const VALVE_REPLAY_MAX_AGE_MS = 31 * 24 * 3600 * 1000;

// A resolvable Leetify game id is a UUID; the server rejects anything else with
// "invalid match id". Some matches carry an incomplete Leetify record with a
// non-UUID id — mirror the server's check so we never offer a doomed click.
const LEETIFY_GAME_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * AnalyzeDemoButton — one-click demo analysis for a match listed on a profile.
 * Kicks the server-side pipeline (Leetify game id → share code / FACEIT id →
 * demo → parse), saves the report to the local demo library, and navigates to
 * the full report. Renders its own progress/error states inline.
 */
export function AnalyzeDemoButton({
  gameId,
  dataSource,
  finishedAt,
  mapName,
}: {
  gameId: string;
  dataSource: string;
  finishedAt: string;
  mapName: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  // No valid game id → no resolvable demo. Hide the analyze button (the
  // "View on Leetify" link beside it stays) instead of showing one that 400s.
  if (!LEETIFY_GAME_ID.test(gameId)) return null;

  const isValve = dataSource !== "faceit";
  const age = Date.now() - new Date(finishedAt).getTime();
  const expired = isValve && Number.isFinite(age) && age > VALVE_REPLAY_MAX_AGE_MS;

  const run = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    try {
      const { meta, rounds } = await analyzeMatch(gameId, { onPhase: setPhase });
      const saved = await saveMatch(meta, rounds, mapLabel(mapName) || "Match");
      router.push(`/demos/${saved.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase(null);
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
          <>
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 animate-spin" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
              <path d="M12 3a9 9 0 1 1-9 9" strokeLinecap="round" />
            </svg>
            {phase}
          </>
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
