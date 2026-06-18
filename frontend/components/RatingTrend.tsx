import type { PlayerMatchSummary } from "@/lib/types";
import { ratingColor } from "@/lib/format";

/**
 * RatingTrend draws a small SVG sparkline of per-match rating over the most
 * recent matches (oldest → newest), with a dashed baseline at the 1.00 average
 * rating. No charting dependency — just a scaled polyline.
 */
export function RatingTrend({
  matches,
  count = 15,
}: {
  matches: PlayerMatchSummary[];
  count?: number;
}) {
  const pts = matches
    .slice(0, count)
    .map((m) => m.line.rating)
    .reverse();
  if (pts.length < 2) return null;

  const w = 260;
  const h = 56;
  const pad = 6;
  const min = Math.min(...pts, 0.8);
  const max = Math.max(...pts, 1.2);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (pts.length - 1)) * (w - 2 * pad);
  const y = (v: number) => h - pad - ((v - min) / span) * (h - 2 * pad);

  const line = pts
    .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");
  const baselineY = y(1).toFixed(1);
  const last = pts[pts.length - 1];

  return (
    <div className="card px-5 py-4">
      <div className="flex items-center justify-between">
        <div className="stat-label">Rating trend · last {pts.length}</div>
        <div className={`text-sm font-semibold tabular-nums ${ratingColor(last)}`}>
          {last.toFixed(2)}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="mt-2 h-14 w-full"
        preserveAspectRatio="none"
      >
        <line
          x1={pad}
          x2={w - pad}
          y1={baselineY}
          y2={baselineY}
          stroke="var(--color-line)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
        <path
          d={line}
          fill="none"
          stroke="var(--color-brand)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {pts.map((v, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(v)}
            r="2"
            fill={v >= 1 ? "var(--color-good)" : "var(--color-bad)"}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </div>
  );
}
