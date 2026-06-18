import type { Metadata } from "next";
import { ApiError, getMatch, getMatchKills } from "@/lib/api";
import { Scoreboard } from "@/components/Scoreboard";
import { RoundTimeline } from "@/components/RoundTimeline";
import { Killfeed } from "@/components/Killfeed";
import { FetchError } from "@/components/FetchError";
import { BackButton } from "@/components/BackButton";
import { mapLabel, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const { match } = await getMatch(id);
    return {
      title: `${mapLabel(match.map)} ${match.teamAScore}-${match.teamBScore} — CS2 Tracker`,
    };
  } catch {
    return { title: "Match — CS2 Tracker" };
  }
}

export default async function MatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let detail;
  let kills;
  try {
    [detail, kills] = await Promise.all([
      getMatch(id),
      getMatchKills(id).catch(() => []),
    ]);
  } catch (e) {
    if (e instanceof ApiError) {
      return <FetchError status={e.status} message={e.message} />;
    }
    throw e;
  }

  const { match, players, rounds } = detail;
  const mins = Math.round(match.durationSeconds / 60);

  const names = new Map(players.map((p) => [p.steamId64, p.personaName]));
  const nameOf = (sid: string) => names.get(sid) || sid || "—";

  return (
    <div className="space-y-5">
      <BackButton />

      <section className="card-2 flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div>
          <h1 className="text-2xl font-bold capitalize">{mapLabel(match.map)}</h1>
          <div className="mt-1 text-sm text-muted">
            {match.gameMode || match.demoSource} · {match.roundsTotal} rounds ·{" "}
            {mins}m · {timeAgo(match.playedAt)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold tabular-nums">
            {match.teamAScore}
            <span className="mx-1 text-faint">:</span>
            {match.teamBScore}
          </div>
          <div className="stat-label mt-0.5">Final score</div>
        </div>
      </section>

      <RoundTimeline rounds={rounds} />

      <Scoreboard
        players={players}
        teamAScore={match.teamAScore}
        teamBScore={match.teamBScore}
      />

      <Killfeed kills={kills} nameOf={nameOf} />
    </div>
  );
}
