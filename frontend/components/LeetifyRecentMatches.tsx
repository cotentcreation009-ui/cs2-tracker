"use client";

import { useState, type ReactNode } from "react";
import type { LeetifyRecentMatch } from "@/lib/types";
import { mapLabel, premierHex, timeAgo } from "@/lib/format";
import { AnalyzeDemoButton } from "@/components/AnalyzeDemoButton";

// Queue identity: Premier and Competitive both arrive as data_source
// "matchmaking" — rank_type is what actually distinguishes them (11 = Premier,
// 12 = Competitive), so labels/colors key off that first.
function sourceInfo(m: LeetifyRecentMatch): { label: string; cls: string } {
  if (m.rank_type === 11)
    return { label: "Premier", cls: "border-[#8a7dff]/40 bg-[#8a7dff]/10 text-[#b8a5ff]" };
  if (m.data_source === "faceit")
    return { label: "FACEIT", cls: "border-[#ff5500]/40 bg-[#ff5500]/10 text-[#ff8a50]" };
  if (m.rank_type === 12)
    return { label: "Comp", cls: "border-brand/40 bg-brand/10 text-brand" };
  if (m.data_source === "matchmaking_wingman" || m.data_source === "wingman")
    return { label: "Wingman", cls: "border-line bg-panel text-muted" };
  const fallback: Record<string, string> = { matchmaking: "MM", renown: "Renown", esportal: "Esportal" };
  return { label: fallback[m.data_source] || m.data_source, cls: "border-line bg-panel text-muted" };
}

// Valve's 18 competitive skill groups (rank_type 12's rank value).
const COMP_RANKS = [
  "Silver 1", "Silver 2", "Silver 3", "Silver 4", "Silver Elite", "Silver Elite Master",
  "Gold Nova 1", "Gold Nova 2", "Gold Nova 3", "Gold Nova Master",
  "Master Guardian 1", "Master Guardian 2", "Master Guardian Elite", "Distinguished Master Guardian",
  "Legendary Eagle", "Legendary Eagle Master", "Supreme Master First Class", "Global Elite",
];
// the in-game abbreviations, for the narrow rank column
const COMP_SHORT = [
  "S1", "S2", "S3", "S4", "SE", "SEM",
  "GN1", "GN2", "GN3", "GNM",
  "MG1", "MG2", "MGE", "DMG",
  "LE", "LEM", "SMFC", "GE",
];

const FACEIT_HEX = "#ff8a50";

// One rating badge, tinted with its own tier colour — a Premier rating that
// crosses a bracket mid-run genuinely changes colour, exactly as in game.
function RankChip({
  text,
  hex,
  dim = false,
  title,
}: {
  text: string;
  hex: string;
  dim?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`shrink-0 rounded px-1 py-px text-[10px] font-bold tabular-nums ${dim ? "opacity-65" : ""}`}
      style={{ background: `${hex}1f`, color: hex, boxShadow: `inset 0 0 0 1px ${hex}3d` }}
    >
      {text}
    </span>
  );
}

