"use client";

import { Fragment, type ReactNode } from "react";
import type { MatchState, ProTeam } from "./types";
import type { SpotlightTeam } from "./ProSpotlight";
import { LiveMatchCard } from "./LiveMatchCard";
import { UpcomingRow } from "./UpcomingRow";
import { ResultRow } from "./ResultRow";
import { DetailHint, DetailLine, DetailPopover, useDetailAnchor } from "./DetailPopover";
import { endedAgo, prettyFormat, streamHost, whenLabel } from "./boardDetail";

// The board's sections and their furniture, shared by both arrangements of
// the page: the single stacked column below xl and the three-column board
// from xl up (see ProBoard). One implementation, so a live card or a result
// row reads the same whichever layout the viewport gets.
//
// Every row has three layers: at rest the two to four numbers that decide it,
// on hover or focus a panel with the rest of what the feed knows about it,
// on click the page that has everything.

export type EventGroup = { label: string; logo?: string; items: MatchState[] };

/**
 * The sidebar shell of the three-column board: a panel pinned under the site
 * header, capped at the viewport and scrolling its own overflow, so a list of
 * a hundred players never drags the page. The offset is the header's height
 * (~59px) plus a gap; the cap leaves the same gap at the bottom.
 */
export const COLUMN_CLS =
  "card sticky top-[4.5rem] max-h-[calc(100dvh-5.5rem)] overflow-y-auto overscroll-y-contain scroll-slim";

export function SectionHeading({
  label,
  count,
  live = false,
}: {
  label: string;
  count?: number;
  live?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      {live ? (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#ff4655] opacity-75 motion-reduce:hidden" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#ff4655]" />
        </span>
      ) : null}
      <h2 className="text-sm font-bold uppercase tracking-wider text-ink">
        {label}
      </h2>
      {count != null && count > 0 ? (
        <span className="rounded-full bg-panel px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted">
          {count}
        </span>
      ) : null}
    </div>
  );
}

