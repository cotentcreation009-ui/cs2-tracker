"use client";

import type { PlayerMatchSummary } from "@/lib/types";
import { mapLabel } from "@/lib/format";
import {
  PerformanceChart,
  type TrendMetric,
  type TrendPoint,
} from "@/components/PerformanceChart";

const METRICS: TrendMetric[] = [
  { key: "rating", label: "Rating", format: (v) => v.toFixed(2), baseline: 1 },
  { key: "adr", label: "ADR", format: (v) => v.toFixed(0) },
  { key: "kast", label: "KAST", format: (v) => `${v.toFixed(0)}%` },
  { key: "hs", label: "HS%", format: (v) => `${v.toFixed(0)}%` },
];

/** Per-match trend chart for parsed (native) profiles. */
export function ParsedTrendChart({
  matches,
  count = 15,
}: {
  matches: PlayerMatchSummary[];
  count?: number;
}) {
  const points: TrendPoint[] = matches
    .slice(0, count)
    .reverse()
    .map((m) => ({
      date: m.match.playedAt,
      label: mapLabel(m.match.map),
      href: `/matches/${m.match.id}`,
      outcome: m.line.won ? "win" : "loss",
      values: {
        rating: m.line.rating,
        adr: m.line.adr,
        kast: m.line.kastPct,
        hs: m.line.hsPct,
      },
    }));

  return (
    <PerformanceChart
      title="Per-match trends"
      points={points}
      metrics={METRICS}
      footer={`Last ${points.length} parsed matches · click a point to open the match`}
    />
  );
}
