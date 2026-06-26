"use client";

import { useMemo, useState } from "react";
import type { LeetifyRecentMatch } from "@/lib/types";
import { mapLabel, timeAgo } from "@/lib/format";

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

  const presentSources = useMemo(() => {
    const set = new Set(matches.map((m) => m.data_source));
    return SOURCES.filter((s) => s.key === "all" || set.has(s.key));
  }, [matches]);

  const { rows, total, best, worst } = useMemo(() => {
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
    list.sort((a, b) => {
      const ra = a.n >= 3 ? 1 : 0;
      const rb = b.n >= 3 ? 1 : 0;
      if (ra !== rb) return rb - ra;
      return b.winPct - a.winPct;
    });
    const reliable = list.filter((r) => r.n >= 3);
    return {
      rows: list,
      total: scoped.length,
      best: reliable[0] ?? null,
      worst: reliable.length > 1 ? reliable[reliable.length - 1] : null,
    };
  }, [matches, bucket, source]);

  if (matches.length === 0) return null;

  const pool = rows.filter((r) => r.n >= 3);
  const strongMaps = pool.filter((r) => r.winPct >= 55).length;
  const weakMaps = pool.filter((r) => r.winPct < 45).length;

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
                ▲ Best · {mapLabel(best.map)} {best.winPct.toFixed(0)}%
              </span>
            )}
            {worst && (
              <span className="pill bg-bad/12 capitalize text-bad">
                ▼ Toughest · {mapLabel(worst.map)} {worst.winPct.toFixed(0)}%
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
              {rows.map((r) => {
                const wc = winColor(r.winPct);
                const dim = r.n < 3;
                const lo = Math.min(r.winPct, 50);
                const w = Math.abs(r.winPct - 50);
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
                            left: `${r.winPct}%`,
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
                          {r.winPct.toFixed(0)}%
                        </span>
                        <span className="block text-[10px] tabular-nums text-faint">
                          {r.w}-{r.l}
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
