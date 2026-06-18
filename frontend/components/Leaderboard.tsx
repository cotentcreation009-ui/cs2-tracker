import Link from "next/link";
import type { LeaderboardEntry } from "@/lib/types";
import { ratingColor } from "@/lib/format";

export function Leaderboard({ players }: { players: LeaderboardEntry[] }) {
  if (players.length === 0) return null;

  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-[2rem_1fr_0.6fr_0.6fr_0.7fr] gap-2 border-b border-line px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-faint">
        <span>#</span>
        <span>Player</span>
        <span className="text-right">M</span>
        <span className="text-right">K/D</span>
        <span className="text-right">Rating</span>
      </div>
      <ul>
        {players.map((p, i) => (
          <li key={p.steamId64}>
            <Link
              href={`/profiles/${p.steamId64}`}
              className="grid grid-cols-[2rem_1fr_0.6fr_0.6fr_0.7fr] items-center gap-2 px-4 py-2.5 transition hover:bg-panel2"
            >
              <span className="text-sm font-semibold tabular-nums text-faint">
                {i + 1}
              </span>
              <div className="flex min-w-0 items-center gap-2.5">
                {p.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.avatarUrl}
                    alt=""
                    className="h-7 w-7 rounded border border-line object-cover"
                  />
                ) : (
                  <span className="h-7 w-7 rounded border border-line bg-panel2" />
                )}
                <span className="truncate text-sm font-medium">
                  {p.personaName || p.steamId64}
                </span>
              </div>
              <span className="text-right text-sm tabular-nums text-muted">
                {p.matches}
              </span>
              <span className="text-right text-sm tabular-nums text-muted">
                {p.kd.toFixed(2)}
              </span>
              <span
                className={`text-right text-sm font-semibold tabular-nums ${ratingColor(p.rating)}`}
              >
                {p.rating.toFixed(2)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
