import type { MapStat } from "@/lib/types";
import { mapLabel, ratingColor, tierColor } from "@/lib/format";

export function MapStats({ maps }: { maps: MapStat[] }) {
  if (maps.length === 0) return null;

  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-[1.4fr_0.8fr_0.8fr_0.7fr_0.7fr] gap-2 border-b border-line px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-faint">
        <span>Map</span>
        <span className="text-center">W-L</span>
        <span className="text-right">Win%</span>
        <span className="text-right">ADR</span>
        <span className="text-right">Rating</span>
      </div>
      <ul>
        {maps.map((m) => (
          <li
            key={m.map}
            className="grid grid-cols-[1.4fr_0.8fr_0.8fr_0.7fr_0.7fr] items-center gap-2 px-4 py-2.5"
          >
            <div className="min-w-0">
              <div className="truncate font-medium capitalize">
                {mapLabel(m.map)}
              </div>
              <div className="text-xs text-faint">{m.matches} matches</div>
            </div>
            <div className="text-center text-sm tabular-nums">
              <span className="text-good">{m.wins}</span>
              <span className="text-faint">-</span>
              <span className="text-bad">{m.losses}</span>
            </div>
            <div
              className={`text-right text-sm tabular-nums ${tierColor(m.winRate, 55, 45)}`}
            >
              {m.winRate.toFixed(0)}%
            </div>
            <div className="text-right text-sm tabular-nums text-muted">
              {m.adr.toFixed(0)}
            </div>
            <div
              className={`text-right text-sm font-semibold tabular-nums ${ratingColor(m.rating)}`}
            >
              {m.rating.toFixed(2)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