// Event picker for the upcoming section: one tap narrows the schedule to a
// single tournament, tapping the live chip again (or "All events") widens back.
export function EventFilter({
  groups,
  total,
  active,
  onPick,
}: {
  groups: EventGroup[];
  total: number;
  active: string | null;
  onPick: (label: string | null) => void;
}) {
  const base =
    "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors";
  const on = "border-brand bg-brand/15 font-bold text-ink";
  const off =
    "border-line bg-panel/70 font-medium text-muted hover:border-line2 hover:text-ink";
  const badge = "rounded-full px-1.5 text-[10px] font-semibold tabular-nums";

  return (
    <div
      role="group"
      aria-label="Filter upcoming matches by event"
      className="scroll-slim flex items-center gap-2 overflow-x-auto pb-1"
    >
      <button
        type="button"
        onClick={() => onPick(null)}
        aria-pressed={active === null}
        className={`${base} ${active === null ? on : off}`}
      >
        All events
        <span className={`${badge} ${active === null ? "bg-brand/20 text-brand" : "bg-bg/50 text-faint"}`}>
          {total}
        </span>
      </button>
      {groups.map((g) => {
        const picked = active === g.label;
        return (
          <button
            key={g.label}
            type="button"
            onClick={() => onPick(g.label)}
            aria-pressed={picked}
            title={g.label}
            className={`${base} ${picked ? on : off}`}
          >
            {g.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={g.logo} alt="" loading="lazy" className="h-4 w-4 shrink-0 rounded object-contain" />
            ) : null}
            <span className="max-w-56 truncate">{g.label}</span>
            <span className={`${badge} ${picked ? "bg-brand/20 text-brand" : "bg-bg/50 text-faint"}`}>
              {g.items.length}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Live series as full cards. `gridClass` is the caller's: the stacked page
// counts columns by viewport, the three-column board by its own width. The
// cards announce their own score changes (see LiveMatchCard).
export function LiveSection({
  live,
  gridClass,
}: {
  live: MatchState[];
  gridClass: string;
}) {
  return (
    <section className="space-y-2">
      <SectionHeading label="Live now" count={live.length} live />
      <ul role="list" className={gridClass}>
        {live.map((m) => (
          <li key={m.seriesId} className="min-w-0">
            <LiveMatchCard match={m} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const UPCOMING_POP = "upcoming-detail";
const RESULT_POP = "result-detail";

function standingOf(standings: SpotlightTeam[] | undefined, t?: ProTeam) {
  if (!t || !standings) return undefined;
  return standings.find((s) => s.gridId === t.gridId);
}

// "Vitality #5 · FaZe #10" for the teams the standings rank; nothing for the rest.
function StandingLine({
  standings,
  a,
  b,
}: {
  standings?: SpotlightTeam[];
  a?: ProTeam;
  b?: ProTeam;
}) {
  const sa = standingOf(standings, a);
  const sb = standingOf(standings, b);
  if (!sa && !sb) return null;
  const parts = [
    sa && a ? `${a.shortName || a.name} #${sa.standing}` : "",
    sb && b ? `${b.shortName || b.name} #${sb.standing}` : "",
  ].filter(Boolean);
  return <DetailLine label="Standing">{parts.join(" · ")}</DetailLine>;
}

function UpcomingDetail({ match: m, standings }: { match: MatchState; standings?: SpotlightTeam[] }) {
  const a = m.teams?.[0];
  const b = m.teams?.[1];
  return (
    <>
      <p className="text-sm font-extrabold leading-snug text-ink">
        {a?.name || "TBD"} <span className="font-medium text-faint">vs</span> {b?.name || "TBD"}
      </p>
      <div className="mt-2 space-y-1">
        <DetailLine label="Starts">{whenLabel(m.startScheduled)}</DetailLine>
        <DetailLine label="Format">{prettyFormat(m)}</DetailLine>
        {m.tournamentName ? <DetailLine label="Event">{m.tournamentName}</DetailLine> : null}
        <StandingLine standings={standings} a={a} b={b} />
        <DetailLine label="Stream">{m.streamUrl ? streamHost(m.streamUrl) : "Not listed yet"}</DetailLine>
      </div>
      <DetailHint>Click for the match page — live scores and the round-by-round once it starts.</DetailHint>
    </>
  );
}

function ResultDetail({
  match: m,
  now,
  standings,
}: {
  match: MatchState;
  now: number;
  standings?: SpotlightTeam[];
}) {
  const a = m.teams?.[0];
  const b = m.teams?.[1];
  const sa = m.seriesScore?.[a?.gridId ?? ""] ?? 0;
  const sb = m.seriesScore?.[b?.gridId ?? ""] ?? 0;
  const winner = sa > sb ? a : sb > sa ? b : undefined;
  const maps = (m.maps ?? []).filter((x) => x.started || x.finished);
  return (
    <>
      <p className="text-sm font-extrabold leading-snug text-ink">
        {a?.name || "?"} <span className="tabular-nums">{sa}–{sb}</span> {b?.name || "?"}
      </p>
      <div className="mt-2 space-y-1">
        <DetailLine label="Winner">{winner?.name || "Not decided"}</DetailLine>
        {maps.map((x) => (
          <DetailLine key={x.sequence} label={x.mapName || `Map ${x.sequence}`}>
            {x.scoreByTeam?.[a?.gridId ?? ""] ?? 0}–{x.scoreByTeam?.[b?.gridId ?? ""] ?? 0}
          </DetailLine>
        ))}
        {maps.length === 0 ? <DetailLine label="Maps">Per-map scores not in the feed</DetailLine> : null}
        <DetailLine label="Ended">{endedAgo(m, now) || "Time not listed"}</DetailLine>
        <DetailLine label="Format">{prettyFormat(m)}</DetailLine>
        {m.tournamentName ? <DetailLine label="Event">{m.tournamentName}</DetailLine> : null}
        <StandingLine standings={standings} a={a} b={b} />
      </div>
      <DetailHint>Click for the full result.</DetailHint>
    </>
  );
}

// The schedule, grouped by event, with the event filter once there is a
// choice to make.
export function UpcomingSection({
  groups,
  shown,
  active,
  total,
  onPick,
  afterFirst,
  standings,
}: {
  groups: EventGroup[];
  shown: EventGroup[];
  active: string | null;
  total: number;
  onPick: (label: string | null) => void;
  /** Rendered after the first event group (the stacked page parks the rails there). */
  afterFirst?: ReactNode;
  /** The top-20 standings, for the detail panel's "Standing" line. */
  standings?: SpotlightTeam[];
}) {
  const { anchor, bind } = useDetailAnchor();
  return (
    <section className="space-y-3">
      <SectionHeading label={active ?? "Upcoming · by event"} />
      {/* one event = nothing to choose between, so the row stays hidden */}
      {groups.length > 1 && (
        <EventFilter groups={groups} total={total} active={active} onPick={onPick} />
      )}
      <div className="space-y-6">
        {shown.map((g, gi) => (
          <Fragment key={g.label}>
            <div className="space-y-2">
              <div className="flex items-center gap-2 border-b border-line/50 pb-1.5">
                {g.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={g.logo} alt="" loading="lazy" className="h-5 w-5 shrink-0 rounded object-contain" />
                ) : (
                  <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand/70" />
                )}
                <h3 className="truncate text-xs font-bold uppercase tracking-wider text-muted">
                  {g.label}
                </h3>
                <span className="shrink-0 rounded-full bg-panel px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-faint">
                  {g.items.length}
                </span>
              </div>
              <ul role="list" className="space-y-2">
                {g.items.map((m) => {
                  const open = anchor?.key === m.seriesId;
                  return (
                    <li key={m.seriesId} className="relative" {...bind(m.seriesId)}>
                      <UpcomingRow match={m} describedBy={open ? UPCOMING_POP : undefined} />
                      {open && anchor ? (
                        <DetailPopover id={UPCOMING_POP} anchor={anchor.rect} place="inline" width={320}>
                          <UpcomingDetail match={m} standings={standings} />
                        </DetailPopover>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
            {gi === 0 && afterFirst}
          </Fragment>
        ))}
      </div>
    </section>
  );
}

export function ResultsSection({
  finished,
  now,
  standings,
}: {
  finished: MatchState[];
  now: number;
  standings?: SpotlightTeam[];
}) {
  const { anchor, bind } = useDetailAnchor();
  return (
    <section className="space-y-3">
      <SectionHeading label="Recent results" count={finished.length} />
      <ul role="list" className="space-y-2">
        {finished.map((m) => {
          const open = anchor?.key === m.seriesId;
          return (
            <li key={m.seriesId} className="relative" {...bind(m.seriesId)}>
              <ResultRow match={m} now={now} describedBy={open ? RESULT_POP : undefined} />
              {open && anchor ? (
                <DetailPopover id={RESULT_POP} anchor={anchor.rect} place="inline" width={320}>
                  <ResultDetail match={m} now={now} standings={standings} />
                </DetailPopover>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function StateCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="card-2 flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="text-base font-semibold text-ink">{title}</p>
      <p className="max-w-md text-sm text-muted">{body}</p>
    </div>
  );
}

export function NoMatches() {
  return (
    <StateCard
      title="No live pro matches right now"
      body="Nothing is live at the moment and there's nothing on the schedule in the next few days. Check back at match time — the board updates on its own."
    />
  );
}

// Placeholder rows for a sidebar list that has not arrived yet.
export function ColumnSkeleton({ rows = 12 }: { rows?: number }) {
  const bar = "animate-pulse rounded bg-line/50";
  return (
    <div aria-busy="true" className="space-y-2.5 p-3">
      {Array.from({ length: rows }).map((_, i) => (
        <span key={i} className="flex items-center gap-2">
          <span className={`h-6 w-6 shrink-0 rounded-full ${bar}`} />
          <span className={`h-3 ${bar}`} style={{ width: `${44 + ((i * 37) % 40)}%` }} />
        </span>
      ))}
    </div>
  );
}
