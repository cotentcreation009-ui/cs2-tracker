"use client";

import { useState } from "react";

// Rating-over-time consistency chart for the CheatMeter. A single series
// (Leetify rating per recent match) drawn as a gradient area with a dashed mean
// reference, a hover crosshair/tooltip, and a win/loss "form" strip beneath —
// so a player's steadiness (flat vs spiky) and their results read at a glance.
// One measure, one axis (the old version overlaid rating + HS-acc on two hidden
// scales, which is exactly the dual-axis mistake).

const fmt = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
const ratingTone = (v: number) =>
  v >= 1.1 ? "text-good" : v <= 0.85 ? "text-bad" : "text-ink";

const outFill = (o: string) =>
  o === "win" ? "bg-good" : o === "loss" ? "bg-bad" : "bg-mid";
const outTone = (o: string) =>
  o === "win" ? "text-good" : o === "loss" ? "text-bad" : "text-mid";
const outLabel = (o: string) =>
  o === "win" ? "Win" : o === "loss" ? "Loss" : "Draw";

export function RatingConsistencyChart({
  ratings,
  outcomes,
  total,
}: {
  ratings: number[];
  outcomes: string[];
  total: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = ratings.length;

  const header = (
    <div className="flex items-center justify-between gap-2">
      <div className="stat-label">
        Performance consistency
        <span className="text-faint"> · last {total}</span>
      </div>
      {n >= 2 && <ConsistencyReadout ratings={ratings} />}
    </div>
  );

  if (n < 2) {
    return (
      <div className="card px-4 py-3">
        {header}
        <div className="flex h-24 items-center justify-center text-xs text-faint">
          Not enough matches to chart.
        </div>
      </div>
    );
  }

  const min = Math.min(...ratings);
  const max = Math.max(...ratings);
  const range = max - min || 1;
  const mean = ratings.reduce((a, b) => a + b, 0) / n;

  // viewBox is 0..100 in both axes with preserveAspectRatio="none", so SVG
  // coordinates equal percentages — the HTML overlay (crosshair/dot/tooltip)
  // maps 1:1 without any bounding-box math.
  const PT = 14; // top padding (%)
  const PB = 14; // bottom padding (%)
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => PT + (1 - (v - min) / range) * (100 - PT - PB);

  const pts = ratings.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`);
  const linePath = "M" + pts.join(" L");
  const areaPath = `M${x(0).toFixed(2)},100 L${pts.join(" L")} L${x(n - 1).toFixed(2)},100 Z`;
  const meanY = y(mean);

  return (
    <div className="card px-4 py-3">
      {header}

      {/* plot */}
      <div className="relative mt-2 h-[62px] w-full" onMouseLeave={() => setHover(null)}>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-full w-full overflow-visible"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="rc-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-brand2)" stopOpacity="0.34" />
              <stop offset="100%" stopColor="var(--color-brand2)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* mean reference */}
          <line
            x1="0"
            y1={meanY}
            x2="100"
            y2={meanY}
            stroke="var(--color-line2)"
            strokeWidth="1"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
          <path d={areaPath} fill="url(#rc-fill)" />
          <path
            d={linePath}
            fill="none"
            stroke="var(--color-brand2)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* hovered crosshair + point */}
        {hover != null && (
          <>
            <div
              className="pointer-events-none absolute bottom-0 top-0 w-px bg-line2"
              style={{ left: `${x(hover)}%` }}
            />
            <div
              className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-bg bg-brand2"
              style={{ left: `${x(hover)}%`, top: `${y(ratings[hover])}%` }}
            />
            <div
              className="pointer-events-none absolute z-10 -translate-y-full rounded-md border border-line bg-bg/95 px-2 py-1 text-[10px] shadow"
              style={{
                left: `${Math.min(88, Math.max(12, x(hover)))}%`,
                top: `${y(ratings[hover])}%`,
                transform: "translate(-50%, -140%)",
              }}
            >
              <div className={`font-semibold tabular-nums ${ratingTone(ratings[hover])}`}>
                {fmt(ratings[hover])} rating
              </div>
              <div className={outTone(outcomes[hover])}>{outLabel(outcomes[hover])}</div>
            </div>
          </>
        )}

        {/* invisible per-match hover targets */}
        <div className="absolute inset-0 flex">
          {ratings.map((_, i) => (
            <div key={i} className="h-full flex-1" onMouseEnter={() => setHover(i)} />
          ))}
        </div>
      </div>

      {/* win/loss form strip (oldest → newest, aligned under the line) */}
      <div className="mt-2 flex gap-px overflow-hidden rounded-sm">
        {outcomes.map((o, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 transition-opacity ${outFill(o)} ${hover === i ? "opacity-100" : "opacity-65"}`}
          />
        ))}
      </div>

      {/* legend */}
      <div className="mt-1.5 flex items-center gap-3 text-[10px] text-faint">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-good" />
          Win
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-bad" />
          Loss
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-mid" />
          Draw
        </span>
        <span className="ml-auto">oldest → newest</span>
      </div>
    </div>
  );
}

// Average rating + a plain-language steadiness word (from the rating's spread),
// shown top-right. Text wears text tokens, not the series colour.
function ConsistencyReadout({ ratings }: { ratings: number[] }) {
  const n = ratings.length;
  const mean = ratings.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(ratings.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const word = std < 0.3 ? "steady" : std < 0.55 ? "streaky" : "volatile";
  return (
    <div className="flex items-center gap-2 text-[11px] tabular-nums">
      <span className="text-faint">avg</span>
      <span className={`font-bold ${ratingTone(mean)}`}>{fmt(mean)}</span>
      <span
        className="rounded bg-panel px-1.5 py-0.5 text-[10px] font-medium text-muted"
        title={`Rating spread σ = ${std.toFixed(2)} across the window`}
      >
        {word}
      </span>
    </div>
  );
}
