"use client";

import { useMemo } from "react";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import { teamAStarters, roundWinnerTeam } from "@/lib/demo/score";

const CT = "#5b9dff";
const T = "#e7b53c";
const OTHER = "#8a93a5"; // concrete hex (not a CSS var) so `${hex}22` stays valid
// lightened "text on team tint" hues — the same soft pair the round chips and
// Both/CT/T segments use, so active text is consistent across the toolbar.
const SOFT: Record<string, string> = {
  [CT]: "#9cc1ff",
  [T]: "#f0cd78",
  [OTHER]: "#c3ccda",
};

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

// Hoisted so it isn't a fresh component identity on every MatchToolbar render
// (the toolbar re-renders each frame during replay playback — an inline
// component would remount all chips ~60x/s).
function PlayerChip({
  name,
  hex,
  active,
  onToggle,
}: {
  name: string;
  hex: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      title={`Focus ${name} across every tab`}
      className="flex max-w-36 shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition hover:brightness-110"
      style={{
        background: active ? `${hex}2e` : "var(--color-panel)",
        color: active ? (SOFT[hex] ?? "var(--color-ink)") : "var(--color-muted)",
        boxShadow: active ? `inset 0 0 0 1px ${hex}` : "inset 0 0 0 1px transparent",
      }}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: hex, boxShadow: active ? `0 0 6px ${hex}` : "none" }}
      />
      <span className="truncate">{name}</span>
    </button>
  );
}

