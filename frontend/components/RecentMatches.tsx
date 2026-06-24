import Link from "next/link";
import type { PlayerMatchSummary } from "@/lib/types";
import { mapLabel, ratingColor, timeAgo } from "@/lib/format";

export function RecentMatches({ matches }: { matches: PlayerMatchSummary[] }) {
  if (matches.length === 0) {
    return (
      <div className="card px-5 py-8 text-center text-sm text-muted">
        No recent matches available for this player.
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-[1.4fr_0.7fr_1fr_0.7fr_0.7fr_0.7fr] gap-2 border-b border-line px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-faint">
        <span>Map</span>
        <span className="text-center">Result</span>
        <span className="text-center">K / D / A</span>
        <span className="text-right">ADR</span>
        <span className="text-right">KAST</span>
        <span className="text-right">Rating</span>
      </div>
      <ul>
        {matches.map(({ match, line }) => {
          const won = line.won;
          return (
            <li key={match.id}>
              <Link
                href={`/matches/${match.id}`}
                className="grid grid-cols-[1.4fr_0.7fr_1fr_0.7fr_0.7fr_0.7fr] items-center gap-2 px-4 py-3 transition hover:bg-panel2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-7 w-1 rounded-full ${won ? "bg-good" : "bg-bad"}`}
                    />
                    <div className="min-w-0">
                      <div className="truncate font-medium capitalize">
                        {mapLabel(match.map)}
                      </div>
                      <div className="text-xs text-faint">
                        {timeAgo(match.playedAt)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="text-center">
                  <span
                    className={`pill ${won ? "bg-good/15 text-good" : "bg-bad/15 text-bad"}`}
                  >
                    {match.teamAScore}:{match.teamBScore}
                  </span>
                </div>

                <div className="text-center tabular-nums text-sm">
                  <span className="text-ink">{line.kills}</span>
                  <span className="text-faint"> / </span>
                  <span className="text-ink">{line.deaths}</span>
                  <span className="text-faint"> / </span>
                  <span className="text-ink">{line.assists}</span>
                </div>

                <div className="text-right tabular-nums text-sm text-muted">
                  {line.adr.toFixed(0)}
                </div>
                <div className="text-right tabular-nums text-sm text-muted">
                  {line.kastPct.toFixed(0)}%
                </div>
                <div
                  className={`text-right text-sm font-semibold tabular-nums ${ratingColor(line.rating)}`}
                >
                  {line.rating.toFixed(2)}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
