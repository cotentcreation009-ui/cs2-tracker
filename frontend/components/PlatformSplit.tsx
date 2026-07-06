"use client";

import { useState } from "react";
import type { LeetifyRecentMatch } from "@/lib/types";
import {
  computePlatformSplit,
  type PlatformStat,
  GAP_THRESHOLD,
  MIN_N,
} from "@/lib/platformSplit";

const fmtRating = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;

interface Metric {
  label: string;
  hint?: string;
  get: (s: PlatformStat) => number;
  fmt: (v: number) => string;
  dir: "high" | "low"; // which direction is better
  diverge: number; // raw spread (in the metric's own units) that reads as notable
  zeroMissing?: boolean; // treat 0 as "no data" (aim metrics), not a real value
}

const METRICS: Metric[] = [
  {
    label: "Leetify rating",
    hint: "overall performance",
    get: (s) => s.avgRating,
    fmt: fmtRating,
    dir: "high",
    diverge: GAP_THRESHOLD,
  },
  { label: "Win rate", get: (s) => s.winPct, fmt: (v) => `${v.toFixed(0)}%`, dir: "high", diverge: 15 },
  {
    label: "Crosshair placement",
    hint: "lower = tighter pre-aim",
    get: (s) => s.avgPreaim,
    fmt: (v) => (v > 0 ? `${v.toFixed(1)}°` : "—"),
    dir: "low",
    diverge: 2,
    zeroMissing: true,
  },
  {
    label: "Reaction time",
    hint: "time to damage — lower = faster",
    get: (s) => s.avgReaction,
    fmt: (v) => (v > 0 ? `${v.toFixed(0)}ms` : "—"),
    dir: "low",
    diverge: 40,
    zeroMissing: true,
  },
  {
    label: "HS accuracy",
    get: (s) => s.avgHs,
    fmt: (v) => (v > 0 ? `${v.toFixed(0)}%` : "—"),
    dir: "high",
    diverge: 8,
    zeroMissing: true,
  },
  {
    label: "Spray accuracy",
    get: (s) => s.avgSpray,
    fmt: (v) => (v > 0 ? `${v.toFixed(0)}%` : "—"),
    dir: "high",
    diverge: 10,
    zeroMissing: true,
  },
];

/**
 * PlatformSplit compares a player's Premier matches against their FACEIT matches
 * side by side — same player, VAC vs FACEIT anti-cheat — so a lopsided player
 * (sharp on one, ordinary on the other) is obvious. A game-count filter
 * (10/20/50/100) sets how many recent games per platform are aggregated; FACEIT
 * is always surfaced when present, even if it's older than the Premier games.
 */
