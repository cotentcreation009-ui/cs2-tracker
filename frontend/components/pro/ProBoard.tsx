"use client";

import { useMemo, useState } from "react";
import type { ProMatchesResponse } from "./types";
import { usePoll, useNow } from "./usePoll";
import { useMediaQuery } from "./useMediaQuery";
import { agoShort } from "./format";
import {
  ProSpotlight,
  PlayersRail,
  FaceitLeaderboardRail,
  useSpotlight,
} from "./ProSpotlight";
import {
  LiveSection,
  UpcomingSection,
  ResultsSection,
  ResultsLink,
  BoardViewSwitch,
  NoMatches,
  StateCard,
  type EventGroup,
} from "./BoardSections";
import { ProPlayersColumn } from "./ProPlayersColumn";
import { FaceitColumn } from "./FaceitColumn";
import { MatchesColumn, type BoardModel } from "./MatchesColumn";
import { rankEventGroups, type EventOrder } from "./eventRank";
import { sortFinished } from "./boardView";
import { useBoardView } from "./useBoardView";

const POLL_MS = 10_000;

// Tailwind's xl breakpoint. Below it the board is the single stacked column
// with the drifting rails; from here up it is three columns — pro players on
// the left, the matches in the middle, FACEIT's leaderboard on the right.
// Decided in JS rather than with hidden/visible duplicates so only one copy
// of every list, link, photo and poll exists at a time.
const WIDE_QUERY = "(min-width: 80rem)";

export function ProBoard() {
  // include=finished: recently finished series (kept 48h server-side, see
  // boardView.ts) power the Results view — the one poll carries both views,
  // so switching costs no request and results are as fresh as the scores.
  const { data, error, loading } = usePoll<ProMatchesResponse>(
    "/api/pro-matches?include=finished",
    POLL_MS,
  );
  const now = useNow(1000);
  const wide = useMediaQuery(WIDE_QUERY);
  // "board" (live + upcoming, the default) or "results"; kept in ?view=
  const [view, setView] = useBoardView();
  // event filter for the upcoming section — the label, not an index, because
  // the feed re-groups every poll
  const [pickedEvent, setPickedEvent] = useState<string | null>(null);
  // events ranked by the top-20 teams playing in them, or by start time
  const [eventOrder, setEventOrder] = useState<EventOrder>("top");
  // One spotlight poll for the whole board: it ranks the schedule here and
  // feeds the players column and the standings strip from xl up.
  const spotlight = useSpotlight();
  const standings = spotlight.data?.enabled === false ? undefined : spotlight.data?.teams;

  const { live, upcoming, upcomingGroups, finished } = useMemo(() => {
    const matches = data?.matches ?? [];
    const live = matches.filter((m) => m.status === "live");
    // every finished series in the feed's window, newest first — the Results
    // view folds the long tail itself, so nothing is cut here
    const finished = sortFinished(matches);
    const upcoming = matches
      .filter((m) => m.status === "upcoming")
      .sort(
        (x, y) =>
          new Date(x.startScheduled ?? 0).getTime() -
          new Date(y.startScheduled ?? 0).getTime(),
      );
    // group upcoming by EVENT; events ordered by their earliest match,
    // matches inside each event stay in time order
    const byEvent = new Map<string, EventGroup>();
    for (const m of upcoming) {
      const label = m.tournamentName || "Other matches";
      const g = byEvent.get(label);
      if (g) {
        g.items.push(m);
        if (!g.logo && m.tournamentLogoUrl) g.logo = m.tournamentLogoUrl;
      } else {
        byEvent.set(label, { label, logo: m.tournamentLogoUrl, items: [m] });
      }
    }
    return { live, upcoming, upcomingGroups: [...byEvent.values()], finished };
  }, [data]);

  // Resolve the pick against the CURRENT groups every render: once an event's
  // last match starts or finishes it leaves the upcoming feed, and a stale pick
  // would otherwise filter the section down to nothing. Absent label = show all.
  const rankedGroups = useMemo(
    () => rankEventGroups(upcomingGroups, standings, eventOrder),
    [upcomingGroups, standings, eventOrder],
  );
  const activeEvent =
    pickedEvent && rankedGroups.some((g) => g.label === pickedEvent) ? pickedEvent : null;
  const shownGroups = activeEvent
    ? rankedGroups.filter((g) => g.label === activeEvent)
    : rankedGroups;
  const upcomingTotal = rankedGroups.reduce((n, g) => n + g.items.length, 0);

  const board: BoardModel = {
    live,
    upcoming,
    upcomingGroups: rankedGroups,
    shownGroups,
    activeEvent,
    upcomingTotal,
    eventOrder,
    onOrder: setEventOrder,
    standings,
    finished,
    now,
    onPickEvent: (label) => setPickedEvent(label),
    view,
    onView: setView,
  };

  return (
    // .pro-board: globals.css widens <main> to the header's width for this
    // page from xl up, where the three columns need the room.
    <div className="pro-board space-y-5">
      <Header
        updatedAt={data?.updatedAt}
        now={now}
        stale={!!error && !!data}
      />

      {loading && !data ? (
        <BoardSkeleton />
      ) : data && data.enabled === false ? (
        <ComingSoon />
      ) : error && !data ? (
        <StateCard
          title="Can't load pro matches right now"
          body="We couldn't reach the live match feed. It'll retry automatically — check back in a moment."
        />
      ) : wide ? (
        <WideBoard board={board} spotlight={spotlight} />
      ) : (
        <StackedBoard board={board} />
      )}
    </div>
  );
}

