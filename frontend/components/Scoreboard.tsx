import Link from "next/link";
import type { MatchPlayer } from "@/lib/types";
import { ratingColor } from "@/lib/format";

function TeamTable({
  title,
  score,
  players,
  won,
}: {
  title: string;
  score: number;
  players: MatchPlayer[];
  won: boolean;
}) {
  const sorted = [...players].sort((a, b) => b.rating - a.rating);
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`h-3 w-3 rounded-sm ${won ? "bg-good" : "bg-bad"}`} />
          <span className="font-semibold">{title}</span>
        </div>
        <span className="text-2xl font-bold tabular-nums">{score}</span>
      </div>
      <div className="overflow-x-auto scroll-slim">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-faint">
              <th className="px-4 py-2 text-left font-medium">Player</th>
              <th className="px-2 py-2 text-right font-medium">K</th>
              <th className="px-2 py-2 text-right font-medium">D</th>
              <th className="px-2 py-2 text-right font-medium">A</th>
              <th className="px-2 py-2 text-right font-medium">ADR</th>
              <th className="px-2 py-2 text-right font-medium">KAST</th>
              <th className="px-2 py-2 text-right font-medium">HS%</th>
              <th className="px-2 py-2 text-right font-medium">OK</th>
              <th className="px-2 py-2 text-right font-medium">CL</th>
              <th className="px-4 py-2 text-right font-medium">Rating</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr
                key={p.steamId64}
                className="border-t border-line/60 hover:bg-panel2"
              >
                <td className="px-4 py-2">
                  <Link
                    href={`/profiles/${p.steamId64}`}
                    className="font-medium text-ink hover:text-brand"
                  >
                    {p.personaName || p.steamId64}
                  </Link>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{p.kills}</td>
                <td className="px-2 py-2 text-right tabular-nums text-muted">
                  {p.deaths}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-muted">
                  {p.assists}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {p.adr.toFixed(0)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {p.kastPct.toFixed(0)}%
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-muted">
                  {p.hsPct.toFixed(0)}%
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-muted">
                  {p.openingKills}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-muted">
                  {p.clutchesWon}
                </td>
                <td
                  className={`px-4 py-2 text-right font-semibold tabular-nums ${ratingColor(p.rating)}`}
                >
                  {p.rating.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Scoreboard({
  players,
  teamAScore,
  teamBScore,
}: {
  players: MatchPlayer[];
  teamAScore: number;
  teamBScore: number;
}) {
  const teamA = players.filter((p) => p.startSide === "T");
  const teamB = players.filter((p) => p.startSide !== "T");
  const aWon = teamAScore > teamBScore;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <TeamTable
        title="Team A — started T"
        score={teamAScore}
        players={teamA}
        won={aWon}
      />
      <TeamTable
        title="Team B — started CT"
        score={teamBScore}
        players={teamB}
        won={!aWon}
      />
    </div>
  );
}
