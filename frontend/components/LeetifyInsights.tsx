import type { LeetifyRecentMatch } from "@/lib/types";
import { mapLabel } from "@/lib/format";

const sourceLabel: Record<string, string> = {
  matchmaking: "MM",
  premier: "Premier",
  faceit: "FACEIT",
  wingman: "Wingman",
};

const deltaColor = (n: number) =>
  n > 0.03 ? "text-good" : n < -0.03 ? "text-bad" : "text-mid";

/**
 * LeetifyInsights surfaces things derivable from the recent-match list that the
 * raw numbers don't say out loud: which queue a player wins most in, whether
 * they're trending up or down, how close their games are, and their best/worst
 * recent map. Pure arithmetic over recent_matches — no extra data.
 */
export function LeetifyInsights({ matches }: { matches: LeetifyRecentMatch[] }) {
  if (matches.length < 4) return null;

  // Form trend: most-recent N vs the N before it.
  const half = Math.min(5, Math.floor(matches.length / 2));
  const avg = (arr: LeetifyRecentMatch[]) =>
    arr.reduce((s, m) => s + m.leetify_rating, 0) / (arr.length || 1);
  const recentAvg = avg(matches.slice(0, half));
  const priorAvg = avg(matches.slice(half, half * 2));
  const delta = recentAvg - priorAvg;

  // Round differential + close-game rate (score = [team, enemy]).
  const scored = matches.filter((m) => m.score?.length === 2);
  const margins = scored.map((m) => m.score[0] - m.score[1]);
  const avgMargin = margins.length
    ? margins.reduce((s, v) => s + v, 0) / margins.length
    : 0;
  const closeRate = margins.length
    ? (margins.filter((v) => Math.abs(v) <= 3).length / margins.length) * 100
    : 0;

  // Win rate by queue.
  const byQueue = new Map<string, { w: number; n: number }>();
  for (const m of matches) {
    const e = byQueue.get(m.data_source) || { w: 0, n: 0 };
    e.n += 1;
    if (m.outcome === "win") e.w += 1;
    byQueue.set(m.data_source, e);
  }
  const queues = [...byQueue.entries()].sort((a, b) => b[1].n - a[1].n);

  // Best / worst recent map (min 2 games).
  const byMap = new Map<string, { w: number; n: number }>();
  for (const m of matches) {
    const k = m.map_name || "unknown";
    const e = byMap.get(k) || { w: 0, n: 0 };
    e.n += 1;
    if (m.outcome === "win") e.w += 1;
    byMap.set(k, e);
  }
  const ranked = [...byMap.entries()]
    .filter(([, e]) => e.n >= 2)
    .map(([map, e]) => ({ map, pct: (e.w / e.n) * 100 }))
    .sort((a, b) => b.pct - a.pct);
  const best = ranked[0];
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : null;

  return (
    <section className="card px-5 py-4">
      <div className="stat-label mb-3">Insights · last {matches.length}</div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <div className="stat-label">Form trend</div>
          <div
            className={`mt-1 flex items-center gap-1 text-lg font-bold tabular-nums ${deltaColor(delta)}`}
          >
            <span>{delta >= 0 ? "▲" : "▼"}</span>
            {delta >= 0 ? "+" : ""}
            {delta.toFixed(2)}
          </div>
          <div className="text-xs text-faint">last {half} vs prior {half}</div>
        </div>

        <div>
          <div className="stat-label">Avg round diff</div>
          <div
            className={`mt-1 text-lg font-bold tabular-nums ${deltaColor(avgMargin * 0.05)}`}
          >
            {avgMargin >= 0 ? "+" : ""}
            {avgMargin.toFixed(1)}
          </div>
          <div className="text-xs text-faint">
            {closeRate.toFixed(0)}% close (≤3 rds)
          </div>
        </div>

        {best && (
          <div>
            <div className="stat-label">Best / worst map</div>
            <div className="mt-1 text-sm font-medium capitalize">
              <span className="text-good">
                {mapLabel(best.map)} {best.pct.toFixed(0)}%
              </span>
              {worst && (
                <>
                  <span className="text-faint"> · </span>
                  <span className="text-bad">
                    {mapLabel(worst.map)} {worst.pct.toFixed(0)}%
                  </span>
                </>
              )}
            </div>
            <div className="text-xs text-faint">win rate (≥2 games)</div>
          </div>
        )}
      </div>

      {queues.length > 1 && (
        <div className="mt-4">
          <div className="stat-label mb-1.5">Win rate by queue</div>
          <div className="flex flex-wrap gap-2">
            {queues.map(([src, e]) => (
              <span key={src} className="pill bg-panel text-muted">
                <span className="font-medium text-ink">
                  {sourceLabel[src] || src}
                </span>{" "}
                {((e.w / e.n) * 100).toFixed(0)}%
                <span className="text-faint">
                  {" "}
                  ({e.w}-{e.n - e.w})
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
