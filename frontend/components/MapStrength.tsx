"use client";

import { useMemo, useState } from "react";
import type { LeetifyRecentMatch } from "@/lib/types";
import { mapLabel } from "@/lib/format";

const avgColor = (n: number) =>
  n > 0.05 ? "text-good" : n < -0.05 ? "text-bad" : "text-mid";

const SOURCES = [
  { key: "all", label: "All" },
  { key: "premier", label: "Premier" },
  { key: "matchmaking", label: "MM" },
  { key: "faceit", label: "FACEIT" },
] as const;

type SourceKey = (typeof SOURCES)[number]["key"];

/**
 * MapStrength aggregates a player's recent Leetify matches by map into a per-map
 * W-L, win% and average Leetify rating. A window toggle (last 10/20/30) and a
 * queue filter let you scope "what's their best map?" — buckets larger than the
 * available match count are hidden so they never mislead. Client-side only;
 * Leetify currently returns up to 30 recent matches.
 */
export function MapStrength({ matches }: { matches: LeetifyRecentMatch[] }) {
  // Bucket options never overstate how many matches we actually have: the top
  // bucket is the real count (capped at Leetify's 30), and we drop any preset
  // that would just duplicate it.
  const maxBucket = Math.min(matches.length, 100);
  const buckets = Array.from(
    new Set([...[10, 20, 30, 50, 100].filter((b) => b < maxBucket), maxBucket]),
  ).sort((a, b) => a - b);

  const [bucket, setBucket] = useState(maxBucket);
  const [source, setSource] = useState<SourceKey>("all");

  // Which queue filters are actually present in the data.
  const presentSources = useMemo(() => {
    const set = new Set(matches.map((m) => m.data_source));
    return SOURCES.filter((s) => s.key === "all" || set.has(s.key));
  }, [matches]);

  const rows = useMemo(() => {
    const scoped = matches
      .filter((m) => source === "all" || m.data_source === source)
      .slice(0, bucket);

    const byMap = new Map<string, { n: number; w: number; sum: number }>();
    for (const m of scoped) {
      const key = m.map_name || "unknown";
      const e = byMap.get(key) || { n: 0, w: 0, sum: 0 };
      e.n += 1;
      if (m.outcome === "win") e.w += 1;
      e.sum += m.leetify_rating;
      byMap.set(key, e);
    }
    return {
      total: scoped.length,
      list: [...byMap.entries()]
        .map(([map, e]) => ({
          map,
          n: e.n,
          w: e.w,
          l: e.n - e.w,
          winPct: (e.w / e.n) * 100,
          avg: e.sum / e.n,
        }))
        .sort((a, b) => b.n - a.n),
    };
  }, [matches, bucket, source]);

  if (matches.length === 0) return null;

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
          Map strengths{" "}
          <span className="text-faint">· {rows.total} matches (Leetify)</span>
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {presentSources.length > 2 && (
            <div className="flex rounded-lg border border-line bg-panel p-0.5">
              {presentSources.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSource(s.key)}
                  className={`rounded-md px-2 py-0.5 text-xs font-medium transition ${
                    source === s.key
                      ? "bg-brand/15 text-brand"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex rounded-lg border border-line bg-panel p-0.5">
            {buckets.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBucket(b)}
                className={`rounded-md px-2 py-0.5 text-xs font-medium tabular-nums transition ${
                  bucket === b
                    ? "bg-brand/15 text-brand"
                    : "text-muted hover:text-ink"
                }`}
              >
                {b}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="grid grid-cols-[1.4fr_0.7fr_1.1fr_0.8fr] gap-2 border-b border-line px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-faint">
          <span>Map</span>
          <span className="text-center">W-L</span>
          <span>Win %</span>
          <span className="text-right">Avg rating</span>
        </div>
        {rows.list.length === 0 ? (
          <div className="px-4 py-4 text-sm text-muted">
            No matches in this filter.
          </div>
        ) : (
          <ul>
            {rows.list.map((r) => (
              <li
                key={r.map}
                className="grid grid-cols-[1.4fr_0.7fr_1.1fr_0.8fr] items-center gap-2 border-t border-line/60 px-4 py-2 text-sm"
              >
                <span className="truncate font-medium capitalize">
                  {mapLabel(r.map)}
                  {r.n < 3 && (
                    <span className="ml-1 text-[10px] text-faint">
                      n={r.n}
                    </span>
                  )}
                </span>
                <span className="text-center tabular-nums text-muted">
                  {r.w}-{r.l}
                </span>
                <span className="flex items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel">
                    <span
                      className={`block h-full rounded-full ${
                        r.winPct >= 50 ? "bg-good" : "bg-bad"
                      }`}
                      style={{ width: `${r.winPct}%` }}
                    />
                  </span>
                  <span className="w-8 shrink-0 text-right tabular-nums text-xs">
                    {r.winPct.toFixed(0)}%
                  </span>
                </span>
                <span
                  className={`text-right font-semibold tabular-nums ${avgColor(r.avg)}`}
                >
                  {r.avg >= 0 ? "+" : ""}
                  {r.avg.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
