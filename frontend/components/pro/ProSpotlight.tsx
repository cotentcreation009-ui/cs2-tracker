"use client";

import { useMemo } from "react";
import { usePoll } from "./usePoll";
import { SpotlightRail, type RailCard } from "./SpotlightRail";
import { PlayerAvatar } from "./PlayerAvatar";

// Three rails above the board: the teams and players currently on it, and
// FACEIT's leaderboard.
//
// The labels are deliberate. Only the FACEIT rail is a RANKING — that list is
// published by FACEIT and we show it as-is. HLTV publishes no API and blocks
// server-side reads, so a "world top 20" here would be a number we invented.
// What we can say truthfully is who is playing in the matches we track, so
// that is what the first two rails say.

const POLL_MS = 120_000; // rosters and leaderboards move slowly

interface SpotlightTeam {
  id: string;
  name: string;
  logoUrl?: string;
  color?: string;
  matches: number;
  live?: boolean;
  nextAt?: string;
  tournament?: string;
}
interface SpotlightPlayer {
  id: string;
  nick: string;
  teamId?: string;
  teamName?: string;
  teamLogo?: string;
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

function startsIn(iso?: string): string | undefined {
  if (!iso) return undefined;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return undefined;
  const mins = Math.round((t - Date.now()) / 60000);
  if (mins < 0) return undefined;
  if (mins < 60) return `in ${mins}m`;
  const h = Math.round(mins / 60);
  if (h < 48) return `in ${h}h`;
  return `in ${Math.round(h / 24)}d`;
}

export function ProSpotlight() {
  const { data, loading } = usePoll<SpotlightResponse>(
    "/api/pro-matches/spotlight",
    POLL_MS,
  );

  const { teams, players, faceit } = useMemo(() => {
    const teams: RailCard[] = (data?.teams ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      href: `/pro-matches/team/${encodeURIComponent(t.id)}`,
      imageUrl: t.logoUrl,
      accent: t.color || undefined,
      subtitle: t.live
        ? "Live now"
        : t.tournament || startsIn(t.nextAt) || undefined,
      stats: [
        { label: "Tracked", value: String(t.matches) },
        ...(t.live ? [] : startsIn(t.nextAt) ? [{ label: "Next", value: startsIn(t.nextAt)! }] : []),
      ],
    }));

    const players: RailCard[] = (data?.players ?? []).map((p) => ({
      id: p.id || p.nick,
      name: p.nick,
      // HLTV has no API and no stable per-player URL we can derive, so a
      // search link is the honest way to send someone there: it always
      // resolves, and it never fabricates a profile id.
      href: `https://www.hltv.org/search?query=${encodeURIComponent(p.nick)}`,
      accent: p.color || undefined,
      subtitle: p.teamName,
      // The photo comes from Liquipedia, resolved in the visitor's browser
      // (their servers rate-limit ours), with a silhouette when there is none.
      media: (
        <PlayerAvatar nick={p.nick} hex={p.color || "#6ad0ff"} shape="card" />
      ),
    }));

    const faceit: RailCard[] = (data?.faceit ?? []).map((f) => ({
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
    }));

    return { teams, players, faceit };
  }, [data]);

  // Nothing configured and nothing to show: stay out of the way entirely
  // rather than stacking three empty headings above the board.
  if (data && data.enabled === false) return null;
  if (data && !teams.length && !players.length && !faceit.length) return null;

  return (
    <div className="space-y-6">
      {(loading || teams.length > 0) && (
        <SpotlightRail
          title="Teams on the board"
          subtitle="Ordered by how much of the tracked calendar they occupy — live teams first"
          cards={teams}
          loading={loading && !data}
          emptyNote="No tracked teams right now."
        />
      )}

      {(loading || players.length > 0) && (
        <SpotlightRail
          title="Players in action"
          subtitle="Rostered players from the teams above · photos from Liquipedia (CC BY-SA)"
          cards={players}
          loading={loading && !data}
          emptyNote="No rosters available right now."
          speedSec={55}
        />
      )}

      {(loading || faceit.length > 0) && (
        <SpotlightRail
          title={`Top FACEIT players${data?.faceitRegion ? ` · ${data.faceitRegion}` : ""}`}
          subtitle="FACEIT's published leaderboard, by elo"
          cards={faceit}
          loading={loading && !data}
          emptyNote="FACEIT's leaderboard is unavailable right now."
          speedSec={50}
        />
      )}
    </div>
  );
}