// The rank column: where the game started you → where it left you, then the
// change itself. Games Leetify never rated show a neutral placeholder rather
// than an empty cell, so the column always reads as a column.
function RankCell({ m }: { m: LeetifyRecentMatch }) {
  const delta = m.rank_delta;
  const isPremier = m.rank_type === 11;
  const isFaceit = m.data_source === "faceit";
  const before = m.rank_before ?? 0;
  const after = isPremier ? (m.rank ?? 0) : isFaceit ? (m.elo ?? 0) : 0;
  const hexOf = (v: number) => (isPremier ? premierHex(v) : FACEIT_HEX);
  const ladderName = isPremier ? "Premier rating" : "FACEIT elo";

  // the delta always occupies the same slot so every row's ± lines up
  const deltaSlot =
    delta != null ? (
      <span className={`w-10 shrink-0 text-right text-[11px] font-semibold tabular-nums ${deltaColor(delta)}`}>
        {signedInt(delta)}
      </span>
    ) : (
      <span className="w-10 shrink-0" />
    );

  if ((isPremier || isFaceit) && after > 0) {
    return (
      <span className="flex items-center justify-end gap-1">
        {delta != null && before > 0 ? (
          <>
            <RankChip text={before.toLocaleString()} hex={hexOf(before)} dim title={`${ladderName} before this game`} />
            <span aria-hidden className="shrink-0 text-[10px] text-faint">
              →
            </span>
          </>
        ) : null}
        <RankChip
          text={after.toLocaleString()}
          hex={hexOf(after)}
          title={
            delta != null
              ? `${ladderName}: ${before.toLocaleString()} → ${after.toLocaleString()}`
              : `${ladderName} after this game — Leetify didn't record the change`
          }
        />
        {deltaSlot}
      </span>
    );
  }

  // no ladder number for this game: FACEIT level, a Competitive skill group,
  // or a queue with no rating at all
  const level = isFaceit ? (m.rank ?? 0) : 0;
  const comp = m.rank_type === 12 && (m.rank ?? 0) >= 1 && (m.rank ?? 0) <= 18 ? (m.rank ?? 1) - 1 : -1;
  return (
    <span className="flex items-center justify-end gap-1">
      {level > 0 ? (
        <RankChip text={`Lvl ${level}`} hex={FACEIT_HEX} title="FACEIT level" />
      ) : comp >= 0 ? (
        <RankChip text={COMP_SHORT[comp]} hex="#38d6ff" title={COMP_RANKS[comp]} />
      ) : (
        <span
          className="shrink-0 rounded bg-line/40 px-1 py-px text-[10px] font-bold text-faint"
          title="No rating recorded for this game"
        >
          —
        </span>
      )}
      {deltaSlot}
    </span>
  );
}

// Per-game leetify_rating arrives as a raw fraction (0.0434); Leetify's own
// site displays it x100 ("+4.34"), matching the overall ranks.leetify scale.
function signed(n: number): string {
  const v = n * 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
}
const impactColor = (n: number) =>
  n > 0.03 ? "text-good" : n < -0.03 ? "text-bad" : "text-mid";

// Friends-only Leetify profiles redact per-match aim detail (it comes back as
// 0). A 0 here means "hidden", so show a dash rather than "0.0%".
const dash = (v: number, fmt: (n: number) => string) => (v > 0 ? fmt(v) : "—");

// The ladder number this game moved, if any. `value` is the rating AFTER the
// game; `ladder` marks the ones that carry a before→after movement (Premier
// rating and FACEIT elo) as opposed to static context (level, comp rank).
function rankAfter(
  m: LeetifyRecentMatch,
): { label: string; value: string; ladder: boolean } | null {
  if (m.rank_type === 11 && (m.rank ?? 0) > 0)
    return { label: "Premier rating", value: (m.rank ?? 0).toLocaleString(), ladder: true };
  if (m.data_source === "faceit" && (m.elo ?? 0) > 0)
    return { label: "FACEIT elo", value: (m.elo ?? 0).toLocaleString(), ladder: true };
  if (m.data_source === "faceit" && (m.rank ?? 0) > 0)
    return { label: "FACEIT level", value: String(m.rank), ladder: false };
  if (m.rank_type === 12 && (m.rank ?? 0) >= 1 && (m.rank ?? 0) <= 18)
    return { label: "Comp rank", value: COMP_RANKS[(m.rank ?? 1) - 1], ladder: false };
  return null;
}

const deltaColor = (d: number) => (d > 0 ? "text-good" : d < 0 ? "text-bad" : "text-muted");
const signedInt = (d: number) => `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d)}`;

// Column widths + row padding shared by the header and every row, so the
// labels always sit over the numbers they describe.
const ROW_PAD = "gap-1.5 px-2 py-2 sm:gap-3 sm:px-3";
const COL = {
  badge: "w-5",
  map: "w-14 sm:w-20",
  score: "w-11 sm:w-12",
  kd: "w-13 sm:w-15",
  rating: "w-12 sm:w-14",
  // fits "25,730 → 26,160  +430" — before badge, arrow, after badge, change
  delta: "sm:w-38",
  queue: "w-14 sm:w-17",
};

function Stat({
  label,
  value,
  valueHex,
  sub,
}: {
  label: string;
  value: ReactNode;
  valueHex?: string;
  sub?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-line bg-panel px-2.5 py-1.5">
      <div className="stat-label">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums" style={valueHex ? { color: valueHex } : undefined}>
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-[10px] leading-tight tabular-nums">{sub}</div> : null}
    </div>
  );
}

