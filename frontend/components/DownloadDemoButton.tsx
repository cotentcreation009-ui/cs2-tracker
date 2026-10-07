"use client";

import { useRef, useState } from "react";
import {
  VALVE_EXPIRED_REASON,
  demoArchiveKind,
  demoFileEndpoint,
  demoLinkEndpoint,
  safeDemoUrl,
  valveReplayExpired,
  type DemoLink,
} from "@/lib/demo/demoLink";

type State =
  | { kind: "idle" }
  | { kind: "finding" }
  | { kind: "started"; archive: string }
  | { kind: "unavailable"; reason: string; roomUrl?: string };

/**
 * DownloadDemoButton — the demo FILE for a match listed on a profile, next to
 * "Analyze demo". A click asks the server where the demo lives (it finds it the
 * same way analysis does) and, once there is one, downloads it through our own
 * https origin. That hop exists because Valve hosts replays over plain http and
 * Chrome refuses every download an https page starts towards an http host — a
 * same-tab link, a tab opened by script, a redirect through our origin; only
 * an address pasted into a fresh tab escaped, which is no button. Streamed
 * over https by us, it is an ordinary download. FACEIT demos are https already
 * and the same route just redirects to them. When there is no demo to hand
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
  const busyRef = useRef(false);

  const isFaceit = dataSource === "faceit";

  const run = async () => {
    if (busyRef.current) return;
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
      if (!safeDemoUrl(link)) {
        setState({
          kind: "unavailable",
          reason: link.reason || "No demo is available for this game.",
          roomUrl: link.room_url,
        });
        return;
      }
      // The simplest thing: a same-tab link to our own file route, which
      // answers with the bytes as an attachment. The browser downloads and the
      // page stays put. `download` names the file for the (same-origin) Valve
      // stream; a FACEIT redirect is cross-origin, so there the name is the
      // signed link's own.
      const a = document.createElement("a");
      a.href = demoFileEndpoint(steamId, gameId, { finishedAt, score });
      a.download = link.filename || "";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setState({ kind: "started", archive: demoArchiveKind(link) });
    } catch {
      setState({ kind: "unavailable", reason: "Couldn't look this demo up right now — try again shortly." });
    } finally {
      busyRef.current = false;
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
            : "Download this match's demo file from Valve. Valve demos are .dem.bz2 archives — unpack with 7-Zip or similar before opening in CS2. Valve keeps them for about a month."
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
