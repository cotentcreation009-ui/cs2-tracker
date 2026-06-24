import type { LeetifyRecentMatch } from "@/lib/types";
import { mapLabel } from "@/lib/format";

const avgColor = (n: number) =>
  n > 0.05 ? "text-good" : n < -0.05 ? "text-bad" : "text-mid";

/**
 * MapStrength aggregates a player's recent Leetify matches by map into a
 * per-map W-L, win% and average Leetify rating — answering "what's their best
 * map?" for live-only profiles that have no parsed career data.
 */
export function MapStrength({ matches }: { matches: LeetifyRecentMatch[] }) {
  const byMap = new Map<string, { n: number; w: number; sum: number }>();
  for (const m of matches) {
    const key = m.map_name || "unknown";
    const e = byMap.get(key) || { n: 0, w: 0, sum: 0 };
    e.n += 1;
    if (m.outcome === "win") e.w += 1;
    e.sum += m.leetify_rating;
    byMap.set(key, e);
  }

  const rows = [...byMap.entries()]
    .map(([map, e]) => ({
      map,
      n: e.n,
      w: e.w,
      l: e.n - e.w,
      winPct: (e.w / e.n) * 100,
      avg: e.sum / e.n,
    }))
    .sort((a, b) => b.n - a.n);

  if (rows.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
        Map strengths{" "}
        <span className="text-faint">· last {matches.length} (Leetify)</span>
      </h2>
      <div className="card overflow-hidden">
        <div className="grid grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr] gap-2 border-b border-line px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-faint">
          <span>Map</span>
          <span className="text-center">W-L</span>
          <span className="text-right">Win %</span>
          <span className="text-right">Avg rating</span>
        </div>
        <ul>
          {rows.map((r) => (
            <li
              key={r.map}
              className="grid grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr] items-center gap-2 border-t border-line/60 px-4 py-2 text-sm"
            >
              <span className="truncate font-medium capitalize">
                {mapLabel(r.map)}
              </span>
              <span className="text-center tabular-nums text-muted">
                {r.w}-{r.l}
              </span>
              <span className="text-right tabular-nums">
                {r.winPct.toFixed(0)}%
              </span>
              <span
                className={`text-right tabular-nums font-semibold ${avgColor(r.avg)}`}
              >
                {r.avg >= 0 ? "+" : ""}
                {r.avg.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