/**
 * LeetifyRecentMatches renders the Leetify recent-match list with click-to-expand
 * rows: queue chip (Premier/Comp/FACEIT), score, K-D, per-game Leetify rating,
 * Premier-rating/FACEIT-elo change, and an expandable per-match stat panel.
 */
export function LeetifyRecentMatches({
  matches,
  steamId,
}: {
  matches: LeetifyRecentMatch[];
  steamId: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (matches.length === 0) return null;

  return (
    <div className="mt-5">
      <div className="stat-label mb-2">Recent matches (Leetify)</div>
      <div className="overflow-hidden rounded-lg border border-line">
        {/* column headers — four similar-looking numbers per row are
            unreadable without labels; widths are shared with the rows below
            via COL so the two can never drift apart */}
        <div
          aria-hidden
          className={`flex items-center border-b border-line bg-panel/60 text-[9px] font-semibold uppercase tracking-wider text-faint ${ROW_PAD}`}
        >
          <span className={`${COL.badge} shrink-0`} />
          <span className={`${COL.map} shrink-0`}>Map</span>
          <span className={`${COL.score} shrink-0 text-right`}>Score</span>
          <span className={`${COL.kd} hidden shrink-0 text-right sm:inline`}>K / D</span>
          <span className={`${COL.rating} shrink-0 text-right`} title="Leetify's rating for the game">
            Leetify
          </span>
          <span
            className={`${COL.delta} hidden shrink-0 text-right sm:inline`}
            title="Premier rating / FACEIT elo before and after this game, and the change"
          >
            Rank before → after
          </span>
          <span className={`${COL.queue} shrink-0 text-center`}>Queue</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            When
            <span className="w-3.5" />
          </span>
        </div>

        {matches.map((m, i) => {
          const key = m.id || String(i);
          const won = m.outcome === "win";
          const tie = m.outcome === "tie";
          const isOpen = open === key;
          const src = sourceInfo(m);
          // Go omits zero values, so a genuine 0-kill game arrives with no
          // `kills` field — default before formatting or the row renders
          // "undefined-7".
          const kills = m.kills ?? 0;
          const deaths = m.deaths ?? 0;
          const hasKD = kills + deaths > 0;
          const kdDiff = kills - deaths;
          const delta = m.rank_delta;
          const after = rankAfter(m);
          const afterHex =
            after?.label === "Premier rating" ? premierHex(m.rank ?? 0) : undefined;
          return (
            <div key={key} className={i % 2 ? "bg-panel/40" : ""}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : key)}
                aria-expanded={isOpen}
                className={`relative flex w-full items-center text-left text-sm transition hover:bg-panel2 ${ROW_PAD}`}
              >
                {/* outcome edge + badge */}
                <span
                  aria-hidden
                  className={`absolute inset-y-0 left-0 w-0.5 ${tie ? "bg-mid/50" : won ? "bg-good/50" : "bg-bad/50"}`}
                />
                <span
                  className={`${COL.badge} grid h-5 shrink-0 place-items-center rounded text-[11px] font-bold ${
                    tie
                      ? "bg-mid/20 text-mid"
                      : won
                        ? "bg-good/20 text-good"
                        : "bg-bad/20 text-bad"
                  }`}
                >
                  {tie ? "T" : won ? "W" : "L"}
                </span>
                <span className={`${COL.map} shrink-0 truncate font-medium capitalize`}>
                  {mapLabel(m.map_name)}
                </span>
                {/* rounds use an en dash, K/D a slash — so two "N to N" pairs
                    never read as the same stat */}
                <span className={`${COL.score} shrink-0 whitespace-nowrap text-right tabular-nums text-muted`}>
                  {m.score?.length === 2 ? `${m.score[0]}–${m.score[1]}` : "—"}
                </span>
                {/* kills bright, deaths dim — structural, not evaluative, so
                    the only two colour-coded columns are the ones that judge
                    the game (Leetify rating and rank movement) */}
                <span
                  className={`${COL.kd} hidden shrink-0 whitespace-nowrap text-right tabular-nums sm:inline`}
                  title={
                    hasKD
                      ? `${kills} kills, ${deaths} deaths (${kdDiff >= 0 ? "+" : "−"}${Math.abs(kdDiff)})`
                      : "Kills and deaths unavailable for this game"
                  }
                >
                  {hasKD ? (
                    <>
                      <span className="font-semibold text-ink">{kills}</span>
                      <span className="mx-0.5 text-faint">/</span>
                      <span className="text-muted">{deaths}</span>
                    </>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </span>
                <span
                  className={`${COL.rating} shrink-0 text-right tabular-nums ${impactColor(m.leetify_rating)}`}
                  title="Leetify rating for this game"
                >
                  {signed(m.leetify_rating)}
                </span>
                <span className={`${COL.delta} hidden shrink-0 sm:block`}>
                  <RankCell m={m} />
                </span>
                <span className={`${COL.queue} shrink-0 text-center`}>
                  <span
                    className={`inline-flex w-full justify-center rounded-full border px-1 py-0.5 text-[10px] font-semibold ${src.cls}`}
                  >
                    {src.label}
                  </span>
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-faint sm:gap-2">
                  {/* "1d" on phones, "1d ago" once there's room */}
                  <span className="sm:hidden">{timeAgo(m.finished_at).replace(" ago", "")}</span>
                  <span className="hidden sm:inline">{timeAgo(m.finished_at)}</span>
                  <svg
                    className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </span>
              </button>

              {isOpen && (
                <div className="border-t border-line bg-bg/40 px-3 py-3">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat
                      label="K-D"
                      value={
                        hasKD
                          ? `${m.kills}-${m.deaths}${(m.deaths ?? 0) > 0 ? ` (${((m.kills ?? 0) / (m.deaths ?? 1)).toFixed(2)})` : ""}`
                          : "—"
                      }
                    />
                    {after ? (
                      <Stat
                        label={after.label}
                        // before → after is the whole point: where the game
                        // started you and where it left you
                        value={
                          delta != null ? (
                            <span className="text-[13px]">
                              <span className="font-normal text-muted">
                                {(m.rank_before ?? 0).toLocaleString()}
                              </span>
                              <span className="mx-1 text-faint">→</span>
                              <span style={afterHex ? { color: afterHex } : undefined}>{after.value}</span>
                            </span>
                          ) : (
                            after.value
                          )
                        }
                        valueHex={delta == null ? afterHex : undefined}
                        sub={
                          delta != null ? (
                            <span className={`font-semibold ${deltaColor(delta)}`}>
                              {signedInt(delta)}
                            </span>
                          ) : after.ladder ? (
                            <span className="text-faint">change not recorded</span>
                          ) : null
                        }
                      />
                    ) : (
                      <Stat label="Queue" value={src.label} />
                    )}
                    <Stat label="Leetify rating" value={signed(m.leetify_rating)} />
                    <Stat label="HS accuracy" value={dash(m.accuracy_head, (v) => `${v.toFixed(1)}%`)} />
                    <Stat
                      label="Spotted accuracy"
                      value={dash(m.accuracy_enemy_spotted, (v) => `${v.toFixed(0)}%`)}
                    />
                    <Stat label="Spray" value={dash(m.spray_accuracy, (v) => `${v.toFixed(0)}%`)} />
                    <Stat label="Preaim" value={dash(m.preaim, (v) => `${v.toFixed(1)}°`)} />
                    <Stat
                      label="Reaction"
                      value={dash(m.reaction_time_ms, (v) => `${v.toFixed(0)} ms`)}
                    />
                  </div>
                  {m.id && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-3">
                      <AnalyzeDemoButton
                        gameId={m.id}
                        steamId={steamId}
                        dataSource={m.data_source}
                        finishedAt={m.finished_at}
                        mapName={m.map_name}
                        score={m.score}
                      />
                      <a
                        href={`https://leetify.com/app/match-details/${m.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-brand hover:underline"
                      >
                        View full match on Leetify ↗
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-[10px] text-faint">
        Rank shows the Premier rating / FACEIT elo you carried into the game → what you left with,
        and the change. Badges carry the in-game tier colour, so a rating crossing a bracket
        changes colour too. Leetify doesn&apos;t record a rating on every game; those show a single
        badge or a dash rather than a change stretched across several games. K-D per game via
        Leetify.
      </p>
    </div>
  );
}
