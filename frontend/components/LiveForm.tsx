import type { LeetifyRecentMatch } from "@/lib/types";

const sourceLabel: Record<string, string> = {
  matchmaking: "MM",
  premier: "Premier",
  faceit: "FACEIT",
  wingman: "Wingman",
};

/**
 * LiveForm gives a live (Leetify) profile an at-a-glance recent-form strip the
 * way parsed profiles get RecentForm: a last-N W/L record, current streak, queue
 * mix and a per-match win/loss outcome bar — all from recent_matches. The
 * per-metric rating/aim trends live in the LiveTrendChart below it.
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

  // Queue mix across the window (e.g. "12 MM · 8 FACEIT").
  const sourceCounts = new Map<string, number>();
  for (const m of recent) {
    sourceCounts.set(m.data_source, (sourceCounts.get(m.data_source) || 0) + 1);
  }
  const queueMix = [...sourceCounts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <section className="card px-5 py-4">
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
        {queueMix.length > 1 && (
          <span className="text-xs text-faint">
            {queueMix
              .map(([src, n]) => `${n} ${sourceLabel[src] || src}`)
              .join(" · ")}
          </span>
        )}
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
