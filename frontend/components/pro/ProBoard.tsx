"use client";

import { useMemo } from "react";
import type { MatchState, ProMatchesResponse } from "./types";
import { usePoll, useNow } from "./usePoll";
import { agoShort, dayGroup, startInfo } from "./format";
import { LiveMatchCard } from "./LiveMatchCard";
import { UpcomingRow } from "./UpcomingRow";

const POLL_MS = 10_000;

export function ProBoard() {
  const { data, error, loading } = usePoll<ProMatchesResponse>(
    "/api/pro-matches",
    POLL_MS,
  );
  const now = useNow(1000);

  const { live, upcomingGroups } = useMemo(() => {
    const matches = data?.matches ?? [];
    const live = matches.filter((m) => m.status === "live");
    const upcoming = matches
      .filter((m) => m.status === "upcoming")
      .sort(
        (x, y) =>
          new Date(x.startScheduled ?? 0).getTime() -
          new Date(y.startScheduled ?? 0).getTime(),
      );
    // group upcoming by Today / Tomorrow / weekday-date, preserving time order
    const groups: { label: string; items: MatchState[] }[] = [];
    for (const m of upcoming) {
      const { date } = startInfo(m.startScheduled);
      const label = date ? dayGroup(date) : "Scheduled";
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(m);
      else groups.push({ label, items: [m] });
    }
    return { live, upcomingGroups: groups };
  }, [data]);

  return (
    <div className="space-y-8">
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
          {live.length > 0 && (
            <section className="space-y-3">
              <SectionHeading label="Live now" count={live.length} live />
              <div className="grid gap-4 lg:grid-cols-2">
                {live.map((m) => (
                  <LiveMatchCard key={m.seriesId} match={m} />
                ))}
              </div>
            </section>
          )}

          {upcomingGroups.length > 0 && (
            <section className="space-y-3">
              <SectionHeading label="Upcoming" />
              <div className="space-y-5">
                {upcomingGroups.map((g) => (
                  <div key={g.label} className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">
                      {g.label}
                    </div>
                    <div className="space-y-2">
                      {g.items.map((m) => (
                        <UpcomingRow key={m.seriesId} match={m} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {live.length === 0 && upcomingGroups.length === 0 && <NoMatches />}
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
        <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
          <span className="gradient-text">Pro Matches</span>
        </h1>
        <p className="mt-1 text-sm text-muted">
          Live &amp; upcoming Counter-Strike 2 pro matches — scores update
          automatically.
        </p>
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
