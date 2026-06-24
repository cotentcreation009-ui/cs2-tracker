import type { LeetifyRecentMatch } from "@/lib/types";

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 160;
  const h = 34;
  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
      const y = h - pad - ((v - min) / range) * (h - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} className="shrink-0 text-brand" aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * LiveForm gives a live (Leetify) profile an at-a-glance trend the way parsed
 * profiles get RecentForm/RatingTrend: a last-N W/L record, current streak, a
 * per-match outcome bar and a Leetify-rating sparkline — all from recent_matches.
 */
export function LiveForm({ matches }: { matches: LeetifyRecentMatch[] }) {
  if (matches.length < 2) return null;
  const recent = matches.slice(0, 20); // most-recent-first
  const chrono = [...recent].reverse(); // oldest -> newest for the trend
  const wins = recent.filter((m) => m.outcome === "win").length;
  const losses = recent.filter((m) => m.outcome === "loss").length;

  let streak = 0;
  const streakType = recent[0]?.outcome;
  for (const m of recent) {
    if (m.outcome === streakType) streak += 1;
    else break;
  }

  return (
    <section className="card px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="stat-label">Recent form</span>
          <span className="text-sm tabular-nums">
            <span className="font-semibold text-good">{wins}W</span>{" "}
            <span className="font-semibold text-bad">{losses}L</span>{" "}
            <span className="text-faint">last {recent.length}</span>
          </span>
          {streak >= 2 && (
            <span
              className={`pill ${streakType === "win" ? "bg-good/15 text-good" : "bg-bad/15 text-bad"}`}
            >
              {streak} {streakType === "win" ? "win" : "loss"} streak
            </span>
          )}
        </div>
        <Sparkline values={chrono.map((m) => m.leetify_rating)} />
      </div>
      <div className="mt-2 flex gap-1">
        {chrono.map((m, i) => (
          <span
            key={m.id || i}
            title={`${m.outcome} · ${m.map_name}`}
            className={`h-1.5 flex-1 rounded-full ${
              m.outcome === "win"
                ? "bg-good"
                : m.outcome === "tie"
                  ? "bg-mid"
                  : "bg-bad"
            }`}
          />
        ))}
      </div>
    </section>
  );
}
