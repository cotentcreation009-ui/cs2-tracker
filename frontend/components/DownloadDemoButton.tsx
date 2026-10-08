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
  | { kind: "paste"; url: string; archive: string }
  | { kind: "unavailable"; reason: string; roomUrl?: string };

/**
 * DownloadDemoButton — the demo FILE for a match listed on a profile, next to
 * "Analyze demo". A click asks the server where the demo lives (it finds it the
 * same way analysis does). A FACEIT demo (https) is handed straight to the
 * browser; a Valve demo (plain http, which Chrome will not let an https page
 * start) is put on the clipboard with the two keystrokes that fetch it. The
 * file never passes through our servers. When there is no demo to hand over,
 * the reason is shown in place.
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
      const archive = demoArchiveKind(link);
      if (isPlainHttp(url)) {
        // Valve serves demos over plain http. Chrome refuses every download an
        // https page STARTS towards an http address — a same-tab link, a new
        // tab opened by script, a redirect through our own origin — because it
        // judges the download by who initiated it. The one thing it allows is
        // an address the visitor types or pastes themselves, which has no
        // initiator. So the link is put on the clipboard (still inside the
        // click's activation window for a lookup this quick) and the visitor
        // is told the two keystrokes; the file never crosses our servers.
        let copiedNow = false;
        try {
          await navigator.clipboard.writeText(url);
          copiedNow = true;
        } catch {
          copiedNow = false;
        }
        setCopied(copiedNow);
        setState({ kind: "paste", url, archive });
        return;
      }
      // An https address (FACEIT's signed download) can be handed straight to
      // the browser; the page stays where it is.
      const a = document.createElement("a");
      a.href = url;
      a.rel = "noreferrer";
      if (link.filename) a.download = link.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setState({ kind: "started", url, archive });
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
        </span>
      )}
      {state.kind === "paste" && (
        <span role="status" className="text-xs text-muted">
          {copied ? "Link copied." : "Copy the link:"}{" "}
          <button
            type="button"
            onClick={() => void copy(state.url)}
            className="text-brand hover:underline"
            title={state.url}
          >
            {copied ? "copy again" : "copy the link"}
          </button>
          {" "}
          Open a new tab, paste it and press Enter — Chrome only lets Valve&apos;s plain-http demo ({state.archive}) download from an address you paste yourself.
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
