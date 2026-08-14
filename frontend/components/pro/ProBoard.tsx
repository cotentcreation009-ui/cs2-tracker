"use client";

import { Fragment, useMemo, useState } from "react";
import type { MatchState, ProMatchesResponse } from "./types";
import { usePoll, useNow } from "./usePoll";
import { agoShort } from "./format";
import { LiveMatchCard } from "./LiveMatchCard";
import { UpcomingRow } from "./UpcomingRow";
import { ResultRow } from "./ResultRow";
import { ProSpotlight, PlayersRail, FaceitLeaderboardRail } from "./ProSpotlight";

const POLL_MS = 10_000;

type EventGroup = { label: string; logo?: string; items: MatchState[] };

export function ProBoard() {
  // include=finished: recently finished series (kept ~48h server-side) power
  // the Recent results section — without it results simply vanish off the site
  const { data, error, loading } = usePoll<ProMatchesResponse>(
    "/api/pro-matches?include=finished",
    POLL_MS,
  );
  const now = useNow(1000);
  // event filter for the upcoming section — the label, not an index, because
  // the feed re-groups every poll
  const [pickedEvent, setPickedEvent] = useState<string | null>(null);

  const { live, upcomingGroups, finished } = useMemo(() => {
    const matches = data?.matches ?? [];
    const live = matches.filter((m) => m.status === "live");
    const finished = matches
      .filter((m) => m.status === "finished" && (m.teams?.length ?? 0) === 2)
      .sort(
        (x, y) =>
          new Date(y.liveUpdatedAt ?? y.startScheduled ?? 0).getTime() -
          new Date(x.liveUpdatedAt ?? x.startScheduled ?? 0).getTime(),
      )
      .slice(0, 12);
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
    return { live, upcomingGroups: [...byEvent.values()], finished };
  }, [data]);

  // Resolve the pick against the CURRENT groups every render: once an event's
  // last match starts or finishes it leaves the upcoming feed, and a stale pick
  // would otherwise filter the section down to nothing. Absent label = show all.
  const activeEvent =
    pickedEvent && upcomingGroups.some((g) => g.label === pickedEvent) ? pickedEvent : null;
  const shownGroups = activeEvent
    ? upcomingGroups.filter((g) => g.label === activeEvent)
    : upcomingGroups;
  const upcomingTotal = upcomingGroups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="space-y-5">
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
      ) : (
        <>
          {/* The ranking sits directly under the title — it is the thing that
              frames everything below it, and it reads as a strip rather than a
              section, so it costs little height. */}
          <ProSpotlight />

          {live.length > 0 && (
            <section className="space-y-2">
              <SectionHeading label="Live now" count={live.length} live />
              {/* Three across on a wide screen: the cards are half the height
                  they were, so two of them left the row looking empty. */}
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {live.map((m) => (
                  <LiveMatchCard key={m.seriesId} match={m} />
                ))}
              </div>
            </section>
          )}

          {upcomingGroups.length > 0 && (
            <section className="space-y-3">
              <SectionHeading label={activeEvent ?? "Upcoming · by event"} />
              {/* one event = nothing to choose between, so the row stays hidden */}
              {upcomingGroups.length > 1 && (
                <EventFilter
                  groups={upcomingGroups}
                  total={upcomingTotal}
                  active={activeEvent}
                  onPick={(label) =>
                    setPickedEvent((cur) => (cur === label ? null : label))
                  }
                />
              )}
              <div className="space-y-6">
                {shownGroups.map((g, gi) => (
                  <Fragment key={g.label}>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 border-b border-line/50 pb-1.5">
                      {g.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={g.logo} alt="" loading="lazy" className="h-5 w-5 shrink-0 rounded object-contain" />
                      ) : (
                        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand/70" />
                      )}
                      <span className="truncate text-xs font-bold uppercase tracking-wider text-muted">
                        {g.label}
                      </span>
                      <span className="shrink-0 rounded-full bg-panel px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-faint">
                        {g.items.length}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {g.items.map((m) => (
                        <UpcomingRow key={m.seriesId} match={m} />
                      ))}
                    </div>
                  </div>
                  {/* After the first event, so the rails are met while
                      scrolling the schedule rather than under it. */}
                  {gi === 0 && (
                    <div className="space-y-6 pt-2">
                      <PlayersRail />
                      <FaceitLeaderboardRail />
                    </div>
                  )}
                  </Fragment>
                ))}
              </div>
            </section>
          )}

          {finished.length > 0 && (
            <section className="space-y-3">
              <SectionHeading label="Recent results" count={finished.length} />
              <div className="space-y-2">
                {finished.map((m) => (
                  <ResultRow key={m.seriesId} match={m} now={now} />
                ))}
              </div>
            </section>
          )}

          {live.length === 0 && upcomingGroups.length === 0 && finished.length === 0 && <NoMatches />}
        </>
      )}
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

function SectionHeading({
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
function EventFilter({
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

function StateCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="card-2 flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="text-base font-semibold text-ink">{title}</p>
      <p className="max-w-md text-sm text-muted">{body}</p>
    </div>
  );
}

function NoMatches() {
  return (
    <StateCard
      title="No live pro matches right now"
      body="Nothing is live at the moment and there's nothing on the schedule in the next few days. Check back at match time — the board updates on its own."
    />
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
