"use client";

import Link from "next/link";
import type { MatchState } from "./types";
import type { SpotlightTeam } from "./ProSpotlight";
import { TeamCrest } from "./TeamCrest";
import {
  LiveSection,
  UpcomingSection,
  ResultsSection,
  NoMatches,
  type EventGroup,
} from "./BoardSections";
import {
  DetailHint,
  DetailLine,
  DetailPopover,
  useDetailAnchor,
  type RowBind,
} from "./DetailPopover";
import { teamContext } from "./boardDetail";

/** Everything ProBoard has worked out from the matches feed, for either layout. */
export interface BoardModel {
  live: MatchState[];
  /** Every scheduled series, in start order (the groups below are these, by event). */
  upcoming: MatchState[];
  upcomingGroups: EventGroup[];
  shownGroups: EventGroup[];
  activeEvent: string | null;
  upcomingTotal: number;
  finished: MatchState[];
  now: number;
  onPickEvent: (label: string | null) => void;
}

// The middle column of the three-column board. Top to bottom: the standings
// as a one-line strip of crests (the ranking frames everything under it, and
// at this size it costs ~70px), live series as full cards, the schedule by
// event, then recent results — most urgent first, each section quieter than
// the one above. The live grid reads the COLUMN's width (@container), not the
// viewport's: two cards side by side once the column is 48rem wide.
export function MatchesColumn({
  teams,
  teamsLoading,
  board,
}: {
  teams: SpotlightTeam[];
  teamsLoading: boolean;
  board: BoardModel;
}) {
  const {
    live,
    upcoming,
    upcomingGroups,
    shownGroups,
    activeEvent,
    upcomingTotal,
    finished,
    now,
    onPickEvent,
  } = board;
  const empty =
    live.length === 0 && upcomingGroups.length === 0 && finished.length === 0;

  return (
    <div className="min-w-0 space-y-6">
      {/* The strip sits outside the container: its detail panel is fixed to
          the viewport, and a container's containment would catch it. */}
      <TopTeamsStrip teams={teams} loading={teamsLoading} live={live} upcoming={upcoming} />

      <div className="@container space-y-6">
        {live.length > 0 && (
          <LiveSection live={live} gridClass="grid gap-3 @3xl:grid-cols-2" />
        )}

        {upcomingGroups.length > 0 && (
          <UpcomingSection
            groups={upcomingGroups}
            shown={shownGroups}
            active={activeEvent}
            total={upcomingTotal}
            onPick={onPickEvent}
            standings={teams}
          />
        )}

        {finished.length > 0 && (
          <ResultsSection finished={finished} now={now} standings={teams} />
        )}

        {empty && <NoMatches />}
      </div>
    </div>
  );
}

const CHIP_POP = "team-chip-detail";