export function PlatformSplit({
  matches,
  faceitMatches,
  premierMatches,
}: {
  matches: LeetifyRecentMatch[];
  faceitMatches?: LeetifyRecentMatch[];
  premierMatches?: LeetifyRecentMatch[];
}) {
  const premierPool =
    premierMatches && premierMatches.length
      ? premierMatches
      : matches.filter((m) => m.rank_type === 11);
  const premierTotal = premierPool.length;
  const faceitPool =
    faceitMatches && faceitMatches.length
      ? faceitMatches
      : matches.filter((m) => m.data_source === "faceit");
  const faceitTotal = faceitPool.length;
  const maxAvail = Math.max(premierTotal, faceitTotal);

  const maxBucket = Math.min(maxAvail, 100);
  const buckets = Array.from(
    new Set([...[10, 20, 50].filter((b) => b < maxBucket), maxBucket]),
  ).sort((a, b) => a - b);
  const [limit, setLimit] = useState(maxBucket);

  if (premierTotal === 0 && faceitTotal === 0) return null; // no Premier or FACEIT games

  const split = computePlatformSplit(matches, faceitMatches, limit, premierMatches);
  const cols = [split.premier, split.faceit].filter(
    (c): c is PlatformStat => c != null,
  );
  if (cols.length === 0) return null;

  const gap = split.ratingGap ?? 0;

  const banner = {
    consistent: {
      wrap: "border-good/25 bg-good/[0.06]",
      accent: "text-good",
      tag: "✓ Consistent",
      title: "Performance lines up across Premier and FACEIT",
      body: "Their Premier and FACEIT numbers are in the same range — no cross-platform red flag.",
    },
    "stronger-premier": {
      wrap: "border-bad/30 bg-bad/[0.07]",
      accent: "text-bad",
      tag: "⚠ Look closer",
      title: `Much sharper on Premier than FACEIT — rating ${fmtRating(gap)} higher`,
      body: "Cheats and boosts often don't survive FACEIT's kernel anti-cheat, so a big Premier-over-FACEIT gap is a classic tell worth a closer look (not proof — tick-rate and effort differ too).",
    },
    "stronger-faceit": {
      wrap: "border-mid/30 bg-mid/[0.07]",
      accent: "text-mid",
      tag: "Note",
      title: `Stronger on FACEIT than Premier — rating ${fmtRating(-gap)} higher on FACEIT`,
      body: "Usually just a more serious player on FACEIT (tougher lobbies, historically 128-tick) — not itself a red flag.",
    },
    insufficient: {
      wrap: "border-line bg-panel/40",
      accent: "text-muted",
      tag:
        faceitTotal === 0
          ? "No FACEIT games"
          : premierTotal === 0
            ? "No Premier games"
            : "Compare yourself",
      title:
        faceitTotal === 0
          ? "No FACEIT matches on record — nothing to compare against"
          : premierTotal === 0
            ? "No Premier matches on record — nothing to compare against"
            : "Not enough games on both platforms for a reliable verdict yet",
      body:
        faceitTotal === 0
          ? "All of this player's tracked games are Premier. This view compares Premier vs FACEIT (different anti-cheats), so there's no second side to compare here."
          : premierTotal === 0
            ? "All of this player's tracked games are FACEIT — there are no Premier games to compare against."
            : "The per-platform numbers are below — eyeball them to spot anything lopsided.",
    },
  }[split.verdict];

  const gridCols = `minmax(6.5rem,1.1fr) ${cols.map(() => "minmax(0,1fr)").join(" ")}`;

  return (
    <section className="card-2 px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand/15 text-brand">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.9}>
            <path d="M7 4 3 8l4 4" />
            <path d="M3 8h14" />
            <path d="m17 20 4-4-4-4" />
            <path d="M21 16H7" />
          </svg>
        </span>
        <h2 className="text-lg font-extrabold tracking-tight">Platform split</h2>
        <span className="text-xs text-faint">
          Premier vs FACEIT — same player, different anti-cheat
        </span>
        {buckets.length > 1 && (
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-faint">Games</span>
            <div className="flex rounded-lg border border-line bg-panel p-0.5">
              {buckets.map((b) => (
                <button
                  key={b}
                  type="button"
                  aria-pressed={limit === b}
                  onClick={() => setLimit(b)}
                  className={`rounded-md px-2 py-0.5 text-xs font-medium tabular-nums transition ${
                    limit === b ? "bg-brand/15 text-brand" : "text-muted hover:text-ink"
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {banner && (
        <div className={`mb-3 rounded-xl border px-4 py-3 ${banner.wrap}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`pill bg-panel ${banner.accent}`}>{banner.tag}</span>
            <span className={`text-sm font-semibold ${banner.accent}`}>{banner.title}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted">{banner.body}</p>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-line">
        {/* column headers */}
        <div
          className="grid items-end gap-2 border-b border-line bg-panel/40 px-3 py-2"
          style={{ gridTemplateColumns: gridCols }}
        >
          <span className="stat-label">Metric</span>
          {cols.map((c) => (
            <div key={c.key} className="text-right">
              <div className="text-sm font-bold text-ink">{c.label}</div>
              <div className="text-[10px] text-faint">
                {c.n} match{c.n === 1 ? "" : "es"}
                {c.n < MIN_N ? " · small sample" : ""}
              </div>
            </div>
          ))}
        </div>

        {/* metric rows */}
        <ul>
          {METRICS.map((m) => {
            const cells = cols.map((c) => {
              const v = m.get(c);
              const valid = m.zeroMissing ? v > 0 : true;
              return { key: c.key, v, valid };
            });
            const goods = cells
              .filter((x) => x.valid)
              .map((x) => (m.dir === "high" ? x.v : -x.v));
            if (goods.length === 0) return null;
            const maxG = Math.max(...goods);
            const minG = Math.min(...goods);
            const raw = cells.filter((x) => x.valid).map((x) => x.v);
            const spread = Math.max(...raw) - Math.min(...raw);
            // only flag divergence when both sides have enough games to trust it
            const diverges =
              split.comparable && cells.filter((x) => x.valid).length >= 2 && spread > m.diverge;

            return (
              <li
                key={m.label}
                className={`grid items-center gap-2 border-t border-line/60 px-3 py-2 ${diverges ? "bg-mid/[0.05]" : ""}`}
                style={{ gridTemplateColumns: gridCols }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1 text-xs font-medium text-muted">
                    {m.label}
                    {diverges && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-mid" title="platforms diverge here" />
                    )}
                  </div>
                  {m.hint && <div className="text-[10px] leading-tight text-faint">{m.hint}</div>}
                </div>
                {cells.map((cell) => {
                  const good = m.dir === "high" ? cell.v : -cell.v;
                  const isBest = cell.valid && diverges && good === maxG;
                  const fill = !cell.valid
                    ? 0
                    : maxG === minG
                      ? 1
                      : 0.2 + 0.8 * ((good - minG) / (maxG - minG));
                  return (
                    <div key={cell.key} className="text-right">
                      <div
                        className={`text-sm tabular-nums ${
                          !cell.valid
                            ? "text-faint"
                            : isBest
                              ? "font-bold text-brand"
                              : "text-ink"
                        }`}
                      >
                        {m.fmt(cell.v)}
                      </div>
                      <div className="mt-1 ml-auto h-1 w-full max-w-[92px] overflow-hidden rounded-full bg-line/50">
                        <div
                          className={`h-full rounded-full ${isBest ? "bg-brand" : "bg-line2"}`}
                          style={{ width: `${Math.round(fill * 100)}%`, marginLeft: "auto" }}
                        />
                      </div>
                    </div>
                  );
                })}
              </li>
            );
          })}
        </ul>
      </div>

      <p className="mt-2 text-[11px] leading-snug text-faint">
        Premier (rank_type) vs FACEIT, averaged over each platform&apos;s recent
        matches from Leetify. A large Premier-over-FACEIT gap is a &quot;look
        closer&quot; signal, not proof — lobby strength, tick-rate and how
        seriously someone plays each platform differ too.
      </p>
    </section>
  );
}
