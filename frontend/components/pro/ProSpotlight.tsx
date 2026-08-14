"use client";

import { useMemo, useState } from "react";
import { usePoll } from "./usePoll";
import { SpotlightRail, type RailCard } from "./SpotlightRail";
import { PlayerAvatar } from "./PlayerAvatar";
import { TeamCrest } from "./TeamCrest";

// Three rails: the world's top 20 teams, their players, and FACEIT's
// leaderboard. Every one of them is somebody's published ranking — none is a
// number we invented.
//
// The teams rail is Counter-Strike's OFFICIAL Regional Standings, the ranking
// Valve uses to decide Major invitations. It replaced an earlier "who is on
// the board" ordering that surfaced qualifier sides, because how often a team
// appears in the matches we happen to track says nothing about how good they
// are. Player rosters come from the same standings.

const POLL_MS = 120_000; // rosters and leaderboards move slowly

// FACEIT's own region codes. Kept in step with the allowlist in
// backend/internal/faceit/rankings.go — an unlisted code is refused there
// rather than being passed through to their API.
const REGIONS = [
  { code: "EU", label: "Europe" },
  { code: "NA", label: "N. America" },
  { code: "SA", label: "S. America" },
  { code: "AS", label: "Asia" },
  { code: "OCE", label: "Oceania" },
] as const;

interface SpotlightTeam {
  standing: number;
  points: number;
  name: string;
  /** Present only for orgs we have seen play — our team page is keyed by it. */
  gridId?: string;
  logoUrl?: string;
  color?: string;
  roster?: string[];
  live?: boolean;
  asOf?: string;
}
interface SpotlightPlayer {
  nick: string;
  teamName?: string;
  teamRank?: number;
  teamGridId?: string;
  color?: string;
  live?: boolean;
}
interface FaceitRanked {
  playerId?: string;
  nickname: string;
  country?: string;
  position?: number;
  elo?: number;
  skillLevel?: number;
  avatar?: string;
  faceitUrl?: string;
}
interface SpotlightResponse {
  enabled: boolean;
  teams: SpotlightTeam[];
  players: SpotlightPlayer[];
  faceit: FaceitRanked[];
  faceitRegion?: string;
  updatedAt?: string;
}

// FACEIT's own level colours, so a level 10 reads as a level 10.
function levelHex(lvl?: number): string {
  if (!lvl || lvl < 1) return "var(--brand, #6ad0ff)";
  if (lvl >= 10) return "#e8332e";
  if (lvl >= 8) return "#ff7a18";
  if (lvl >= 5) return "#ffc220";
  if (lvl >= 2) return "#36cf4a";
  return "#dfe5ec";
}


// The ranking sits at the top of the page and the players rail lower down, so
// they are separate components. Both read the same endpoint; it is cached for
// a minute at the proxy, so the second poll is a conditional round trip rather
// than duplicated work at the backend.
function useSpotlight() {
  return usePoll<SpotlightResponse>("/api/pro-matches/spotlight", POLL_MS);
}

export function ProSpotlight() {
  const { data, loading } = useSpotlight();

  const { teams } = useMemo(() => {
    const teams: RailCard[] = (data?.teams ?? []).map((t) => ({
      id: String(t.standing),
      name: t.name,
      // Only orgs we have actually tracked have a stats page to open. The rest
      // still render — a top-20 side we have never seen play is a real fact,
      // and a dead link would be worse than a card that waits.
      href: t.gridId
        ? `/pro-matches/team/${encodeURIComponent(t.gridId)}`
        : undefined,
      // GRID only has a logo for orgs we have tracked; TeamCrest falls back to
      // Liquipedia in the browser so the top 20 all carry their crest.
      media: (
        <TeamCrest name={t.name} logoUrl={t.logoUrl} hex={t.color || "#6ad0ff"} />
      ),
      accent: t.color || undefined,
      rank: t.standing,
      subtitle: t.live ? "Live now" : t.roster?.slice(0, 2).join(", "),
      stats: [{ label: "Points", value: t.points.toLocaleString("en-US") }],
      // Valve's points run to roughly 2000 at the top; the segment meter is a
      // read of this team against the leader, not an absolute scale.
      meter: undefined,
    }));

    return { teams };
  }, [data]);

  if (data && data.enabled === false) return null;
  if (data && !teams.length) return null;

  return (
    <>
      {(loading || teams.length > 0) && (
        <SpotlightRail
          title="Top 20 teams"
          subtitle={
            data?.teams?.[0]?.asOf
              ? `Valve Regional Standings · as of ${data.teams[0].asOf}`
              : "Counter-Strike's official Regional Standings"
          }
          cards={teams}
          loading={loading && !data}
          emptyNote="The standings are unavailable right now."
        />
      )}
    </>
  );
}

