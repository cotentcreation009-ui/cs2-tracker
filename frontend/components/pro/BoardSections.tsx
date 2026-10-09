"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import type { MatchState, ProTeam } from "./types";
import type { SpotlightTeam } from "./ProSpotlight";
import { LiveMatchCard } from "./LiveMatchCard";
import { UpcomingRow } from "./UpcomingRow";
import { TeamLogo } from "./TeamLogo";
import { ranksByGrid, type EventOrder, type RankedEventGroup } from "./eventRank";
import { ResultRow } from "./ResultRow";
import { DetailHint, DetailLine, DetailPopover, useDetailAnchor } from "./DetailPopover";
import { endedAgo, prettyFormat, streamHost, whenLabel } from "./boardDetail";
import { RESULTS_WINDOW_HOURS, seriesResult, type BoardView } from "./boardView";

// The board's sections and their furniture, shared by both arrangements of
// the page: the single stacked column below xl and the three-column board
// from xl up (see ProBoard). One implementation, so a live card or a result
// row reads the same whichever layout the viewport gets.
//
// Every row has three layers: at rest the two to four numbers that decide it,
// on hover or focus a panel with the rest of what the feed knows about it,
// on click the page that has everything.

export type { EventGroup } from "./eventRank";

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

// "Live & upcoming" or "Results": which list the matches column shows. It
// sits beside the first section's heading (live, else upcoming) on the
// board and beside the Results heading on the results list, so the way
// back is where the way in was. The results count is the whole window,
// so the reader knows what is behind the tab before opening it.
export function BoardViewSwitch({
  view,
  onView,
  results,
}: {
  view: BoardView;
  onView: (view: BoardView) => void;
  results: number;
}) {
  const button = (value: BoardView, label: string, count?: number) => (
    <button
      type="button"
      aria-pressed={view === value}
      onClick={() => onView(value)}
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
        view === value ? "bg-brand/15 text-ink" : "text-muted hover:text-ink"
      }`}
    >
      {label}
      {count != null && count > 0 ? (
        <span className="rounded-full bg-panel px-1.5 py-px text-[10px] tabular-nums text-muted">{count}</span>
      ) : null}
    </button>
  );
  return (
    <div
      role="group"
      aria-label="Show live and upcoming matches, or results"
      className="flex items-center rounded-full border border-line bg-panel/70 p-0.5"
    >
      {button("board", "Live & upcoming")}
      {button("results", "Results", results)}
    </div>
  );
}

// Live series as full cards. `gridClass` is the caller's: the stacked page
// counts columns by viewport, the three-column board by its own width. The
// cards announce their own score changes (see LiveMatchCard). `aside` is the
// view switch, when this is the board's first section.
export function LiveSection({
  live,
  gridClass,
  aside,
}: {
  live: MatchState[];
  gridClass: string;
  aside?: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <SectionHeading label="Live now" count={live.length} live />
        {aside}
      </div>
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
  const { a, b, sa, sb, winner } = seriesResult(m);
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

// The schedule, grouped by event. Events are RANKED by who plays in them
// (eventRank.ts): the best-placed top-20 team first, then the count of
// top-20 teams, then the start — or by start alone when the reader asks.
// The first few groups are open; the rest collapse behind one line, because
// the calendar is mostly qualifiers and a hundred rows of them buried the
// matches that matter. A group header names the event once; the rows under
// it do not repeat it, and a ranked team wears its standing beside its name.
export function UpcomingSection({
  groups,
  shown,
  active,
  total,
  onPick,
  order,
  onOrder,
  afterFirst,
  standings,
  collapsedAfter = 4,
  aside,
}: {
  groups: RankedEventGroup[];
  shown: RankedEventGroup[];
  active: string | null;
  total: number;
  onPick: (label: string | null) => void;
  order: EventOrder;
  onOrder: (order: EventOrder) => void;
  /** Rendered after the first event group (the stacked page parks the rails there). */
  afterFirst?: ReactNode;
  /** The top-20 standings: the rank pills on rows and the detail panel's "Standing" line. */
  standings?: SpotlightTeam[];
  /** How many event groups stay open before the rest fold behind one line. */
  collapsedAfter?: number;
  /** The view switch, when nothing is live and this is the board's first section. */
  aside?: ReactNode;
}) {
  const { anchor, bind } = useDetailAnchor();
  const [expanded, setExpanded] = useState(false);
  const ranks = useMemo(() => ranksByGrid(standings), [standings]);
  const visible = active || expanded ? shown : shown.slice(0, collapsedAfter);
  const folded = shown.slice(visible.length);
  const foldedMatches = folded.reduce((n, g) => n + g.items.length, 0);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <SectionHeading label={active ?? "Upcoming"} count={active ? undefined : total} />
        {groups.length > 1 || aside ? (
          <div className="flex flex-wrap items-center gap-2">
            {groups.length > 1 ? (
              <>
                <OrderToggle order={order} onOrder={onOrder} />
                <EventPicker groups={groups} total={total} active={active} onPick={onPick} />
              </>
            ) : null}
            {aside}
          </div>
        ) : null}
      </div>
      <div className="space-y-5">
        {visible.map((g, gi) => (
          <Fragment key={g.label}>
            <div className="space-y-2">
              <EventHeader group={g} />
              <ul role="list" className="space-y-2">
                {g.items.map((m) => {
                  const open = anchor?.key === m.seriesId;
                  return (
                    <li key={m.seriesId} className="relative" {...bind(m.seriesId)}>
                      <UpcomingRow
                        match={m}
                        ranks={ranks}
                        showEvent={false}
                        describedBy={open ? UPCOMING_POP : undefined}
                      />
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
      {folded.length > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="btn btn-ghost h-9 w-full text-xs"
        >
          Show {folded.length} more event{folded.length === 1 ? "" : "s"} · {foldedMatches} match{foldedMatches === 1 ? "" : "es"}
        </button>
      ) : expanded && !active && shown.length > collapsedAfter ? (
        <button type="button" onClick={() => setExpanded(false)} className="btn btn-ghost h-9 w-full text-xs">
          Show fewer events
        </button>
      ) : null}
    </section>
  );
}

// "Top teams first" or "Soonest first": the one choice the schedule offers.
function OrderToggle({ order, onOrder }: { order: EventOrder; onOrder: (order: EventOrder) => void }) {
  const button = (value: EventOrder, label: string) => (
    <button
      type="button"
      aria-pressed={order === value}
      onClick={() => onOrder(value)}
      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
        order === value ? "bg-brand/15 text-ink" : "text-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="Order events" className="flex items-center rounded-full border border-line bg-panel/70 p-0.5">
      {button("top", "Top teams first")}
      {button("soon", "Soonest first")}
    </div>
  );
}

// One event, or all of them: a select instead of a row of chips that scrolled
// off the screen — the same choice, no clutter, keyboard-friendly.
function EventPicker({
  groups,
  total,
  active,
  onPick,
}: {
  groups: RankedEventGroup[];
  total: number;
  active: string | null;
  onPick: (label: string | null) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">Show one event</span>
      <select
        value={active ?? ""}
        onChange={(e) => onPick(e.target.value || null)}
        className="max-w-72 rounded-full border border-line bg-panel/70 px-3 py-1.5 text-xs font-medium text-ink"
      >
        <option value="">All events · {total}</option>
        {groups.map((g) => (
          <option key={g.label} value={g.label}>
            {g.label} · {g.items.length}
            {g.best !== Infinity ? ` · top team #${g.best}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

// The event's line: its name once, how many matches, which of the top 20 are
// in it (crest + standing, best first), and when it starts.
function EventHeader({ group: g }: { group: RankedEventGroup }) {
  const from = g.soonest === Infinity ? "" : whenLabel(new Date(g.soonest).toISOString());
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line/50 pb-1.5">
      <div className="flex min-w-0 items-center gap-2">
        {g.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={g.logo} alt="" loading="lazy" className="h-5 w-5 shrink-0 rounded object-contain" />
        ) : (
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand/70" />
        )}
        <h3 className="truncate text-xs font-bold uppercase tracking-wider text-muted">{g.label}</h3>
        <span className="shrink-0 rounded-full bg-panel px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-faint">
          {g.items.length}
        </span>
      </div>
      {g.ranked.length > 0 ? (
        <div
          className="flex items-center gap-1.5"
          title={g.ranked.map((t) => `#${t.standing} ${t.name}`).join(", ")}
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-brand">Top 20</span>
          {g.ranked.slice(0, 4).map((t) => (
            <span
              key={t.gridId}
              className="flex items-center gap-1 rounded-full bg-panel px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-ink"
            >
              <TeamLogo name={t.name} src={t.logoUrl} color={t.color} size={14} />#{t.standing}
            </span>
          ))}
          {g.ranked.length > 4 ? <span className="text-[10px] text-faint">+{g.ranked.length - 4}</span> : null}
        </div>
      ) : null}
      {from ? <span className="ml-auto shrink-0 text-[11px] tabular-nums text-faint">from {from}</span> : null}
    </div>
  );
}

