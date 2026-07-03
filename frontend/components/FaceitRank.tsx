"use client";

import type { FaceitProfile } from "@/lib/types";

// Official FACEIT skill-level colours (1 grey · 2–4 green · 5–7 yellow · 8–9
// orange · 10 red).
export function faceitColor(lvl: number): string {
  if (lvl >= 10) return "#e8332e";
  if (lvl >= 8) return "#ff7a18";
  if (lvl >= 5) return "#ffc220";
  if (lvl >= 2) return "#36cf4a";
  return "#dfe5ec";
}

// FaceitBadge — the FACEIT emblem button. Open/close is controlled by the parent
// (RankRow) so the detail panel renders BELOW the whole rank row, keeping the
// other badges visible. Returns null when the account has no FACEIT level.
export function FaceitBadge({
  faceit,
  level,
  elo,
  open,
  onToggle,
}: {
  faceit?: FaceitProfile | null;
  level: number;
  elo: number;
  open: boolean;
  onToggle: () => void;
}) {
  if (level <= 0) return null;
  const color = faceitColor(level);
  const canOpen = !!faceit;

  return (
    <button
      type="button"
      disabled={!canOpen}
      onClick={onToggle}
      title={canOpen ? "Show FACEIT detail" : `FACEIT level ${level}`}
      className="flex items-center gap-2.5 rounded-xl border border-line bg-panel px-3.5 py-2 text-left transition enabled:hover:brightness-110 disabled:cursor-default"
    >
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-black"
        style={{ background: "#0a0f1c", border: `2px solid ${color}`, color, boxShadow: `0 0 8px -2px ${color}80` }}
      >
        {level}
      </span>
      <div>
        <div className="stat-label flex items-center gap-1">
          FACEIT {canOpen && <span className="text-faint">{open ? "▲" : "▾"}</span>}
        </div>
        <div className="text-base font-bold tabular-nums" style={{ color }}>
          {elo > 0 ? elo.toLocaleString("en-US") : `Lvl ${level}`}
          {elo > 0 && <span className="ml-1 text-[10px] font-normal text-faint">ELO</span>}
        </div>
      </div>
    </button>
  );
}

export function FaceitDetail({ faceit, color, elo, level }: { faceit: FaceitProfile; color: string; elo: number; level: number }) {
  const results = faceit.recentResults ?? [];
  const stat = (label: string, value: string) => (
    <div className="rounded-lg bg-panel/60 px-2.5 py-2">
      <div className="stat-label">{label}</div>
      <div className="mt-0.5 text-base font-bold tabular-nums text-ink">{value}</div>
    </div>
  );

  return (
    <div className="mt-2 rounded-xl border border-line bg-panel/40 p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="stat-label">FACEIT detail</span>
        <span className="text-[11px]" style={{ color }}>
          Level {level}
        </span>
        {faceit.faceitUrl && (
          <a href={faceit.faceitUrl} target="_blank" rel="noreferrer" className="ml-auto text-[11px] text-brand hover:underline">
            FACEIT ↗
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {elo > 0 && stat("ELO", elo.toLocaleString("en-US"))}
        {faceit.matches > 0 && stat("Matches", faceit.matches.toLocaleString("en-US"))}
        {faceit.winRatePct > 0 && stat("Win rate", `${faceit.winRatePct.toFixed(0)}%`)}
        {faceit.kdRatio > 0 && stat("K/D", faceit.kdRatio.toFixed(2))}
        {faceit.hsPct > 0 && stat("HS%", `${faceit.hsPct.toFixed(0)}%`)}
        {faceit.avgKills > 0 && stat("Avg kills", faceit.avgKills.toFixed(1))}
      </div>

      {(faceit.currentWinStreak > 0 || faceit.longestWinStreak > 0) && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
          {faceit.currentWinStreak > 0 && (
            <span>
              Current streak <b className="text-good tabular-nums">{faceit.currentWinStreak}W</b>
            </span>
          )}
          {faceit.longestWinStreak > 0 && (
            <span>
              Longest streak <b className="text-ink tabular-nums">{faceit.longestWinStreak}W</b>
            </span>
          )}
        </div>
      )}

      {results.length > 0 && (
        <div className="mt-3">
          <div className="stat-label mb-1.5">Recent results · newest first</div>
          <div className="flex flex-wrap gap-1">
            {results.map((r, i) => (
              <span
                key={i}
                title={r === "1" ? "Win" : "Loss"}
                className={`grid h-5 w-5 place-items-center rounded text-[10px] font-bold ${
                  r === "1" ? "bg-good/20 text-good" : "bg-bad/20 text-bad"
                }`}
              >
                {r === "1" ? "W" : "L"}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-faint">
        FACEIT career snapshot + recent form. FACEIT doesn&apos;t expose a per-match ELO timeline publicly, so
        there&apos;s no ELO graph like Premier.
      </p>
    </div>
  );
}
