import type { PlayerMatchSummary } from "@/lib/types";
import { ratingColor } from "@/lib/format";

/**
 * RecentForm summarises a player's last few matches: a W/L guide (most recent
 * first) plus the average rating over that window.
 */
export function RecentForm({
  matches,
  window = 10,
}: {
  matches: PlayerMatchSummary[];
  window?: number;
}) {
  const recent = matches.slice(0, window);
  if (recent.length === 0) return null;

  const wins = recent.filter((m) => m.line.won).length;
  const losses = recent.length - wins;
  const avgRating =
    recent.reduce((s, m) => s + m.line.rating, 0) / recent.length;

  return (
    <div className="card flex flex-wrap items-center justify-between gap-4 px-5 py-4">
      <div>
        <div className="stat-label mb-1.5">
          Recent form · last {recent.length}
        </div>
        <div className="flex gap-1">
          {recent.map((m) => (
            <span
              key={m.match.id}
              title={`${m.line.won ? "Win" : "Loss"} · rating ${m.line.rating.toFixed(2)}`}
              className={`grid h-6 w-6 place-items-center rounded text-[10px] font-bold ${
                m.line.won
                  ? "bg-good/15 text-good"
                  : "bg-bad/15 text-bad"
              }`}
            >
              {m.line.won ? "W" : "L"}
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-6">
        <div className="text-right">
          <div className="stat-label">Record</div>
          <div className="text-lg font-semibold tabular-nums">
            <span className="text-good">{wins}</span>
            <span className="text-faint">–</span>
            <span className="text-bad">{losses}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="stat-label">Avg rating</div>
          <div
            className={`text-lg font-semibold tabular-nums ${ratingColor(avgRating)}`}
          >
            {avgRating.toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
}
