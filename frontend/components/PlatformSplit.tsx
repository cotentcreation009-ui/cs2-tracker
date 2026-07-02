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
  {
    label: "Win rate",
    get: (s) => s.winPct,
    fmt: (v) => `${v.toFixed(0)}%`,
    dir: "high",
    diverge: 15,
  },
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

const COL_ORDER = ["premier", "matchmaking", "faceit"];

/**
 * PlatformSplit shows a player's recent-match performance broken out by
 * platform — Premier / MM (Valve) beside FACEIT — so a lopsided player (sharp
 * on one, ordinary on the other) is obvious at a glance. The headline verdict
 * reuses the CheatMeter's cross-platform rating gap (Valve − FACEIT): a big
 * Valve-over-FACEIT edge is a classic "look closer" tell, since cheats/boosts
 * rarely survive FACEIT's kernel anti-cheat.
 */
export function PlatformSplit({ matches }: { matches: LeetifyRecentMatch[] }) {
  const split = computePlatformSplit(matches);
  if (split.stats.length === 0) return null; // no recognizable platform data at all

  const cols = [...split.stats].sort(
    (a, b) => COL_ORDER.indexOf(a.key) - COL_ORDER.indexOf(b.key),
  );
  const gap = split.ratingGap ?? 0;

  const banner = {
    consistent: {
      wrap: "border-good/25 bg-good/[0.06]",
      accent: "text-good",
      tag: "✓ Consistent",
      title: "Performance lines up across platforms",
      body: "Their Valve and FACEIT numbers are in the same range — no cross-platform red flag.",
    },
    "stronger-valve": {
      wrap: "border-bad/30 bg-bad/[0.07]",
      accent: "text-bad",
      tag: "⚠ Look closer",
      title: `Much sharper on Valve than FACEIT — rating ${fmtRating(gap)} higher`,
      body: "Cheats and boosts often don't survive FACEIT's kernel anti-cheat, so a big Valve-over-FACEIT gap is a classic tell worth a closer look (not proof — tick-rate and effort differ too).",
    },
    "stronger-faceit": {
      wrap: "border-mid/30 bg-mid/[0.07]",
      accent: "text-mid",
      tag: "Note",
      title: `Stronger on FACEIT than Valve — rating ${fmtRating(-gap)} higher on FACEIT`,
      body: "Usually just a more serious player on FACEIT (tougher lobbies, historically 128-tick) — not itself a red flag.",
    },
    insufficient: {
      wrap: "border-line bg-panel/40",
      accent: "text-muted",
      tag: "Compare yourself",
      title:
        cols.length >= 2
          ? "Not enough matches on both platforms for an automatic verdict yet"
          : "Only one platform in the recent window — no second side to compare against yet",
      body: "The per-platform numbers are below — eyeball them to spot anything lopsided.",
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
          Premier / MM vs FACEIT — same player, different anti-cheat
        </span>
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
            const goods = cells.filter((x) => x.valid).map((x) => (m.dir === "high" ? x.v : -x.v));
            if (goods.length === 0) return null;
            const maxG = Math.max(...goods);
            const minG = Math.min(...goods);
            const raw = cells.filter((x) => x.valid).map((x) => x.v);
            const spread = Math.max(...raw) - Math.min(...raw);
            // only flag divergence when we have enough matches on both sides to
            // trust it — otherwise a 1-match average would fire false alarms.
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
                    {diverges && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-mid" title="platforms diverge here" />}
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
        Averages over each platform&apos;s recent matches (from Leetify). A large
        Valve-over-FACEIT gap is a &quot;look closer&quot; signal, not proof —
        lobby strength, tick-rate and how seriously someone plays each platform
        differ too.
      </p>
    </section>
  );
}