// Below xl: one column. The ranking sits directly under the title — it is the
// thing that frames everything below it, and it reads as a strip rather than
// a section — then, on the board, live and the schedule (with the players and
// FACEIT rails after its first event, so they are met while scrolling rather
// than under it) and one line to the results; on the Results view, the
// results with the rails after them.
function StackedBoard({ board }: { board: BoardModel }) {
  const {
    live,
    upcomingGroups,
    shownGroups,
    activeEvent,
    upcomingTotal,
    eventOrder,
    onOrder,
    standings,
    finished,
    now,
    onPickEvent,
    view,
    onView,
  } = board;
  const rails = (
    <div className="space-y-6 pt-2">
      <PlayersRail />
      <FaceitLeaderboardRail />
    </div>
  );
  const switcher = <BoardViewSwitch view={view} onView={onView} results={finished.length} />;

  if (view === "results") {
    return (
      <>
        <ProSpotlight />
        <ResultsSection finished={finished} now={now} standings={standings} aside={switcher} />
        {rails}
      </>
    );
  }

  return (
    <>
      <ProSpotlight />

      {live.length > 0 && (
        // Three across on a wide screen: the cards are half the height they
        // were, so two of them left the row looking empty.
        <LiveSection
          live={live}
          gridClass="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
          aside={switcher}
        />
      )}

      {upcomingGroups.length > 0 && (
        <UpcomingSection
          groups={upcomingGroups}
          shown={shownGroups}
          active={activeEvent}
          total={upcomingTotal}
          onPick={onPickEvent}
          order={eventOrder}
          onOrder={onOrder}
          standings={standings}
          afterFirst={rails}
          aside={live.length === 0 ? switcher : undefined}
        />
      )}

      {live.length === 0 && upcomingGroups.length === 0 ? (
        <>
          <div className="flex justify-end">{switcher}</div>
          <NoMatches />
        </>
      ) : (
        <ResultsLink count={finished.length} onView={onView} />
      )}
    </>
  );
}

// From xl up: pro players | matches | FACEIT leaderboard. The sidebars are
// pinned under the header and scroll on their own (see COLUMN_CLS); the
// middle column scrolls with the page. Narrower sidebars until 2xl so the
// matches keep room at 1280px.
function WideBoard({ board, spotlight }: { board: BoardModel; spotlight: ReturnType<typeof useSpotlight> }) {
  // The board's one spotlight poll feeds the players column and the standings
  // strip; the FACEIT column has its own (?only=faceit) so a region change is cheap.
  const { data, loading } = spotlight;
  const enabled = data?.enabled !== false;
  const teams = enabled ? (data?.teams ?? []) : [];
  const players = enabled ? (data?.players ?? []) : [];
  const spotlightLoading = loading && !data;

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[240px_minmax(0,1fr)_260px] 2xl:grid-cols-[260px_minmax(0,1fr)_280px]">
      <ProPlayersColumn
        players={players}
        teams={teams}
        live={board.live}
        upcoming={board.upcoming}
        loading={spotlightLoading}
        photos={enabled ? data?.photos : undefined}
      />
      <MatchesColumn teams={teams} teamsLoading={spotlightLoading} board={board} />
      <FaceitColumn />
    </div>
  );
}

function Header({
  updatedAt,
  now,
  stale,
}: {
  updatedAt?: string;
  now: number;
  stale: boolean;
}) {
  const fresh = agoShort(updatedAt, now);
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        {/* Title only. The strapline explained what a page full of live scores
            was already saying, and cost a line of height above the fold. */}
        <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">
          <span className="gradient-text">Pro Matches</span>
        </h1>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-faint">
        <span
          className={`h-1.5 w-1.5 rounded-full ${stale ? "bg-mid" : "bg-good"}`}
          aria-hidden
        />
        {stale
          ? "Reconnecting…"
          : fresh
            ? `Updated ${fresh}`
            : "Auto-refreshing"}
      </div>
    </div>
  );
}

function ComingSoon() {
  return (
    <div className="card-2 relative overflow-hidden px-6 py-16 text-center">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5 opacity-80"
        style={{
          backgroundImage: "linear-gradient(90deg, #38d6ff, #8a7dff)",
        }}
      />
      <p className="text-lg font-bold text-ink">Pro match tracker — coming soon</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">
        Live scores from top CS2 events land here soon: series scores, live round
        counts, round-by-round breakdowns and stream links, all updating in real
        time.
      </p>
    </div>
  );
}

function BoardSkeleton() {
  const bar = "animate-pulse rounded bg-line/50";
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading pro matches">
      <div className="space-y-3">
        <span className={`block h-4 w-28 ${bar}`} />
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="card-2 space-y-4 p-5">
              <div className="flex items-center justify-between">
                <span className={`h-3 w-32 ${bar}`} />
                <span className={`h-4 w-12 ${bar}`} />
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2.5">
                  <span className={`h-11 w-11 ${bar}`} />
                  <span className={`h-4 w-16 ${bar}`} />
                </span>
                <span className={`h-8 w-16 ${bar}`} />
                <span className="flex items-center gap-2.5">
                  <span className={`h-4 w-16 ${bar}`} />
                  <span className={`h-11 w-11 ${bar}`} />
                </span>
              </div>
              <span className={`block h-14 w-full ${bar}`} />
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <span className={`block h-4 w-24 ${bar}`} />
        {Array.from({ length: 3 }).map((_, i) => (
          <span key={i} className={`block h-14 w-full ${bar}`} />
        ))}
      </div>
    </div>
  );
}