// The Results view: every series the feed still has, newest first — the
// backend keeps a finished series for RESULTS_WINDOW_HOURS, and the heading
// says so, because "recent" would otherwise mean whatever the reader guessed.
// The first page of rows is open, the rest fold behind one line (a busy
// weekend is a hundred qualifier series). One row at a time expands its
// per-map table; the hover panel stays off that row, since the table it would
// describe is already open under it.
export function ResultsSection({
  finished,
  now,
  standings,
  aside,
  pageSize = 20,
}: {
  finished: MatchState[];
  now: number;
  standings?: SpotlightTeam[];
  /** The view switch, so the way back to the board sits where the way in was. */
  aside?: ReactNode;
  /** How many rows show before the rest fold behind one line. */
  pageSize?: number;
}) {
  const { anchor, bind } = useDetailAnchor();
  const [showAll, setShowAll] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const visible = showAll ? finished : finished.slice(0, pageSize);
  const folded = finished.length - visible.length;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <SectionHeading label="Results" count={finished.length} />
          <p className="text-xs text-faint">Last {RESULTS_WINDOW_HOURS} hours · newest first</p>
        </div>
        {aside}
      </div>
      {finished.length === 0 ? (
        <StateCard
          title={`No finished matches in the last ${RESULTS_WINDOW_HOURS} hours`}
          body="Results land here as series end and stay for two days. The live and upcoming board is one click away."
        />
      ) : (
        <ul role="list" className="space-y-2">
          {visible.map((m) => {
            const expanded = expandedId === m.seriesId;
            const open = !expanded && anchor?.key === m.seriesId;
            return (
              <li key={m.seriesId} className="relative" {...bind(m.seriesId)}>
                <ResultRow
                  match={m}
                  now={now}
                  describedBy={open ? RESULT_POP : undefined}
                  expanded={expanded}
                  onToggle={() => setExpandedId(expanded ? null : m.seriesId)}
                />
                {open && anchor ? (
                  <DetailPopover id={RESULT_POP} anchor={anchor.rect} place="inline" width={320}>
                    <ResultDetail match={m} now={now} standings={standings} />
                  </DetailPopover>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {folded > 0 ? (
        <button type="button" onClick={() => setShowAll(true)} className="btn btn-ghost h-9 w-full text-xs">
          Show {folded} more result{folded === 1 ? "" : "s"}
        </button>
      ) : showAll && finished.length > pageSize ? (
        <button type="button" onClick={() => setShowAll(false)} className="btn btn-ghost h-9 w-full text-xs">
          Show fewer results
        </button>
      ) : null}
    </section>
  );
}

// The board's one line about results, at its foot: a reader who scrolled the
// whole schedule looking for a score finds the way to it here.
export function ResultsLink({ count, onView }: { count: number; onView: (view: BoardView) => void }) {
  if (count === 0) return null;
  return (
    <button type="button" onClick={() => onView("results")} className="btn btn-ghost h-9 w-full text-xs">
      See {count} result{count === 1 ? "" : "s"} from the last {RESULTS_WINDOW_HOURS} hours
    </button>
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
