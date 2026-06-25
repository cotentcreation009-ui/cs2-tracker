"use client";

import type { LeetifyRecentMatch } from "@/lib/types";
import { mapLabel } from "@/lib/format";
import {
  PerformanceChart,
  type TrendMetric,
  type TrendPoint,
} from "@/components/PerformanceChart";

// The per-match aim metrics Leetify already returns but the page otherwise only
// shows buried in expand rows — now trendable over time.
const METRICS: TrendMetric[] = [
  {
    key: "rating",
    label: "Rating",
    format: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`,
    baseline: 0,
  },
  { key: "preaim", label: "Preaim", format: (v) => `${v.toFixed(1)}°`, lowerBetter: true },
  {
    key: "reaction",
    label: "Reaction",
    format: (v) => `${v.toFixed(0)}ms`,
    lowerBetter: true,
  },
  { key: "spray", label: "Spray", format: (v) => `${v.toFixed(0)}%` },
  { key: "hs", label: "HS acc", format: (v) => `${v.toFixed(1)}%` },
];

const isOutcome = (s: string): s is "win" | "loss" | "tie" =>
  s === "win" || s === "loss" || s === "tie";

/** Per-match aim + rating trend chart for live (Leetify) profiles. */
export function LiveTrendChart({
  matches,
  count = 50,
}: {
  matches: LeetifyRecentMatch[];
  count?: number;
}) {
  const points: TrendPoint[] = matches
    .slice(0, count)
    .reverse()
    .map((m) => ({
      date: m.finished_at,
      label: mapLabel(m.map_name),
      href: m.id ? `https://leetify.com/app/match-details/${m.id}` : undefined,
      outcome: isOutcome(m.outcome) ? m.outcome : undefined,
      values: {
        rating: m.leetify_rating,
        preaim: m.preaim,
        reaction: m.reaction_time_ms,
        spray: m.spray_accuracy,
        hs: m.accuracy_head,
      },
    }));

  return (
    <PerformanceChart
      title="Aim & rating trends"
      points={points}
      metrics={METRICS}
      external
      footer="Per-match Leetify aim metrics · click a point to open on Leetify"
    />
  );
}
