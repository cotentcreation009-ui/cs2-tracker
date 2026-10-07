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
    // Valve serves demos over plain http. From this https page a same-tab link
    // click is a mixed-content download, which Chrome blocks outright; the same
    // address pasted into a new tab downloads fine, because a top-level
    // navigation is not mixed content. So the file is opened the way a paste
    // is: in its own tab. The tab is opened NOW, inside the click's user
    // activation (the lookup below can outlast the ~5 s activation window and a
    // tab opened after that is a popup to be blocked), and pointed at the file
    // once the address is known; a tab whose navigation turns into a download
    // closes itself. If nothing is downloadable it is closed here.
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    try {
      const res = await fetch(demoLinkEndpoint(steamId, gameId, { finishedAt, score }), {
        cache: "no-store",
      });
      if (res.status === 429) {
        tab?.close();
        setState({ kind: "unavailable", reason: "Too many demo requests — try again in a moment." });
        return;
      }
      if (!res.ok) {
        tab?.close();
        setState({ kind: "unavailable", reason: "Couldn't look this demo up right now — try again shortly." });
        return;
      }
      const link = (await res.json()) as DemoLink;
      const url = safeDemoUrl(link);
      if (!url) {
        tab?.close();
        setState({
          kind: "unavailable",
          reason: link.reason || "No demo is available for this game.",
          roomUrl: link.room_url,
        });
        return;
      }
      // Hand the file's own address to the tab opened on the click. Chrome turns
      // the navigation into a download and closes the tab; the page stays put.
      // With no tab (a popup blocker still said no), fall back to the link
      // element, which some browsers allow, and the copy-the-link fallback
      // below covers the rest.
      if (tab) {
        tab.location.href = url;
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setState({ kind: "started", url, archive: demoArchiveKind(link) });
    } catch {
      tab?.close();
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
              Nothing happened? Valve serves demos over plain http —{" "}
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
