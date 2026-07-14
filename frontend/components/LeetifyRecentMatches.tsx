"use client";

import { useState } from "react";
import type { LeetifyRecentMatch } from "@/lib/types";
import { mapLabel, timeAgo } from "@/lib/format";
import { AnalyzeDemoButton } from "@/components/AnalyzeDemoButton";

const sourceLabel: Record<string, string> = {
  matchmaking: "MM",
  premier: "Premier",
  faceit: "FACEIT",
  wingman: "Wingman",
};

function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
}
const impactColor = (n: number) =>
  n > 0.03 ? "text-good" : n < -0.03 ? "text-bad" : "text-mid";

// Friends-only Leetify profiles redact per-match aim detail (it comes back as
// 0). A 0 here means "hidden", so show a dash rather than "0.0%".
const dash = (v: number, fmt: (n: number) => string) => (v > 0 ? fmt(v) : "—");

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
 * rows: each match reveals its per-match Leetify stats and a link to the full
 * match on Leetify. Client component because the expand state is interactive.
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
          return (
            <div key={key} className={i % 2 ? "bg-panel/40" : ""}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : key)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition hover:bg-panel2"
              >
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
                <span className="w-20 shrink-0 font-medium capitalize">
                  {mapLabel(m.map_name)}
                </span>
                <span className="w-14 shrink-0 tabular-nums text-muted">
                  {m.score?.length === 2 ? `${m.score[0]}–${m.score[1]}` : ""}
                </span>
                <span
                  className={`w-12 shrink-0 tabular-nums ${impactColor(m.leetify_rating)}`}
                >
                  {signed(m.leetify_rating)}
                </span>
                <span className="hidden shrink-0 text-xs text-faint sm:inline">
                  {sourceLabel[m.data_source] || m.data_source}
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
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
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
    </div>
  );
}
