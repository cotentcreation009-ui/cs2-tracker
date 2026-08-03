"use client";

import { useState } from "react";
import type { LeetifyRecentMatch } from "@/lib/types";
import { mapLabel, timeAgo } from "@/lib/format";
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

// "Rating after this game" context for the elo-delta chip + expanded stat.
function rankAfter(m: LeetifyRecentMatch): { label: string; value: string } | null {
  if (m.rank_type === 11 && (m.rank ?? 0) > 0)
    return { label: "Premier rating", value: (m.rank ?? 0).toLocaleString() };
  if (m.data_source === "faceit" && (m.elo ?? 0) > 0)
    return { label: "FACEIT elo", value: (m.elo ?? 0).toLocaleString() };
  if (m.data_source === "faceit" && (m.rank ?? 0) > 0)
    return { label: "FACEIT level", value: String(m.rank) };
  if (m.rank_type === 12 && (m.rank ?? 0) >= 1 && (m.rank ?? 0) <= 18)
    return { label: "Comp rank", value: COMP_RANKS[(m.rank ?? 1) - 1] };
  return null;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-panel px-2.5 py-1.5">
      <div className="stat-label">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
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
        {matches.map((m, i) => {
          const key = m.id || String(i);
          const won = m.outcome === "win";
          const tie = m.outcome === "tie";
          const isOpen = open === key;
          const src = sourceInfo(m);
          const hasKD = (m.kills ?? 0) + (m.deaths ?? 0) > 0;
          const kdDiff = (m.kills ?? 0) - (m.deaths ?? 0);
          const delta = m.rank_delta;
          const after = rankAfter(m);
          return (
            <div key={key} className={i % 2 ? "bg-panel/40" : ""}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : key)}
                aria-expanded={isOpen}
                className="relative flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm transition hover:bg-panel2 sm:gap-3 sm:px-3"
              >
                {/* outcome edge + badge */}
                <span
                  aria-hidden
                  className={`absolute inset-y-0 left-0 w-0.5 ${tie ? "bg-mid/50" : won ? "bg-good/50" : "bg-bad/50"}`}
                />
                <span
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded text-[11px] font-bold ${
                    tie
                      ? "bg-mid/20 text-mid"
                      : won
                        ? "bg-good/20 text-good"
                        : "bg-bad/20 text-bad"
                  }`}
                >
                  {tie ? "T" : won ? "W" : "L"}
                </span>
                <span className="w-16 shrink-0 truncate font-medium capitalize sm:w-18">
                  {mapLabel(m.map_name)}
                </span>
                <span className="w-11 shrink-0 whitespace-nowrap tabular-nums text-muted sm:w-12">
                  {m.score?.length === 2 ? `${m.score[0]}–${m.score[1]}` : ""}
                </span>
                <span
                  className={`hidden w-14 shrink-0 tabular-nums sm:inline ${
                    hasKD ? (kdDiff > 0 ? "text-good" : kdDiff < 0 ? "text-bad" : "text-ink") : "text-faint"
                  }`}
                  title={hasKD ? `${m.kills} kills / ${m.deaths} deaths` : "Kills–deaths unavailable for this game"}
                >
                  {hasKD ? `${m.kills}-${m.deaths}` : "—"}
                </span>
                <span
                  className={`w-13 shrink-0 tabular-nums ${impactColor(m.leetify_rating)}`}
                  title="Leetify rating for this game"
                >
                  {signed(m.leetify_rating)}
                </span>
                <span
                  className={`hidden w-12 shrink-0 tabular-nums sm:inline ${
                    delta != null ? (delta > 0 ? "text-good" : delta < 0 ? "text-bad" : "text-muted") : "text-faint/50"
                  }`}
                  title={
                    delta != null && after
                      ? `${after.label} change vs your previous game (${after.value} after this one)`
                      : undefined
                  }
                >
                  {delta != null ? `${delta > 0 ? "+" : ""}${delta}` : ""}
                </span>
                <span className={`pill inline-flex shrink-0 border text-[10px] font-semibold ${src.cls}`}>
                  {src.label}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-faint">
                  {timeAgo(m.finished_at)}
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
                        value={`${after.value}${delta != null ? ` (${delta > 0 ? "+" : ""}${delta})` : ""}`}
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
        Rating changes compare each game to your previous game in the same queue — Premier rating
        points or FACEIT elo. K-D per game via Leetify.
      </p>
    </div>
  );
}
