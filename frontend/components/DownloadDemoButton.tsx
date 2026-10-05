"use client";

import { useRef, useState } from "react";
import {
  VALVE_EXPIRED_REASON,
  demoArchiveKind,
  demoLinkEndpoint,
  isPlainHttp,
  safeDemoUrl,
  valveReplayExpired,
  type DemoLink,
} from "@/lib/demo/demoLink";

type State =
  | { kind: "idle" }
  | { kind: "finding" }
  | { kind: "started"; url: string; archive: string }
  | { kind: "unavailable"; reason: string; roomUrl?: string };

/**
 * DownloadDemoButton — the demo FILE for a match listed on a profile, next to
 * "Analyze demo". A click asks the server where the demo lives (it finds it the
 * same way analysis does) and then sends the browser straight to that host:
 * Valve's replay servers for Premier/matchmaking, FACEIT's storage for FACEIT.
 * The file never passes through our servers. When there is no demo to hand
 * over, the reason is shown in place.
 */
export function DownloadDemoButton({
  gameId,
  steamId,
  dataSource,
  finishedAt,
  score,
}: {
  gameId: string;
  steamId: string;
  dataSource: string;
  finishedAt: string;
  score?: number[];
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const busyRef = useRef(false);

  const isFaceit = dataSource === "faceit";

  const run = async () => {
    if (busyRef.current) return;
    setCopied(false);
    // Past Valve's month there is nothing to ask for.
    if (valveReplayExpired(dataSource, finishedAt)) {
      setState({ kind: "unavailable", reason: VALVE_EXPIRED_REASON });
      return;
    }
    busyRef.current = true;
    setState({ kind: "finding" });
    try {
      const res = await fetch(demoLinkEndpoint(steamId, gameId, { finishedAt, score }), {
        cache: "no-store",
      });
      if (res.status === 429) {
        setState({ kind: "unavailable", reason: "Too many demo requests — try again in a moment." });
        return;
      }
      if (!res.ok) {
        setState({ kind: "unavailable", reason: "Couldn't look this demo up right now — try again shortly." });
        return;
      }
      const link = (await res.json()) as DemoLink;
      const url = safeDemoUrl(link);
      if (!url) {
        setState({
          kind: "unavailable",
          reason: link.reason || "No demo is available for this game.",
          roomUrl: link.room_url,
        });
        return;
      }
      // Hand the browser the file's own address. A demo is served as a
      // download, so the page stays where it is.
      const a = document.createElement("a");
      a.href = url;
      a.rel = "noreferrer";
      if (link.filename) a.download = link.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setState({ kind: "started", url, archive: demoArchiveKind(link) });
    } catch {
      setState({ kind: "unavailable", reason: "Couldn't look this demo up right now — try again shortly." });
    } finally {
      busyRef.current = false;
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      window.prompt("Copy the demo link:", url);
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void run()}
        disabled={state.kind === "finding"}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs font-medium text-ink transition hover:border-brand/40 hover:text-brand disabled:cursor-wait disabled:opacity-70"
        title={
          isFaceit
            ? "Download this match's demo file straight from FACEIT (a compressed .dem.zst archive — unpack it before opening it in CS2)"
            : "Download this match's demo file straight from Valve. Valve demos are .dem.bz2 archives — unpack with 7-Zip or similar before opening in CS2. Valve keeps them for about a month."
        }
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5M4 20h16" />
        </svg>
        {state.kind === "finding" ? "Finding demo…" : "Download demo"}
      </button>
      {state.kind === "started" && (
        <span role="status" className="text-xs text-muted">
          Download started ({state.archive}).
          {isPlainHttp(state.url) ? (
            <>
              {" "}
              Blocked by your browser? Valve serves demos over plain http —{" "}
              <button
                type="button"
                onClick={() => void copy(state.url)}
                className="text-brand hover:underline"
              >
                {copied ? "link copied" : "copy the link"}
              </button>{" "}
              and paste it into a new tab.
            </>
          ) : null}
        </span>
      )}
      {state.kind === "unavailable" && (
        <span role="status" className="text-xs text-faint">
          {state.reason}
          {state.roomUrl ? (
            <>
              {" "}
              <a href={state.roomUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                Open the FACEIT match room ↗
              </a>
            </>
          ) : null}
        </span>
      )}
    </span>
  );
}