// Valve's Regional Standings as one scrollable line of crests: rank under
// each, name under that, a live dot on a crest whose team is playing. Hover
// or focus opens the team's panel; the padding inside the scroller keeps the
// first chip clear of the edge fade.
function TopTeamsStrip({
  teams,
  loading,
  live,
  upcoming,
}: {
  teams: SpotlightTeam[];
  loading: boolean;
  live: MatchState[];
  upcoming: MatchState[];
}) {
  const { anchor, bind } = useDetailAnchor();
  if (!loading && teams.length === 0) return null;
  const asOf = teams[0]?.asOf;
  const open = anchor ? teams.find((t) => String(t.standing) === anchor.key) : undefined;

  return (
    <section aria-labelledby="top-teams-title">
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h2
          id="top-teams-title"
          className="text-sm font-semibold uppercase tracking-wider text-muted"
        >
          Top 20 teams
        </h2>
        <p className="truncate text-xs text-faint">
          {asOf
            ? `Valve Regional Standings · as of ${asOf}`
            : "Counter-Strike's official Regional Standings"}
        </p>
      </div>

      {loading ? (
        <div aria-busy="true" className="flex gap-1 overflow-hidden px-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <span
              key={i}
              className="h-[68px] w-[72px] shrink-0 animate-pulse rounded-lg bg-line/50"
            />
          ))}
        </div>
      ) : (
        <div className="edge-fade-x">
          <ol role="list" className="scroll-slim flex gap-1 overflow-x-auto px-3 pb-1.5">
            {teams.map((t) => {
              const key = String(t.standing);
              return (
                <li key={key} className="shrink-0">
                  <TeamChip
                    team={t}
                    bind={bind(key)}
                    describedBy={anchor?.key === key ? CHIP_POP : undefined}
                  />
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {anchor && open ? (
        <DetailPopover key={anchor.key} id={CHIP_POP} anchor={anchor.rect} place="under" width={300}>
          <TeamDetail team={open} live={live} upcoming={upcoming} />
        </DetailPopover>
      ) : null}
    </section>
  );
}

function TeamChip({
  team: t,
  bind,
  describedBy,
}: {
  team: SpotlightTeam;
  bind: RowBind;
  describedBy?: string;
}) {
  const hex = t.color || "#6ad0ff";
  // Only orgs we have tracked have a page (same rule as the rail card).
  const href = t.gridId
    ? `/pro-matches/team/${encodeURIComponent(t.gridId)}`
    : undefined;
  const cls =
    "flex w-[72px] flex-col items-center gap-1 rounded-lg px-1 py-1.5 transition-colors hover:bg-panel2/70 focus-visible:bg-panel2/70";

  const body = (
    <>
      <span
        className="relative h-8 w-8 overflow-hidden rounded-lg"
        style={{ boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${hex} 45%, transparent)` }}
      >
        <TeamCrest name={t.name} logoUrl={t.logoUrl} hex={hex} compact />
        {t.live && (
          <span
            aria-hidden
            className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-[#ff4655] ring-2 ring-bg"
          />
        )}
      </span>
      <span className="text-[10px] font-bold leading-none tabular-nums text-muted">
        #{t.standing}
      </span>
      <span className="w-full truncate text-center text-[10px] leading-none text-faint">
        {t.name}
      </span>
      {t.live && <span className="sr-only">, live now</span>}
    </>
  );

  if (!href) {
    return (
      <span className={cls} {...bind}>
        {body}
      </span>
    );
  }
  return (
    <Link href={href} aria-describedby={describedBy} className={cls} {...bind}>
      {body}
      <span className="sr-only">, team page</span>
    </Link>
  );
}

// The hover/focus layer of a chip: the standing in full, the roster, and
// what the team is playing now or next.
function TeamDetail({
  team: t,
  live,
  upcoming,
}: {
  team: SpotlightTeam;
  live: MatchState[];
  upcoming: MatchState[];
}) {
  const hex = t.color || "#6ad0ff";
  const ctx = teamContext(t.gridId, live, upcoming);
  const opp = ctx?.opponent ? ctx.opponent.shortName || ctx.opponent.name : "TBD";
  return (
    <>
      <div className="flex items-center gap-2.5">
        <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg">
          <TeamCrest name={t.name} logoUrl={t.logoUrl} hex={hex} compact />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold text-ink">{t.name}</p>
          <p className="text-[11px] tabular-nums text-muted">
            #{t.standing} · {t.points.toLocaleString("en-US")} pts
            {t.asOf ? ` · as of ${t.asOf}` : ""}
          </p>
        </div>
      </div>
      <div className="mt-2 space-y-1">
        {t.roster?.length ? <DetailLine label="Roster">{t.roster.join(", ")}</DetailLine> : null}
        {ctx ? (
          <>
            <DetailLine label={ctx.kind === "live" ? "Live now" : "Next match"}>
              vs {opp} · {ctx.line}
            </DetailLine>
            {ctx.match.tournamentName ? (
              <DetailLine label="Event">{ctx.match.tournamentName}</DetailLine>
            ) : null}
          </>
        ) : (
          <DetailLine label="Schedule">Nothing in the feed</DetailLine>
        )}
      </div>
      <DetailHint>
        {t.gridId
          ? "Click for the team page — roster stats, results and form."
          : "No team page yet: this org has not played a series we track."}
      </DetailHint>
    </>
  );
}