/**
 * Persistent control bar for the demo workspace. Presents the two teams as
 * separate rosters (so you read CT vs T at a glance) and the rounds as a
 * score-flow timeline with a halftime divider. A player/round/side selection
 * made here carries across every lens.
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
  // split the roster into the two starting teams (identity is stable even
  // though sides swap at half); anything unteamed trails behind.
  const teams = useMemo(() => {
    const ct: { i: number; name: string }[] = [];
    const t: { i: number; name: string }[] = [];
    const other: { i: number; name: string }[] = [];
    meta.players.forEach((p, i) => {
      const entry = { i, name: p.name || `P${i + 1}` };
      if (p.team === "CT") ct.push(entry);
      else if (p.team === "T") t.push(entry);
      else other.push(entry);
    });
    return { ct, t, other };
  }, [meta.players]);

  // team identity (stable across side swaps) so the round strip is coloured by
  // TEAM, matching the header's team score rather than raw CT/T side wins.
  const teamA = useMemo(() => teamAStarters(rounds), [rounds]);

  // running team score AFTER each round — shown in the round chips' tooltips so
  // hovering the strip reads like a scoreline ("Round 7 · 5–2"). Mirrors
  // teamScore(): when the starting roster is unknown (older parses), fall back
  // to a raw side count so the tooltips agree with the header scoreline.
  const scoreAfter = useMemo(() => {
    let a = 0;
    let b = 0;
    const fallback = teamA.size === 0;
    return rounds.map((r) => {
      if (fallback) {
        if (r.winner === "CT") a++;
        else if (r.winner === "T") b++;
      } else {
        const tm = roundWinnerTeam(r, teamA);
        if (tm === "A") a++;
        else if (tm === "B") b++;
      }
      return { a, b };
    });
  }, [rounds, teamA]);

  // halftime = first round where the CT roster is what was the T roster at
  // round 0 (i.e. the sides have swapped). -1 when it can't be determined.
  const swapAt = useMemo(() => {
    const key = (arr?: number[]) => [...(arr ?? [])].sort((a, b) => a - b).join(",");
    const t0 = key(rounds[0]?.t);
    if (!t0) return -1;
    for (let i = 1; i < rounds.length; i++) {
      if (key(rounds[i]?.ct) === t0) return i;
    }
    return -1;
  }, [rounds]);

  const chip = (i: number, name: string, hex: string) => (
    <PlayerChip
      key={i}
      name={name}
      hex={hex}
      active={view.focusPlayer === i}
      onToggle={() => view.setFocusPlayer(view.focusPlayer === i ? null : i)}
    />
  );

  return (
    <div className="card-2 flex shrink-0 flex-col gap-2 px-3 py-2.5 lg:py-2">
      {/* players — the two rosters sit in team-tinted groups so CT vs T reads
          at a glance; the leading side tag doubles as that side's filter. The
          w-max inner wrapper centers the whole cluster when it fits and still
          scrolls correctly from the left edge when it overflows. */}
      <div className="scroll-slim overflow-x-auto pb-0.5">
        <div className="mx-auto flex w-max items-center gap-2">
          <button
            type="button"
            onClick={() => view.setFocusPlayer(null)}
            aria-pressed={view.focusPlayer === null}
            title="Show all players"
            className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold transition ${
              view.focusPlayer === null
                ? "bg-brand/15 text-brand ring-1 ring-inset ring-brand/40"
                : "bg-panel text-muted hover:text-ink"
            }`}
          >
            All
          </button>
          {/* CT roster */}
          {teams.ct.length > 0 && (
            <div
              className="flex shrink-0 items-center gap-1 rounded-lg py-0.5 pl-1.5 pr-1"
              style={{ background: "rgba(91,157,255,0.07)", boxShadow: "inset 0 0 0 1px rgba(91,157,255,0.16)" }}
            >
              <SideTag label="CT" hex={CT} active={view.side === "CT"} onClick={() => view.setSide(view.side === "CT" ? "all" : "CT")} enabled={showSide} />
              {teams.ct.map((p) => chip(p.i, p.name, CT))}
            </div>
          )}
          {/* T roster */}
          {teams.t.length > 0 && (
            <div
              className="flex shrink-0 items-center gap-1 rounded-lg py-0.5 pl-1.5 pr-1"
              style={{ background: "rgba(231,181,60,0.07)", boxShadow: "inset 0 0 0 1px rgba(231,181,60,0.16)" }}
            >
              <SideTag label="T" hex={T} active={view.side === "T"} onClick={() => view.setSide(view.side === "T" ? "all" : "T")} enabled={showSide} />
              {teams.t.map((p) => chip(p.i, p.name, T))}
            </div>
          )}
          {teams.other.map((p) => chip(p.i, p.name, OTHER))}
        </div>
      </div>

      {/* rounds — a score-flow timeline (winner-tinted, labeled halftime).
          Hovering a chip reads like a scoreline: "Round 7 · 5–2 · CT win".
          Same centered w-max cluster as the roster row. */}
      <div className="scroll-slim overflow-x-auto border-t border-line/50 pb-0.5 pt-2">
        <div className="mx-auto flex w-max items-center gap-2">
        <button
          type="button"
          onClick={() => view.setScopeRound(null)}
          aria-pressed={view.scopeRound === null}
          title="Whole match"
          className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold transition ${
            view.scopeRound === null
              ? "bg-brand/15 text-brand ring-1 ring-inset ring-brand/40"
              : "bg-panel text-muted hover:text-ink"
          }`}
        >
          Match
        </button>
        <div className="flex items-stretch gap-0.75">
          {rounds.map((r, i) => {
            const active = view.scopeRound === i;
            // colour by the winning TEAM (A = started CT = blue, B = amber)
            const tm = roundWinnerTeam(r, teamA);
            const ct = tm === "A";
            const t = tm === "B";
            const sc = scoreAfter[i];
            return (
              <span key={i} className="flex shrink-0 items-stretch">
                {i === swapAt && (
                  <span
                    className="mx-1 flex shrink-0 flex-col items-center justify-center gap-0.5"
                    title="Halftime — sides swap"
                  >
                    <span className="w-px flex-1 bg-line" />
                    <span className="text-[9px] font-bold uppercase leading-none tracking-wider text-muted">
                      HT
                    </span>
                    <span className="w-px flex-1 bg-line" />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => view.setScopeRound(active ? null : i)}
                  aria-pressed={active}
                  title={`Round ${r.n} · ${sc.a}–${sc.b}${r.winner ? ` · ${r.winner} win` : ""} — scope every tab to it`}
                  className={`grid h-7 w-7 place-items-center rounded-md text-[10px] font-bold tabular-nums transition ${
                    active
                      ? "text-ink ring-2 ring-inset ring-brand"
                      : ct
                        ? "text-[#cfe0ff] hover:brightness-125"
                        : t
                          ? "text-[#f6dea0] hover:brightness-125"
                          : "text-muted hover:text-ink"
                  }`}
                  style={{
                    background: active
                      ? "var(--color-panel2)"
                      : ct
                        ? "rgba(91,157,255,0.22)"
                        : t
                          ? "rgba(231,181,60,0.22)"
                          : "var(--color-panel)",
                  }}
                >
                  {r.n}
                </button>
              </span>
            );
          })}
        </div>
        {showSide && (
          <div className="flex shrink-0 rounded-lg border border-line bg-panel p-0.5">
            {(["all", "CT", "T"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => view.setSide(s)}
                aria-pressed={view.side === s}
                className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition ${
                  view.side === s
                    ? s === "CT"
                      ? "bg-[#5b9dff]/20 text-[#9cc1ff]"
                      : s === "T"
                        ? "bg-[#e7b53c]/20 text-[#f0cd78]"
                        : "bg-brand/15 text-brand"
                    : "text-muted hover:text-ink"
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

// Team label that doubles as the side filter (click to isolate that side).
function SideTag({
  label,
  hex,
  active,
  onClick,
  enabled,
}: {
  label: string;
  hex: string;
  active: boolean;
  onClick: () => void;
  enabled: boolean;
}) {
  if (!enabled) {
    return (
      <span className="shrink-0 pl-0.5 pr-1 text-[10px] font-black uppercase tracking-wider" style={{ color: hex }}>
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={`Filter every tab to the ${label} side`}
      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider transition hover:brightness-125"
      style={{
        color: hex,
        background: active ? `${hex}30` : "transparent",
        boxShadow: active ? `inset 0 0 0 1px ${hex}88` : "none",
      }}
    >
      {label}
    </button>
  );
}
