"use client";

import Link from "next/link";
import { memo, useMemo } from "react";
import type { MatchState } from "./types";
import type { SpotlightPlayer, SpotlightTeam } from "./ProSpotlight";
import { PlayerAvatar } from "./PlayerAvatar";
import { TeamCrest } from "./TeamCrest";
import { LiveBadge } from "./LiveBadge";
import { COLUMN_CLS, ColumnSkeleton } from "./BoardSections";
import {
  DetailHint,
  DetailLine,
  DetailPopover,
  useDetailAnchor,
  type RowBind,
} from "./DetailPopover";
import { teamContext } from "./boardDetail";

// The left column of the three-column board: the top 20 teams' lineups as a
// vertical list, grouped by team in standings order so the crest and the team
// colour appear once per lineup and the eye finds a team before a player.
// The standings carry every roster; the spotlight players (the handful the
// rail drifts across below xl, with their live/colour flags) merge in by nick.
//
// Three layers per player: the row is nick + photo + a live dot; hover or
// focus opens a panel with their team, standing, points and what the team is
// playing now or next; a click goes to the player's own profile. The team
// heading is the way to the team page.

const FALLBACK_HEX = "#6ad0ff";
const POP_ID = "pro-player-detail";

interface TeamGroup {
  name: string;
  rank?: number;
  points?: number;
  gridId?: string;
  color: string;
  logoUrl?: string;
  live: boolean;
  players: SpotlightPlayer[];
}

const nickKey = (n: string) => n.trim().toLowerCase();
const rowKey = (g: TeamGroup, p: SpotlightPlayer) => `${g.name}/${p.nick}`;

function groupByTeam(
  players: SpotlightPlayer[],
  teams: SpotlightTeam[],
): TeamGroup[] {
  const groups = new Map<string, TeamGroup>();
  for (const t of teams) {
    groups.set(t.name, {
      name: t.name,
      rank: t.standing,
      points: t.points,
      gridId: t.gridId,
      color: t.color || FALLBACK_HEX,
      logoUrl: t.logoUrl,
      live: !!t.live,
      players: (t.roster ?? []).map((nick) => ({
        nick,
        teamName: t.name,
        teamRank: t.standing,
        teamGridId: t.gridId,
        color: t.color,
      })),
    });
  }
  for (const p of players) {
    const key = p.teamName ?? "";
    let g = groups.get(key);
    if (!g) {
      g = {
        name: key || "Other",
        rank: p.teamRank,
        gridId: p.teamGridId,
        color: p.color || FALLBACK_HEX,
        live: false,
        players: [],
      };
      groups.set(key, g);
    }
    if (p.live) g.live = true;
    const i = g.players.findIndex((x) => nickKey(x.nick) === nickKey(p.nick));
    if (i >= 0) g.players[i] = { ...g.players[i], ...p };
    else g.players.push(p);
  }
  // Standings order; a lineup without a rank (should not happen) sinks.
  return [...groups.values()]
    .filter((g) => g.players.length > 0)
    .sort(
      (a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER),
    );
}

