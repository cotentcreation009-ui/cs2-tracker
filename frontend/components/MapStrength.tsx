"use client";

import { useMemo, useState } from "react";
import type { LeetifyRecentMatch } from "@/lib/types";
import { mapLabel, timeAgo } from "@/lib/format";
import { radarImage } from "@/lib/maps/calibration";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const SOURCES = [
  { key: "all", label: "All" },
  { key: "premier", label: "Premier" },
  { key: "matchmaking", label: "MM" },
  { key: "faceit", label: "FACEIT" },
] as const;

type SourceKey = (typeof SOURCES)[number]["key"];

const sourceLabel: Record<string, string> = {
  matchmaking: "MM",
  premier: "Premier",
  faceit: "FACEIT",
  wingman: "Wingman",
};

const winColor = (p: number) =>
  p >= 53 ? "#46d369" : p >= 47 ? "#f5b942" : "#f5694a";
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
const impactColor = (n: number) =>
  n > 0.03 ? "text-good" : n < -0.03 ? "text-bad" : "text-mid";

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-panel/60 px-2.5 py-1.5">
      <div className="stat-label">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 140;
  const h = 32;
  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
      const y = h - pad - ((v - min) / range) * (h - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} className="text-brand2" aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MapDetail({ ms, map }: { ms: LeetifyRecentMatch[]; map: string }) {
  const avg = (f: (m: LeetifyRecentMatch) => number) =>
    ms.reduce((s, m) => s + f(m), 0) / (ms.length || 1);
  const rating = avg((m) => m.leetify_rating);
  const preaim = avg((m) => m.preaim);
  const reaction = avg((m) => m.reaction_time_ms);
  const hsAcc = avg((m) => m.accuracy_head);
  const spray = avg((m) => m.spray_accuracy);
  const chrono = [...ms].reverse().map((m) => m.leetify_rating);
  const scoreAvg = (outcome: string) => {
    const xs = ms.filter((m) => m.outcome === outcome && m.score?.length === 2);
    if (!xs.length) return null;
    const a = Math.round(xs.reduce((s, m) => s + m.score[0], 0) / xs.length);
    const b = Math.round(xs.reduce((s, m) => s + m.score[1], 0) / xs.length);
    return `${a}-${b}`;
  };
  const winLine = scoreAvg("win");
  const lossLine = scoreAvg("loss");
  const queues = new Map<string, number>();
  for (const m of ms) queues.set(m.data_source, (queues.get(m.data_source) || 0) + 1);
  const queueMix = [...queues.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${n} ${sourceLabel[s] || s}`)
    .join(" · ");

  return (
    <div className="mb-1 rounded-lg border border-line bg-bg/50 px-4 py-3">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        <DetailStat label="Avg rating" value={signed(rating)} />
        <DetailStat label="Preaim" value={`${preaim.toFixed(1)}°`} />
        <DetailStat label="Reaction" value={`${reaction.toFixed(0)}ms`} />
        <DetailStat label="HS acc" value={`${hsAcc.toFixed(0)}%`} />
        <DetailStat label="Spray" value={`${spray.toFixed(0)}%`} />
      </div>

      {(chrono.length >= 2 || winLine || lossLine) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          {chrono.length >= 2 && (
            <div>
              <div className="stat-label mb-1">Rating on {mapLabel(map)}</div>
              <Spark values={chrono} />
            </div>
          )}
          {(winLine || lossLine) && (
            <div className="text-right">
              <div className="stat-label mb-1">Typical result</div>
              <div className="text-sm font-semibold tabular-nums">
                {winLine && <span className="text-good">W {winLine}</span>}
                {winLine && lossLine && <span className="text-faint"> · </span>}
                {lossLine && <span className="text-bad">L {lossLine}</span>}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="stat-label">Recent matches on {mapLabel(map)}</span>
          {queueMix && <span className="text-[10px] text-faint">{queueMix}</span>}
        </div>
        <div className="space-y-0.5">
          {ms.slice(0, 8).map((m, i) => {
            const won = m.outcome === "win";
            const tie = m.outcome === "tie";
            const cells = (
              <>
                <span
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded text-[10px] font-bold ${
                    tie
                      ? "bg-mid/20 text-mid"
                      : won
                        ? "bg-good/20 text-good"
                        : "bg-bad/20 text-bad"
                  }`}
                >
                  {tie ? "T" : won ? "W" : "L"}
                </span>
                <span className="w-12 shrink-0 tabular-nums text-muted">
                  {m.score?.length === 2 ? `${m.score[0]}–${m.score[1]}` : "—"}
                </span>
                <span className={`w-12 shrink-0 tabular-nums ${impactColor(m.leetify_rating)}`}>
                  {signed(m.leetify_rating)}
                </span>
                <span className="shrink-0 text-faint">
                  {sourceLabel[m.data_source] || m.data_source}
                </span>
                <span className="ml-auto shrink-0 text-faint">
                  {timeAgo(m.finished_at)}
                </span>
              </>
            );
            return m.id ? (
              <a
                key={m.id}
                href={`https://leetify.com/app/match-details/${m.id}`}
                target="_blank"
                rel="noreferrer"
                title="Open match on Leetify"
                className="-mx-1.5 flex items-center gap-2.5 rounded px-1.5 py-1 text-xs transition hover:bg-panel/60"
              >
                {cells}
                <span className="shrink-0 text-brand">↗</span>
              </a>
            ) : (
              <div
                key={i}
                className="-mx-1.5 flex items-center gap-2.5 px-1.5 py-1 text-xs"
              >
                {cells}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface MapRow {
  map: string;
  ms: LeetifyRecentMatch[];
  n: number;
  w: number;
  l: number;
  winPct: number;
}

// Round win rate across a map's matches (sum rounds won / total rounds). NaN
// when no match carries a score.
function roundWinPct(ms: LeetifyRecentMatch[]): number {
  let won = 0,
    total = 0;
  for (const m of ms) {
    if (m.score?.length === 2) {
      won += m.score[0];
      total += m.score[0] + m.score[1];
    }
  }
  return total ? (won / total) * 100 : NaN;
}

// Rounds won-lost across a map's matches (for the record line in rounds mode).
function roundRec(ms: LeetifyRecentMatch[]): { won: number; lost: number } {
  let won = 0,
    lost = 0;
  for (const m of ms) {
    if (m.score?.length === 2) {
      won += m.score[0];
      lost += m.score[1];
    }
  }
  return { won, lost };
}

// Map icon: real map logo, falling back to the radar thumbnail, then a short
// label. Shows the map name on hover so each vertex is identifiable.
function MapIcon({ map }: { map: string }) {
  const logo = radarImage(map).replace(/radar\.png$/, "logo.png");
  const radar = radarImage(map);
  const [stage, setStage] = useState(0); // 0 = logo, 1 = radar, 2 = label
  const short = map.replace("de_", "").slice(0, 3).toUpperCase();
  return (
    <span className="group relative grid place-items-center">
      {stage >= 2 ? (
        <span className="grid h-9 w-9 place-items-center rounded-full border border-line2 bg-panel2 text-[9px] font-bold text-muted">
          {short}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={stage === 0 ? logo : radar}
          alt={mapLabel(map)}
          onError={() => setStage((s) => s + 1)}
          draggable={false}
          className={`h-9 w-9 rounded-full border border-line2 bg-panel2/80 ${
            stage === 0 ? "object-contain p-0.5" : "object-cover"
          }`}
        />
      )}
      <span className="pointer-events-none absolute -bottom-4 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-bg/95 px-1.5 py-0.5 text-[9px] font-semibold text-ink opacity-0 shadow transition-opacity group-hover:opacity-100">
        {mapLabel(map)}
      </span>
    </span>
  );
}

const RADAR = 240;
const RC = RADAR / 2;
const RR = 78;

/**
 * MapWinRadar — a spider chart of per-map win rate (by rounds or matches), with
 * a map icon at each vertex and a best/worst footer. Reacts to the section's
 * window + queue filters via the rows it's given.
 */
function MapWinRadar({
  rows,
  metric,
  setMetric,
  useMetric,
  hasRounds,
  valOf,
  embedded = false,
}: {
  rows: MapRow[];
  metric: "rounds" | "matches";
  setMetric: (m: "rounds" | "matches") => void;
  useMetric: "rounds" | "matches";
  hasRounds: boolean;
  valOf: (r: MapRow) => number;
  embedded?: boolean;
}) {
  void metric;
  const reliable = rows.filter((r) => r.n >= 3);
  const base = (reliable.length >= 3 ? reliable : rows.filter((r) => r.n >= 1)).slice(0, 9);
  // fixed angular order (by name) so vertices don't jump as values change
  const data = [...base].sort((a, b) => a.map.localeCompare(b.map));

  if (data.length < 3) return null;

  const N = data.length;
  const vals = data.map(valOf);

  // Scale to the data's own range instead of 0–100, so a 43–75% spread fills the
  // chart rather than bunching near the centre. 50% stays inside the band.
  const lo = Math.max(0, Math.min(40, Math.min(...vals) - 6));
  const hi = Math.min(100, Math.max(60, Math.max(...vals) + 6));
  const span = hi - lo || 1;
  const frac = (v: number) => clamp((v - lo) / span, 0.06, 1);
  const frac50 = clamp((50 - lo) / span, 0.06, 1);

  const ang = (i: number) => -Math.PI / 2 + (i / N) * Math.PI * 2;
  const ptAt = (i: number, f: number) => ({
    x: RC + Math.cos(ang(i)) * RR * f,
    y: RC + Math.sin(ang(i)) * RR * f,
  });

  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  const col = winColor(avg);
  const polyPts = data
    .map((_, i) => ptAt(i, frac(vals[i])))
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const ring = (f: number) =>
    data.map((_, i) => ptAt(i, f)).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const ranked = data.map((r) => ({ r, v: valOf(r) })).sort((a, b) => b.v - a.v);
  const best = ranked[0];
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : null;

  return (
    <div className={embedded ? "card flex flex-col px-3.5 py-3" : "card-2 mb-3 px-4 py-4"}>
      <div className="mb-2 flex items-center justify-between gap-2">
        {embedded ? (
          <span className="stat-label">Map win rates</span>
        ) : (
          <h3 className="text-sm font-bold">Map Win Rates</h3>
        )}
        <div className="flex rounded-lg border border-line bg-panel p-0.5">
          {(["rounds", "matches"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={useMetric === m}
              onClick={() => setMetric(m)}
              disabled={m === "rounds" && !hasRounds}
              className={`rounded-md px-2 py-0.5 text-xs font-medium capitalize transition ${
                useMetric === m ? "bg-brand/15 text-brand" : "text-muted hover:text-ink"
              } ${m === "rounds" && !hasRounds ? "opacity-40" : ""}`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div
        className={`relative mx-auto aspect-square w-full ${
          embedded ? "max-w-[200px]" : "max-w-xs"
        }`}
      >
        <svg
          viewBox={`0 0 ${RADAR} ${RADAR}`}
          className="absolute inset-0 h-full w-full overflow-visible"
        >
          {[0.4, 0.7, 1].map((f) => (
            <polygon key={f} points={ring(f)} fill="none" stroke="var(--color-line)" strokeWidth={0.7} opacity={0.45} />
          ))}
          {/* 50% reference ring */}
          <polygon
            points={ring(frac50)}
            fill="none"
            stroke="var(--color-line2)"
            strokeWidth={1.2}
            strokeDasharray="3 3"
            opacity={0.9}
          />
          {data.map((_, i) => {
            const o = ptAt(i, 1);
            return (
              <line key={i} x1={RC} y1={RC} x2={o.x} y2={o.y} stroke="var(--color-line)" strokeWidth={0.6} opacity={0.4} />
            );
          })}
          <polygon points={polyPts} fill={`${col}33`} stroke={col} strokeWidth={2} strokeLinejoin="round" />
          {data.map((_, i) => {
            const p = ptAt(i, frac(vals[i]));
            return <circle key={i} cx={p.x} cy={p.y} r={2.6} fill={col} stroke="#04060e" strokeWidth={0.8} />;
          })}
          <circle cx={RC} cy={RC} r={1.5} fill="var(--color-faint)" />
        </svg>

        {data.map((r, i) => {
          const o = ptAt(i, 1.17);
          return (
            <div
              key={r.map}
              title={`${mapLabel(r.map)} · ${valOf(r).toFixed(0)}% ${useMetric}`}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${(o.x / RADAR) * 100}%`, top: `${(o.y / RADAR) * 100}%` }}
            >
              <MapIcon map={r.map} />
            </div>
          );
        })}
      </div>

      <div className={`grid grid-cols-2 gap-2 ${embedded ? "mt-auto pt-2" : "mt-3"}`}>
        <div className={`rounded-lg border border-line bg-panel/60 ${embedded ? "px-2 py-1" : "px-3 py-2"}`}>
          <div className="stat-label">Best</div>
          <div className="flex items-center justify-between gap-1">
            <span className={`truncate font-semibold capitalize ${embedded ? "text-xs" : "text-sm"}`}>{mapLabel(best.r.map)}</span>
            <span className={`font-bold tabular-nums text-good ${embedded ? "text-xs" : "text-sm"}`}>{best.v.toFixed(0)}%</span>
          </div>
        </div>
        {worst && (
          <div className={`rounded-lg border border-line bg-panel/60 ${embedded ? "px-2 py-1" : "px-3 py-2"}`}>
            <div className="stat-label">Worst</div>
            <div className="flex items-center justify-between gap-1">
              <span className={`truncate font-semibold capitalize ${embedded ? "text-xs" : "text-sm"}`}>{mapLabel(worst.r.map)}</span>
              <span className={`font-bold tabular-nums text-bad ${embedded ? "text-xs" : "text-sm"}`}>{worst.v.toFixed(0)}%</span>
            </div>
          </div>
        )}
      </div>
      {!embedded && (
        <div className="mt-1.5 text-center text-[10px] text-faint">
          win rate by {useMetric} · {data.length} maps · 50% = dashed ring
        </div>
      )}
    </div>
  );
}

// MapWinChart — just the Map Win Rates radar, self-contained (computes its own
// rows from all matches, defaults to match win rate). For embedding in a compact
// spot like the CheatMeter box. Renders nothing if there are fewer than 3 maps.
export function MapWinChart({
  matches,
  embedded = false,
}: {
  matches: LeetifyRecentMatch[];
  embedded?: boolean;
}) {
  const [metric, setMetric] = useState<"rounds" | "matches">("matches");
  const rows = useMemo<MapRow[]>(() => {
    const byMap = new Map<string, LeetifyRecentMatch[]>();
    for (const m of matches.slice(0, 100)) {
      const key = m.map_name || "unknown";
      const arr = byMap.get(key);
      if (arr) arr.push(m);
      else byMap.set(key, [m]);
    }
    return [...byMap.entries()].map(([map, ms]) => {
      const w = ms.filter((m) => m.outcome === "win").length;
      return { map, ms, n: ms.length, w, l: ms.length - w, winPct: (w / ms.length) * 100 };
    });
  }, [matches]);
  const hasRounds = useMemo(() => rows.some((r) => Number.isFinite(roundWinPct(r.ms))), [rows]);
  const useMetric: "rounds" | "matches" = metric === "rounds" && !hasRounds ? "matches" : metric;
  const valOf = (r: MapRow) => {
    if (useMetric === "matches") return r.winPct;
    const rp = roundWinPct(r.ms);
    return Number.isFinite(rp) ? rp : r.winPct;
  };
  return (
    <MapWinRadar
      rows={rows}
      metric={metric}
      setMetric={setMetric}
      useMetric={useMetric}
      hasRounds={hasRounds}
      valOf={valOf}
      embedded={embedded}
    />
  );
}

/**
 * MapStrength plots per-map win rate as a diverging dot chart on a Loss↔Win
 * axis (dot at the win rate, connected to 50%, sized by games). Click a map to
 * drill into the player's per-map detail — average rating + aim metrics and
 * their recent matches there. Window + queue filters scope it.
 */
export function MapStrength({ matches }: { matches: LeetifyRecentMatch[] }) {
  const maxBucket = Math.min(matches.length, 100);
  const buckets = Array.from(
    new Set([...[10, 20, 30, 50, 100].filter((b) => b < maxBucket), maxBucket]),
  ).sort((a, b) => a - b);

  const [bucket, setBucket] = useState(maxBucket);
  const [source, setSource] = useState<SourceKey>("all");
  const [open, setOpen] = useState<string | null>(null);
  // Match win rate is what players mean by "win %", so default there; rounds is
  // a click away. The metric drives the radar, the list, AND best/worst together
  // so they never disagree.
  const [metric, setMetric] = useState<"rounds" | "matches">("matches");

  const presentSources = useMemo(() => {
    const set = new Set(matches.map((m) => m.data_source));
    return SOURCES.filter((s) => s.key === "all" || set.has(s.key));
  }, [matches]);

  const { rows, total } = useMemo(() => {
    const scoped = matches
      .filter((m) => source === "all" || m.data_source === source)
      .slice(0, bucket);

    const byMap = new Map<string, LeetifyRecentMatch[]>();
    for (const m of scoped) {
      const key = m.map_name || "unknown";
      const arr = byMap.get(key);
      if (arr) arr.push(m);
      else byMap.set(key, [m]);
    }
    const list = [...byMap.entries()].map(([map, ms]) => {
      const w = ms.filter((m) => m.outcome === "win").length;
      return { map, ms, n: ms.length, w, l: ms.length - w, winPct: (w / ms.length) * 100 };
    });
    return { rows: list, total: scoped.length };
  }, [matches, bucket, source]);

  const hasRounds = useMemo(
    () => rows.some((r) => Number.isFinite(roundWinPct(r.ms))),
    [rows],
  );
  const useMetric: "rounds" | "matches" = metric === "rounds" && !hasRounds ? "matches" : metric;
  const valOf = (r: MapRow) => {
    if (useMetric === "matches") return r.winPct;
    const rp = roundWinPct(r.ms);
    return Number.isFinite(rp) ? rp : r.winPct;
  };
  const recordOf = (r: MapRow) => {
    if (useMetric === "matches") return `${r.w}-${r.l}`;
    const { won, lost } = roundRec(r.ms);
    return `${won}-${lost}`;
  };
  // reliable-first, then by the active metric — so the top of the list is the
  // same map best/worst calls out.
  const displayRows = [...rows].sort((a, b) => {
    const ra = a.n >= 3 ? 1 : 0;
    const rb = b.n >= 3 ? 1 : 0;
    if (ra !== rb) return rb - ra;
    return valOf(b) - valOf(a);
  });
  const reliableRows = rows.filter((r) => r.n >= 3);
  const best = reliableRows.length
    ? [...reliableRows].sort((a, b) => valOf(b) - valOf(a))[0]
    : null;
  const worst = reliableRows.length > 1
    ? [...reliableRows].sort((a, b) => valOf(a) - valOf(b))[0]
    : null;

  if (matches.length === 0) return null;

  const pool = rows.filter((r) => r.n >= 3);
  const strongMaps = pool.filter((r) => valOf(r) >= 55).length;
  const weakMaps = pool.filter((r) => valOf(r) < 45).length;

  const COLS = "grid grid-cols-[5rem_1fr_3.5rem_1.25rem] items-center gap-3";

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
          Map strengths{" "}
          <span className="text-faint">· {total} matches (Leetify)</span>
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {presentSources.length > 2 && (
            <div className="flex rounded-lg border border-line bg-panel p-0.5">
              {presentSources.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  aria-pressed={source === s.key}
                  onClick={() => setSource(s.key)}
                  className={`rounded-md px-2 py-0.5 text-xs font-medium transition ${
                    source === s.key ? "bg-brand/15 text-brand" : "text-muted hover:text-ink"
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
                aria-pressed={bucket === b}
                onClick={() => setBucket(b)}
                className={`rounded-md px-2 py-0.5 text-xs font-medium tabular-nums transition ${
                  bucket === b ? "bg-brand/15 text-brand" : "text-muted hover:text-ink"
                }`}
              >
                {b}
              </button>
            ))}
          </div>
        </div>
      </div>

      {(best || worst || pool.length > 0) && (
        <div className="mb-3 space-y-1.5">
          <div className="flex flex-wrap gap-2">
            {best && (
              <span className="pill bg-good/12 capitalize text-good">
                ▲ Best · {mapLabel(best.map)} {valOf(best).toFixed(0)}%
              </span>
            )}
            {worst && (
              <span className="pill bg-bad/12 capitalize text-bad">
                ▼ Toughest · {mapLabel(worst.map)} {valOf(worst).toFixed(0)}%
              </span>
            )}
          </div>
          {pool.length > 0 && (
            <div className="text-xs text-muted">
              Plays <span className="font-semibold text-ink">{pool.length}</span>{" "}
              maps regularly · <span className="text-good">{strongMaps} strong</span>{" "}
              · <span className="text-bad">{weakMaps} weak</span>
            </div>
          )}
        </div>
      )}

      <MapWinRadar
        rows={rows}
        metric={metric}
        setMetric={setMetric}
        useMetric={useMetric}
        hasRounds={hasRounds}
        valOf={valOf}
      />

      <div className="card-2 px-4 py-4">
        {rows.length === 0 ? (
          <div className="py-3 text-sm text-muted">No matches in this filter.</div>
        ) : (
          <>
            <div className={`${COLS} mb-2`}>
              <span />
              <div className="relative h-3 text-[10px] text-faint">
                <span className="absolute left-0">Loss</span>
                <span className="absolute left-1/2 -translate-x-1/2">50%</span>
                <span className="absolute right-0">Win</span>
              </div>
              <span className="text-right text-[10px] uppercase tracking-wider text-faint">
                Win
              </span>
              <span />
            </div>

            <div className="space-y-0.5">
              {displayRows.map((r) => {
                const pct = valOf(r);
                const wc = winColor(pct);
                const dim = r.n < 3;
                const lo = Math.min(pct, 50);
                const w = Math.abs(pct - 50);
                const size = 9 + (Math.min(r.n, 25) / 25) * 7;
                const isOpen = open === r.map;
                return (
                  <div key={r.map}>
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : r.map)}
                      aria-expanded={isOpen}
                      className={`${COLS} w-full rounded-lg py-1.5 text-left transition-colors hover:bg-panel/50 ${isOpen ? "bg-panel/40" : ""}`}
                    >
                      <span className="truncate text-sm font-medium capitalize">
                        {mapLabel(r.map)}
                      </span>

                      <div className="relative h-5">
                        <span className="absolute left-1/4 top-0 h-full w-px bg-line/40" />
                        <span className="absolute right-1/4 top-0 h-full w-px bg-line/40" />
                        <span
                          className="absolute left-1/2 top-0 h-full"
                          style={{ borderLeft: "1px dashed var(--color-line2)" }}
                        />
                        <span
                          className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full"
                          style={{
                            left: `${lo}%`,
                            width: `${w}%`,
                            background: wc,
                            opacity: dim ? 0.3 : 0.5,
                          }}
                        />
                        <span
                          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-bg"
                          style={{
                            left: `${pct}%`,
                            width: size,
                            height: size,
                            background: wc,
                            boxShadow: `0 0 10px -1px ${wc}`,
                            opacity: dim ? 0.55 : 1,
                          }}
                        />
                      </div>

                      <span className="text-right">
                        <span className="text-sm font-bold tabular-nums" style={{ color: wc }}>
                          {pct.toFixed(0)}%
                        </span>
                        <span className="block text-[10px] tabular-nums text-faint">
                          {recordOf(r)}
                        </span>
                      </span>

                      <svg
                        className={`h-4 w-4 justify-self-end text-faint transition-transform ${isOpen ? "rotate-180" : ""}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>

                    {isOpen && <MapDetail ms={r.ms} map={r.map} />}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      <div className="mt-1.5 text-[10px] text-faint">
        click a map for per-map detail · bigger dot = more games · dashed line = 50%
      </div>
    </section>
  );
}
