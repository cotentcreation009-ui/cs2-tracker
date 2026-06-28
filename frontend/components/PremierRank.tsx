"use client";

import { useState } from "react";

// Official CS2 Premier rating colour bands (grey → sky → blue → purple →
// magenta → red → gold), matched to Valve's in-game emblem.
function premierColor(r: number): string {
  if (r >= 30000) return "#f4c84a";
  if (r >= 25000) return "#e94b4b";
  if (r >= 20000) return "#d24dd0";
  if (r >= 15000) return "#8b5ce6";
  if (r >= 10000) return "#4664e6";
  if (r >= 5000) return "#56a7d8";
  return "#aab6c4";
}
function premierTier(r: number): string {
  if (r >= 30000) return "Gold";
  if (r >= 25000) return "Red";
  if (r >= 20000) return "Pink";
  if (r >= 15000) return "Purple";
  if (r >= 10000) return "Blue";
  if (r >= 5000) return "Sky";
  return "Grey";
}

export interface PremierPoint {
  rating: number;
  date: string; // ISO finished_at
}

// PremierRank — the Premier emblem badge; click to expand the player's real
// Premier rating history (per Premier match, from Leetify). CS2 doesn't expose
// past-season end ranks via any public API, so this is the match-by-match
// rating timeline — the honest, real equivalent.
export function PremierRank({ premier, history }: { premier: number; history: PremierPoint[] }) {
  const [open, setOpen] = useState(false);
  const color = premierColor(premier);
  const pts = [...history].filter((p) => p.rating > 0).sort((a, b) => a.date.localeCompare(b.date));
  const hasHist = pts.length >= 2;

  return (
    <>
      <button
        type="button"
        disabled={!hasHist}
        onClick={() => setOpen((o) => !o)}
        title={hasHist ? "Show Premier rating history" : `Premier · ${premierTier(premier)} tier`}
        className="flex items-center gap-2.5 overflow-hidden rounded-xl border px-3 py-2 text-left transition enabled:hover:brightness-110 disabled:cursor-default"
        style={{ borderColor: `${color}59`, background: `linear-gradient(100deg, ${color}2e, ${color}0a 72%)` }}
      >
        <span className="flex h-9 items-center gap-[3px]" aria-hidden>
          <span className="h-9 w-1 -skew-x-12 rounded-[2px]" style={{ background: color }} />
          <span className="h-9 w-[7px] -skew-x-12 rounded-[2px]" style={{ background: color }} />
          <span className="h-9 w-[3px] -skew-x-12 rounded-[2px]" style={{ background: color, opacity: 0.5 }} />
        </span>
        <div className="min-w-0">
          <div className="stat-label flex items-center gap-1">
            Premier {hasHist && <span className="text-faint">{open ? "▲" : "▾"}</span>}
          </div>
          <div className="text-base font-bold tabular-nums" style={{ color }}>
            {premier.toLocaleString("en-US")}
          </div>
        </div>
      </button>

      {open && hasHist && (
        <div className="w-full">
          <PremierHistory pts={pts} current={premier} />
        </div>
      )}
    </>
  );
}

function PremierHistory({ pts, current }: { pts: PremierPoint[]; current: number }) {
  const ratings = pts.map((p) => p.rating);
  const min = Math.min(...ratings);
  const max = Math.max(...ratings);
  const span = max - min || 1;
  const peak = max;
  const W = 640;
  const H = 90;
  const xy = pts.map((p, i) => {
    const x = pts.length > 1 ? (i / (pts.length - 1)) * W : W / 2;
    const y = H - 6 - ((p.rating - min) / span) * (H - 12);
    return [x, y] as const;
  });
  const path = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const cur = premierColor(current);
  const recent = [...pts].reverse().slice(0, 10); // most-recent first
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div className="mt-2 rounded-xl border border-line bg-panel/40 p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="stat-label">Premier rating history</span>
        <span className="text-[11px] text-faint">{pts.length} Premier matches</span>
        <span className="ml-auto flex items-center gap-3 text-xs">
          <span className="text-muted">Peak <b className="tabular-nums" style={{ color: premierColor(peak) }}>{peak.toLocaleString("en-US")}</b></span>
          <span className="text-muted">Now <b className="tabular-nums" style={{ color: cur }}>{current.toLocaleString("en-US")}</b></span>
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-24 w-full">
        <defs>
          <linearGradient id="pmHistFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={cur} stopOpacity="0.28" />
            <stop offset="100%" stopColor={cur} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${path} L${W},${H} L0,${H} Z`} fill="url(#pmHistFill)" />
        <path d={path} fill="none" stroke={cur} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {xy.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={2.2} fill={premierColor(pts[i].rating)} />
        ))}
      </svg>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {recent.map((p, i) => {
          const prev = recent[i + 1];
          const delta = prev ? p.rating - prev.rating : 0;
          return (
            <span
              key={`${p.date}-${i}`}
              className="rounded-md border border-line bg-panel px-2 py-1 text-[11px] tabular-nums"
              title={new Date(p.date).toLocaleString()}
            >
              <span className="text-faint">{fmtDate(p.date)}</span>{" "}
              <b style={{ color: premierColor(p.rating) }}>{p.rating.toLocaleString("en-US")}</b>
              {prev && (
                <span className={delta > 0 ? "text-good" : delta < 0 ? "text-bad" : "text-faint"}>
                  {" "}
                  {delta > 0 ? "▲" : delta < 0 ? "▼" : "—"}
                  {delta !== 0 ? Math.abs(delta) : ""}
                </span>
              )}
            </span>
          );
        })}
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-faint">
        Match-by-match Premier rating from Leetify. CS2 doesn&apos;t expose past-season final ranks through any
        public API, so this is the real rating timeline rather than discrete season badges.
      </p>
    </div>
  );
}