// The same top-20 rosters, rendered further down where there is room for a
// second wall of cards without pushing the live scores off the fold.
export function PlayersRail() {
  const { data, loading } = useSpotlight();

  const players: RailCard[] = useMemo(
    () =>
      (data?.players ?? []).map((p) => ({
        id: `${p.teamName ?? ""}-${p.nick}`,
        name: p.nick,
        // These cards exist to put faces to the top 20, so a click goes to the
        // team they play for rather than to the player. A team we have never
        // seen in a tracked series has no GRID id and therefore no overview
        // page — the card stays unclickable rather than leading nowhere.
        href: p.teamGridId
          ? `/pro-matches/team/${encodeURIComponent(p.teamGridId)}`
          : undefined,
        accent: p.color || undefined,
        // No standing here. The rail above IS the ranking; repeating "#2" on a
        // player card only invited reading it as the player's own rank.
        subtitle: p.teamName,
        media: (
          <PlayerAvatar nick={p.nick} hex={p.color || "#6ad0ff"} shape="card" />
        ),
      })),
    [data],
  );

  if (data && !players.length) return null;
  return (
    <SpotlightRail
      title="Pro players"
      subtitle="Players of the top 20 teams · photos from Liquipedia (CC BY-SA)"
      cards={players}
      loading={loading && !data}
      emptyNote="No rosters available right now."
      speedSec={55}
    />
  );
}

// The FACEIT leaderboard, with its own region switcher and its own fetch:
// changing region must not re-run the GRID roster work behind the other two
// rails, which is why the endpoint takes ?only=faceit.
export function FaceitLeaderboardRail() {
  const [region, setRegion] = useState<string>("EU");
  const { data, loading } = usePoll<SpotlightResponse>(
    `/api/pro-matches/spotlight?only=faceit&region=${region}`,
    POLL_MS,
  );

  const faceit: RailCard[] = useMemo(
    () =>
      (data?.faceit ?? []).map((f) => ({
      id: f.playerId || f.nickname,
      name: f.nickname,
      href: f.faceitUrl,
      // FACEIT does not document an avatar on this collection; when it sends
      // one the card gets a face, and when it does not the rail falls back to
      // the initial tile rather than showing a broken image.
      imageUrl: f.avatar || undefined,
      accent: levelHex(f.skillLevel),
      rank: f.position,
      subtitle: f.country ? f.country.toUpperCase() : undefined,
      stats: [
        ...(f.elo ? [{ label: "Elo", value: f.elo.toLocaleString("en-US") }] : []),
        ...(f.skillLevel ? [{ label: "Level", value: String(f.skillLevel) }] : []),
      ],
      meter: f.skillLevel ? Math.min(1, f.skillLevel / 10) : undefined,
      })),
    [data],
  );

  const tabs = (
    <div className="scroll-slim -mb-1 flex gap-1 overflow-x-auto pb-1">
      {REGIONS.map((r) => {
        const on = r.code === region;
        return (
          <button
            key={r.code}
            type="button"
            aria-pressed={on}
            title={r.label}
            onClick={() => setRegion(r.code)}
            className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition ${
              on
                ? "border-brand/60 bg-brand/15 text-ink"
                : "border-line bg-panel text-muted hover:text-ink"
            }`}
          >
            {r.code}
          </button>
        );
      })}
    </div>
  );

  return (
    <SpotlightRail
      title="Top FACEIT players"
      subtitle="FACEIT's published leaderboard, by elo"
      cards={faceit}
      loading={loading && !data}
      emptyNote="FACEIT has no leaderboard for this region right now."
      speedSec={50}
      action={tabs}
    />
  );
}
