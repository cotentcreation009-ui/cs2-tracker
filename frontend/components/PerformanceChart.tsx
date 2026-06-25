"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

export type TrendPoint = {
  date?: string; // ISO timestamp (for the tooltip)
  label?: string; // e.g. map name
  href?: string; // link to the match
  outcome?: "win" | "loss" | "tie";
  values: Record<string, number>;
};

export type TrendMetric = {
  key: string;
  label: string;
  format: (v: number) => string;
  baseline?: number; // draws a labeled dashed reference line (e.g. 1.00)
  lowerBetter?: boolean; // smaller is better (preaim, reaction time)
  padFrac?: number; // domain padding fraction (default 0.15)
};

const VW = 660;
const VH = 190;
const M = { l: 40, r: 14, t: 16, b: 22 };
const PW = VW - M.l - M.r;
const PH = VH - M.t - M.b;

const sourceTone = (outcome?: string) =>
  outcome === "win"
    ? "var(--color-good)"
    : outcome === "loss"
      ? "var(--color-bad)"
      : outcome === "tie"
        ? "var(--color-mid)"
        : "var(--color-brand)";

/**
 * PerformanceChart is one interactive trend chart that replaces the page's many
 * tiny sparklines. Pick a metric via the chips; hover a point for its map / date /
 * value; click a point to open that match. Fed chronological points (oldest →
 * newest) and works for both parsed and live (Leetify) profiles.
 */
export function PerformanceChart({
  title,
  points,
  metrics,
  external = false,
  footer,
}: {
  title: string;
  points: TrendPoint[];
  metrics: TrendMetric[];
  external?: boolean; // open hrefs in a new tab (live/Leetify links) vs SPA-nav
  footer?: React.ReactNode;
}) {
  const gradId = useId();
  const router = useRouter();
  const [activeKey, setActiveKey] = useState(metrics[0]?.key);
  const [hover, setHover] = useState<number | null>(null);

  const metric = metrics.find((m) => m.key === activeKey) ?? metrics[0];

  if (points.length < 2 || !metric) {
    return (
      <section className="card px-5 py-4">
        <div className="stat-label">{title}</div>
        <div className="mt-3 text-sm text-muted">
          Need at least 2 matches to chart trends.
        </div>
      </section>
    );
  }

  const n = points.length;
  const vals = points.map((p) => p.values[metric.key] ?? 0);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (metric.baseline != null) {
    lo = Math.min(lo, metric.baseline);
    hi = Math.max(hi, metric.baseline);
  }
  const pad = (hi - lo || Math.abs(hi) || 1) * (metric.padFrac ?? 0.15);
  lo -= pad;
  hi += pad;
  const span = hi - lo || 1;

  const x = (i: number) => M.l + (n === 1 ? PW / 2 : (i / (n - 1)) * PW);
  const y = (v: number) => M.t + (1 - (v - lo) / span) * PH;

  const linePath = vals
    .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L${x(n - 1).toFixed(1)},${(M.t + PH).toFixed(1)} L${x(0).toFixed(1)},${(M.t + PH).toFixed(1)} Z`;

  const ticks = [hi, (hi + lo) / 2, lo];
  const last = vals[n - 1];
  const hp = hover != null ? points[hover] : null;
  const hv = hover != null ? vals[hover] : null;

  function go(p: TrendPoint) {
    if (!p.href) return;
    if (external) window.open(p.href, "_blank", "noopener,noreferrer");
    else router.push(p.href);
  }

  return (
    <section className="card px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="stat-label">{title}</div>
        <div className="flex flex-wrap gap-1">
          {metrics.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setActiveKey(m.key)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                m.key === metric.key
                  ? "bg-brand/15 text-brand"
                  : "text-muted hover:text-ink"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums tracking-tight">
          {metric.format(hv ?? last)}
        </span>
        <span className="text-xs text-faint">
          {hp ? "selected match" : `latest · ${metric.label.toLowerCase()}`}
        </span>
      </div>

      <div className="relative mt-2">
        <svg
          viewBox={`0 0 ${VW} ${VH}`}
          className="h-44 w-full overflow-visible"
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* y-axis ticks + gridlines */}
          {ticks.map((t, i) => (
            <g key={i}>
              <line
                x1={M.l}
                x2={M.l + PW}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--color-line)"
                strokeWidth="1"
                strokeOpacity={i === 1 ? 0.35 : 0.55}
              />
              <text
                x={M.l - 6}
                y={y(t) + 3}
                textAnchor="end"
                className="fill-faint text-[10px] tabular-nums"
              >
                {metric.format(t)}
              </text>
            </g>
          ))}

          {/* baseline (e.g. 1.00 average) */}
          {metric.baseline != null && (
            <>
              <line
                x1={M.l}
                x2={M.l + PW}
                y1={y(metric.baseline)}
                y2={y(metric.baseline)}
                stroke="var(--color-muted)"
                strokeWidth="1"
                strokeDasharray="3 3"
                strokeOpacity="0.5"
              />
              <text
                x={M.l + PW}
                y={y(metric.baseline) - 4}
                textAnchor="end"
                className="fill-muted text-[9px]"
              >
                avg {metric.format(metric.baseline)}
              </text>
            </>
          )}

          {/* area + line */}
          <path d={areaPath} fill={`url(#${gradId})`} />
          <path
            d={linePath}
            fill="none"
            stroke="var(--color-brand)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* hover guide */}
          {hover != null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={M.t}
              y2={M.t + PH}
              stroke="var(--color-brand)"
              strokeWidth="1"
              strokeOpacity="0.45"
            />
          )}

          {/* points */}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={x(i)}
              cy={y(vals[i])}
              r={hover === i ? 4 : 2.5}
              fill={sourceTone(p.outcome)}
              stroke="var(--color-bg)"
              strokeWidth={hover === i ? 1.5 : 0}
            />
          ))}

          {/* per-point hit bands (hover + click) */}
          {points.map((p, i) => {
            const left = i === 0 ? M.l : (x(i - 1) + x(i)) / 2;
            const right = i === n - 1 ? M.l + PW : (x(i) + x(i + 1)) / 2;
            return (
              <rect
                key={i}
                x={left}
                y={M.t}
                width={Math.max(0, right - left)}
                height={PH}
                fill="transparent"
                className={p.href ? "cursor-pointer" : ""}
                onMouseEnter={() => setHover(i)}
                onClick={() => go(p)}
              />
            );
          })}
        </svg>

        {/* tooltip */}
        {hp && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-line2 bg-panel2/95 px-2.5 py-1.5 text-xs shadow-lg backdrop-blur"
            style={{
              left: `${(x(hover!) / VW) * 100}%`,
            }}
          >
            <div className="font-semibold capitalize">
              {hp.label || "match"}
            </div>
            <div className="tabular-nums text-muted">
              {metric.label}: {metric.format(hv!)}
            </div>
            {hp.date && (
              <div className="text-faint">
                {new Date(hp.date).toLocaleDateString()}
              </div>
            )}
            {hp.href && <div className="text-brand">click to open ↗</div>}
          </div>
        )}
      </div>

      {footer && <div className="mt-2 text-xs text-faint">{footer}</div>}
    </section>
  );
}