export const ProPlayersColumn = memo(function ProPlayersColumn({
  players,
  teams,
  live,
  upcoming,
  loading,
}: {
  players: SpotlightPlayer[];
  /** The standings: each lineup's roster, GRID crest and live flag. */
  teams: SpotlightTeam[];
  /** The board's live and scheduled series, for "playing now / next" on hover. */
  live: MatchState[];
  upcoming: MatchState[];
  loading: boolean;
}) {
  const groups = useMemo(() => groupByTeam(players, teams), [players, teams]);
  const { anchor, bind } = useDetailAnchor();
  const openRow = useMemo(() => {
    if (!anchor) return null;
    for (const g of groups) {
      for (const p of g.players) if (rowKey(g, p) === anchor.key) return { g, p };
    }
    return null;
  }, [anchor, groups]);

  return (
    <aside aria-labelledby="pro-players-title" className={COLUMN_CLS}>
      <div className="sticky top-0 z-10 border-b border-line/60 bg-panel px-3 pb-2 pt-3">
        <h2
          id="pro-players-title"
          className="text-sm font-semibold uppercase tracking-wider text-muted"
        >
          Pro players
        </h2>
        {/* The CC BY-SA line is Liquipedia's condition for the photos. */}
        <p className="mt-0.5 text-[11px] leading-snug text-faint">
          Rosters of the top 20 teams · photos from Liquipedia (CC BY-SA)
        </p>
      </div>

      {loading ? (
        <ColumnSkeleton />
      ) : groups.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted">
          No rosters available right now.
        </p>
      ) : (
        <ul role="list" className="space-y-3 p-2">
          {groups.map((g) => (
            <li key={g.name}>
              <TeamHeading group={g} />
              <ul role="list">
                {g.players.map((p) => {
                  const key = rowKey(g, p);
                  return (
                    <li key={p.nick}>
                      <PlayerRow
                        player={p}
                        group={g}
                        bind={bind(key)}
                        describedBy={anchor?.key === key ? POP_ID : undefined}
                      />
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {anchor && openRow ? (
        <DetailPopover key={anchor.key} id={POP_ID} anchor={anchor.rect} place="right" width={288}>
          <PlayerDetail player={openRow.p} group={openRow.g} live={live} upcoming={upcoming} />
        </DetailPopover>
      ) : null}
    </aside>
  );
});

// crest · name · #standing · LIVE — a link to the team page when we have one
function TeamHeading({ group: g }: { group: TeamGroup }) {
  const href = g.gridId ? `/pro-matches/team/${encodeURIComponent(g.gridId)}` : undefined;
  const cls =
    "flex items-center gap-2 border-l-2 py-0.5 pl-2 text-[11px] font-bold uppercase tracking-wider text-muted";
  const inner = (
    <>
      <span className="relative h-5 w-5 shrink-0 overflow-hidden rounded-md">
        <TeamCrest name={g.name} logoUrl={g.logoUrl} hex={g.color} compact />
      </span>
      <span className="min-w-0 flex-1 truncate">{g.name}</span>
      {g.rank != null && (
        <span className="shrink-0 text-[10px] font-semibold tabular-nums text-faint">
          #{g.rank}
        </span>
      )}
      {g.live && <LiveBadge />}
    </>
  );
  return (
    <h3 className="mb-1">
      {href ? (
        <Link
          href={href}
          title={`${g.name} — team page`}
          className={`${cls} rounded-r-md transition-colors hover:bg-panel2 hover:text-ink`}
          style={{ borderColor: g.color }}
        >
          {inner}
          <span className="sr-only">, team page</span>
        </Link>
      ) : (
        <span className={cls} style={{ borderColor: g.color }}>
          {inner}
        </span>
      )}
    </h3>
  );
}

function PlayerRow({
  player: p,
  group: g,
  bind,
  describedBy,
}: {
  player: SpotlightPlayer;
  group: TeamGroup;
  bind: RowBind;
  describedBy?: string;
}) {
  return (
    <Link
      href={`/pro-matches/player/${encodeURIComponent(p.nick)}`}
      aria-describedby={describedBy}
      className="flex items-center gap-2 rounded-lg px-2 py-1 text-[13px] font-semibold text-ink transition-colors hover:bg-panel2 focus-visible:bg-panel2"
      {...bind}
    >
      <PlayerAvatar nick={p.nick} hex={p.color || g.color} size={26} />
      <span className="min-w-0 flex-1 truncate">{p.nick}</span>
      {p.live && (
        <>
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#ff4655]" />
          <span className="sr-only">, playing now</span>
        </>
      )}
      <span className="sr-only">, {g.name}</span>
    </Link>
  );
}

// The hover/focus layer: who they play for, where that team stands, and what
// it is playing now or next — all from the standings and the match feed.
function PlayerDetail({
  player: p,
  group: g,
  live,
  upcoming,
}: {
  player: SpotlightPlayer;
  group: TeamGroup;
  live: MatchState[];
  upcoming: MatchState[];
}) {
  const ctx = teamContext(p.teamGridId ?? g.gridId, live, upcoming);
  const opp = ctx?.opponent ? ctx.opponent.shortName || ctx.opponent.name : "TBD";
  return (
    <>
      <div className="flex items-center gap-2.5">
        <PlayerAvatar nick={p.nick} hex={p.color || g.color} size={44} />
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold text-ink">{p.nick}</p>
          <p className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="relative h-3.5 w-3.5 shrink-0 overflow-hidden rounded">
              <TeamCrest name={g.name} logoUrl={g.logoUrl} hex={g.color} compact />
            </span>
            <span className="truncate">{g.name}</span>
          </p>
        </div>
      </div>
      <div className="mt-2 space-y-1">
        {g.rank != null ? (
          <DetailLine label="Standing">
            #{g.rank}
            {g.points != null ? ` · ${g.points.toLocaleString("en-US")} pts` : ""}
          </DetailLine>
        ) : null}
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
        Click for the player&apos;s profile · the team name above opens the team page.
      </DetailHint>
    </>
  );
}
