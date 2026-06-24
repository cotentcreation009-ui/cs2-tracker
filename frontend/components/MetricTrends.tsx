import type { PlayerMatchSummary } from "@/lib/types";

function Spark({
  label,
  values,
  fmt,
}: {
  label: string;
  values: number[];
  fmt: (v: number) => string;
}) {
  if (values.length < 2) return null;
  const w = 200;
  const h = 44;
  const pad = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (values.length - 1)) * (w - 2 * pad);
  const y = (v: number) => h - pad - ((v - min) / span) * (h - 2 * pad);
  const line = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");
  return (
    <div className="card px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="stat-label">{label}</div>
        <div className="text-sm font-semibold tabular-nums">
          {fmt(values[values.length - 1])}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="mt-2 h-10 w-full"
        preserveAspectRatio="none"
      >
        <path
          d={line}
          fill="none"
          stroke="var(--color-brand)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

/**
 * MetricTrends draws per-match ADR / KAST / Headshot-% sparklines (oldest →
 * newest) for parsed matches — the same sparkline treatment as the rating trend,
 * for the other headline metrics.
 */
export function MetricTrends({
  matches,
  count = 15,
}: {
  matches: PlayerMatchSummary[];
  count?: number;
}) {
  const slice = matches.slice(0, count).reverse();
  if (slice.length < 2) return null;
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
        Per-match trends · last {slice.length}
      </h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <Spark
          label="ADR"
          values={slice.map((m) => m.line.adr)}
          fmt={(v) => v.toFixed(0)}
        />
        <Spark
          label="KAST"
          values={slice.map((m) => m.line.kastPct)}
          fmt={(v) => `${v.toFixed(0)}%`}
        />
        <Spark
          label="Headshot %"
          values={slice.map((m) => m.line.hsPct)}
          fmt={(v) => `${v.toFixed(0)}%`}
        />
      </div>
    </section>
  );
}
