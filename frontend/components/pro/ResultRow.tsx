"use client";

import Link from "next/link";
import type { MatchState } from "./types";
import { TeamLogo } from "./TeamLogo";
import { MatchDetails } from "./MatchDetails";
import { TwitchLink } from "./TwitchLink";
import { formatTag, validHex } from "./format";
import { endedAgo, mapsLine, seriesResult } from "./boardView";

// Finished-series row for the board's Results view: the winner reads at a
// glance (bold + bright score, loser dimmed), the event and format, when it
// ended, and a footer with every map's score, the "Maps & scoreboard" expander
// (the same per-map table and final scoreboard a live card opens) and the VOD
// pill when the feed has a stream link. Mirrors UpcomingRow's shape so the
// board scans as one list.
//
// The link to the result page is a stretched overlay rather than a wrapping
// <Link>: the expander is a button and the VOD pill an anchor, and either
// nested inside an <a> is invalid HTML that trips hydration.
export function ResultRow({
  match,
  now,
  describedBy,
  expanded = false,
  onToggle,
}: {
  match: MatchState;
  now: number;
  /** id of the row's hover/focus detail panel while it is open (BoardSections). */
  describedBy?: string;
  /** Whether the per-map table is open; the list owns it so one row at a time expands. */
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const { a, b, sa, sb, winner } = seriesResult(match);
  const aWon = !!winner && winner === a;
  const bWon = !!winner && winner === b;
  const aColor = validHex(a?.colorPrimary) ?? "#38d6ff";
  const bColor = validHex(b?.colorPrimary) ?? "#8a7dff";
  const aName = a?.shortName || a?.name || "?";
  const bName = b?.shortName || b?.name || "?";
  const tag = formatTag(match);
  const ended = endedAgo(match, now);
  const maps = mapsLine(match);
  const hasMaps = (match.maps ?? []).length > 0;
  const detailsId = `result-details-${match.seriesId}`;
  const footer = !!maps || hasMaps || !!match.streamUrl;

  return (
    <div
      className="group relative overflow-hidden rounded-xl border border-line bg-panel2/25 transition duration-150 hover:-translate-y-px hover:border-line2 hover:bg-panel2/50"
      data-winner={winner ? (aWon ? "a" : "b") : undefined}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1 opacity-70"
        style={{ backgroundImage: `linear-gradient(${aColor}, ${bColor})` }}
      />

      <div className="flex items-center gap-3 py-2.5 pl-4 pr-3 sm:gap-4">
        {/* when it ended */}
        <div className="w-18 shrink-0 sm:w-21">
          <div className="truncate text-xs font-semibold text-faint">Finished</div>
          <div className="truncate text-[11px] tabular-nums text-faint">{ended}</div>
        </div>

        {/* teams + final score */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <TeamLogo name={aName} src={a?.logoUrl} color={a?.colorPrimary} size={34} />
          <span className={`truncate text-sm sm:text-[15px] ${aWon ? "font-bold text-ink" : "font-medium text-faint"}`}>
            {aName}
          </span>
          <span className="shrink-0 text-sm font-extrabold tabular-nums sm:text-base">
            <span className={aWon ? "text-ink" : "text-faint"}>{sa}</span>
            <span className="mx-1 text-xs font-normal text-faint">–</span>
            <span className={bWon ? "text-ink" : "text-faint"}>{sb}</span>
          </span>
          <span className={`truncate text-sm sm:text-[15px] ${bWon ? "font-bold text-ink" : "font-medium text-faint"}`}>
            {bName}
          </span>
          <TeamLogo name={bName} src={b?.logoUrl} color={b?.colorPrimary} size={34} />
          {winner ? (
            <span className="sr-only">
              {winner.shortName || winner.name} won {sa}–{sb}
            </span>
          ) : null}
        </div>

        {/* tournament */}
        <div className="hidden min-w-0 max-w-[36%] items-center gap-1.5 sm:flex">
          {match.tournamentLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={match.tournamentLogoUrl} alt="" loading="lazy" className="h-4 w-4 shrink-0 rounded object-contain opacity-80" />
          ) : null}
          <span className="truncate text-xs text-muted">{match.tournamentName}</span>
        </div>

        {tag ? <span className="pill shrink-0 border-line text-[10px] text-muted">{tag}</span> : null}
      </div>

      {/* footer: the maps as played, the expander, the VOD */}
      {footer ? (
        <div className="relative flex items-center justify-between gap-2 border-t border-line/40 py-1.5 pl-4 pr-3">
          <span className="min-w-0 flex-1 truncate text-[11px] tabular-nums text-muted" title={maps || undefined}>
            {maps}
          </span>
          <span className="relative z-10 flex shrink-0 items-center gap-1.5">
            {hasMaps && onToggle ? (
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={detailsId}
                onClick={onToggle}
                className="pill border-line text-[10px] font-semibold text-muted transition-colors hover:border-brand/50 hover:text-ink"
              >
                Maps &amp; scoreboard
                <svg
                  aria-hidden
                  viewBox="0 0 20 20"
                  className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="m5 8 5 5 5-5" />
                </svg>
              </button>
            ) : null}
            {match.streamUrl ? <TwitchLink url={match.streamUrl} finished /> : null}
          </span>
        </div>
      ) : null}

      {expanded && hasMaps ? (
        <div className="px-3 pb-3">
          <MatchDetails match={match} id={detailsId} />
        </div>
      ) : null}

      <Link
        href={`/pro-matches/${match.seriesId}`}
        aria-label={`${aName} ${sa}–${sb} ${bName} — full result`}
        aria-describedby={describedBy}
        className="absolute inset-0 rounded-xl"
      />
    </div>
  );
}
