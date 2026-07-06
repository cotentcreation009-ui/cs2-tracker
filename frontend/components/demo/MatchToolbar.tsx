"use client";

import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";

const CT = "#5b9dff";
const T = "#e7b53c";

export type SideFilter = "all" | "CT" | "T";

// Shared, viewer-level selection that every lens reacts to. Picking a player
// focuses all lenses on them; picking a round scopes them; side filters T/CT.
export interface DemoView {
  focusPlayer: number | null; // player index, or null = everyone
  scopeRound: number | null; // round index, or null = whole match
  side: SideFilter;
  setFocusPlayer: (i: number | null) => void;
  setScopeRound: (i: number | null) => void;
  setSide: (s: SideFilter) => void;
}

function teamHex(team: ReplayMeta["players"][number]["team"]) {
  return team === "T" ? T : team === "CT" ? CT : "var(--color-faint)";
}

/**
 * Persistent control bar rendered above the lens tabs. It replaces the
 * per-lens player/round/side pickers so the controls stay in one place and a
 * selection carries across every lens.
 */
export function MatchToolbar({
  meta,
  rounds,
  view,
  showSide = true,
}: {
  meta: ReplayMeta;
  rounds: ReplayRound[];
  view: DemoView;
  showSide?: boolean;
}) {
  return (
    // At lg+ (viewport-locked workspace) both rows stay single-line — pills
    // scroll horizontally instead of wrapping, so the toolbar height is fixed.
    <div className="card-2 flex shrink-0 flex-col gap-2.5 px-3 py-2.5 lg:gap-2 lg:py-2">
      {/* players */}
      <div className="flex items-start gap-2 lg:items-center">
        <span className="stat-label mt-1 w-12 shrink-0 lg:mt-0">Player</span>
        <div className="flex flex-wrap gap-1 lg:min-w-0 lg:flex-1 lg:flex-nowrap lg:overflow-x-auto lg:pb-0.5">
          <button
            type="button"
            onClick={() => view.setFocusPlayer(null)}
            className={`pill shrink-0 transition ${
              view.focusPlayer === null
                ? "bg-brand/15 text-brand ring-1 ring-brand/40"
                : "bg-panel text-muted hover:text-ink"
            }`}
          >
            All
          </button>
          {meta.players.map((p, i) => {
            const hex = teamHex(p.team);
            const active = view.focusPlayer === i;
            return (
              <button
                key={i}
                type="button"
                onClick={() => view.setFocusPlayer(active ? null : i)}
                className={`pill max-w-36 shrink-0 truncate transition ${
                  active ? "ring-1 ring-brand/50" : "hover:text-ink"
                }`}
                style={{
                  background: active ? `${hex}22` : "var(--color-panel)",
                  color: active ? hex : "var(--color-muted)",
                }}
              >
                <span
                  className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                  style={{ background: hex }}
                />
                {p.name || `P${i + 1}`}
              </button>
            );
          })}
        </div>
      </div>

      {/* rounds + side */}
      <div className="flex items-start gap-2 lg:items-center">
        <span className="stat-label mt-1 w-12 shrink-0 lg:mt-0">Round</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 lg:flex-nowrap lg:overflow-x-auto lg:pb-0.5">
          <button
            type="button"
            onClick={() => view.setScopeRound(null)}
            className={`mr-1 shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold transition ${
              view.scopeRound === null
                ? "bg-brand/15 text-brand"
                : "text-muted hover:text-ink"
            }`}
          >
            All
          </button>
          {rounds.map((r, i) => {
            const active = view.scopeRound === i;
            return (
              <button
                key={i}
                type="button"
                onClick={() => view.setScopeRound(active ? null : i)}
                title={`Round ${r.n}${r.winner ? ` · ${r.winner} win` : ""}`}
                className={`h-6 w-6 shrink-0 rounded text-[10px] font-bold tabular-nums transition ${
                  active
                    ? "ring-2 ring-brand"
                    : r.winner === "CT"
                      ? "bg-[#5b9dff]/20 text-[#9cc1ff]"
                      : r.winner === "T"
                        ? "bg-[#e7b53c]/20 text-[#f0cd78]"
                        : "bg-panel text-muted"
                }`}
              >
                {r.n}
              </button>
            );
          })}

          {showSide && (
            <div className="ml-auto flex shrink-0 rounded-lg border border-line bg-panel p-0.5">
              {(["all", "CT", "T"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => view.setSide(s)}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                    view.side === s ? "bg-brand/15 text-brand" : "text-muted hover:text-ink"
                  }`}
                >
                  {s === "all" ? "Both" : s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
