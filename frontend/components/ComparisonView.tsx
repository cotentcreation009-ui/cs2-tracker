import Link from "next/link";
import type { ReactNode } from "react";
import type {
  FaceitProfile,
  LeetifyProfile,
  LeetifyRecentMatch,
  PlayerCareer,
  PlayerProfile,
} from "@/lib/types";
import { flag } from "@/lib/format";

export interface ComparePlayer {
  profile: PlayerProfile;
  leetify: LeetifyProfile | null;
  faceit: FaceitProfile | null;
}

type Row<T> = {
  label: string;
  get?: (x: T) => number; // numeric row → bar + best-highlight + verdict tally
  fmt?: (v: number) => string;
  render?: (x: T) => ReactNode; // custom cell (e.g. form strip) — no bar/verdict
  lowerBetter?: boolean; // e.g. reaction time: a smaller number wins
  noVerdict?: boolean; // count/experience rows excluded from the "leads" tally
};

const CAREER_ROWS: Row<PlayerCareer>[] = [
  { label: "Rating", get: (c) => c.rating, fmt: (v) => v.toFixed(2) },
  { label: "K/D", get: (c) => c.kd, fmt: (v) => v.toFixed(2) },
  { label: "ADR", get: (c) => c.adr, fmt: (v) => v.toFixed(0) },
  { label: "KAST", get: (c) => c.kastPct, fmt: (v) => `${v.toFixed(0)}%` },
  { label: "Headshot %", get: (c) => c.hsPct, fmt: (v) => `${v.toFixed(0)}%` },
  { label: "Win rate", get: (c) => c.winRate, fmt: (v) => `${v.toFixed(0)}%` },
  { label: "Matches", get: (c) => c.matches, fmt: (v) => String(v), noVerdict: true },
];

const openingPct = (p: LeetifyProfile) =>
  (p.stats.ct_opening_duel_success_percentage +
    p.stats.t_opening_duel_success_percentage) /
  2;

// Leetify rows (any tracked player with a public Leetify profile). Ordered:
// standing (ranks) → recent form → overall → skill breakdown.
const LEETIFY_ROWS: Row<LeetifyProfile>[] = [
  { label: "Leetify rating", get: (p) => p.ranks?.leetify ?? 0, fmt: (v) => v.toFixed(2) },
  { label: "Premier", get: (p) => p.ranks?.premier ?? 0, fmt: (v) => (v ? v.toLocaleString("en-US") : "—") },
  { label: "FACEIT ELO", get: (p) => p.ranks?.faceit_elo ?? 0, fmt: (v) => (v ? v.toLocaleString("en-US") : "—") },
  { label: "Recent form", render: (p) => <FormStrip matches={p.recent_matches} /> },
  { label: "Win rate", get: (p) => p.winrate * 100, fmt: (v) => `${v.toFixed(0)}%` },
  { label: "Matches", get: (p) => p.total_matches, fmt: (v) => String(v), noVerdict: true },
  { label: "Aim", get: (p) => p.rating.aim, fmt: (v) => v.toFixed(0) },
  { label: "Positioning", get: (p) => p.rating.positioning, fmt: (v) => v.toFixed(0) },
  { label: "Utility", get: (p) => p.rating.utility, fmt: (v) => v.toFixed(0) },
  { label: "Opening duels", get: openingPct, fmt: (v) => `${v.toFixed(0)}%` },
  { label: "HS accuracy", get: (p) => p.stats.accuracy_head, fmt: (v) => `${v.toFixed(1)}%` },
  { label: "Reaction", get: (p) => p.stats.reaction_time_ms, fmt: (v) => `${v.toFixed(0)}ms`, lowerBetter: true },
];

function Avatar({ url, size = "h-9 w-9" }: { url?: string; size?: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className={`${size} shrink-0 rounded-lg border border-line object-cover`} />
  ) : (
    <span className={`${size} shrink-0 rounded-lg border border-line bg-panel2`} />
  );
}

// "5y" / "3mo" from a Steam creation timestamp (public profiles only).
function accountAgeLabel(created?: string): string | null {
  if (!created) return null;
  const t = Date.parse(created);
  if (Number.isNaN(t)) return null;
  const years = (Date.now() - t) / (365.25 * 24 * 3600 * 1000);
  if (years < 0) return null;
  if (years < 1) return `${Math.max(1, Math.round(years * 12))}mo`;
  return `${years < 10 ? years.toFixed(1) : Math.round(years)}y`;
}

// Last ~10 matches as win/loss bars + record — an at-a-glance "who's hot".
function FormStrip({ matches }: { matches?: LeetifyRecentMatch[] }) {
  const recent = (matches ?? []).slice(0, 10);
  if (!recent.length) return <span className="text-faint">—</span>;
  const w = recent.filter((m) => m.outcome === "win").length;
  const l = recent.filter((m) => m.outcome === "loss").length;
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.75">
        {recent.map((m, i) => (
          <span
            key={i}
            title={`${m.outcome} · ${m.map_name}`}
            className={`h-4 w-1.5 rounded-xs ${
              m.outcome === "win" ? "bg-good" : m.outcome === "loss" ? "bg-bad" : "bg-faint"
            }`}
          />
        ))}
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted">
        {w}
        <span className="text-good">W</span> {l}
        <span className="text-bad">L</span>
      </span>
    </div>
  );
}

function Head({ p }: { p: ComparePlayer }) {
  const pl = p.profile.player;
  const age = accountAgeLabel(pl.steamCreatedAt);
  const level = p.faceit?.skillLevel;
  return (
    <Link
      href={`/profiles/${pl.steamId64}`}
      className="flex items-center gap-2.5 hover:opacity-90"
    >
      <Avatar url={pl.avatarUrl} />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">
          {pl.personaName || pl.steamId64}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
          {pl.countryCode && (
            <span>
              {flag(pl.countryCode)} {pl.countryCode.toUpperCase()}
            </span>
          )}
          {level ? (
            <span className="rounded bg-brand/10 px-1 font-semibold text-brand">
              FACEIT {level}
            </span>
          ) : null}
          {age && <span title="Steam account age">{age} on Steam</span>}
        </div>
      </div>
    </Link>
  );
}

// Count how many comparable categories each player "wins" (best value), across
// both sections. Skips custom/count rows and rows where everyone ties or only
// one player has data.
function tallyWins(players: ComparePlayer[]): number[] {
  const wins = players.map(() => 0);
  const run = <T,>(rows: Row<T>[], pick: (p: ComparePlayer) => T | null) => {
    for (const row of rows) {
      if (!row.get || row.noVerdict) continue;
      const get = row.get;
      const vals = players.map((p) => {
        const d = pick(p);
        return d ? get(d) : null;
      });
      const nums = vals.filter((v): v is number => v != null && v > 0);
      if (nums.length < 2 || nums.every((v) => v === nums[0])) continue;
      const target = row.lowerBetter ? Math.min(...nums) : Math.max(...nums);
      vals.forEach((v, i) => {
        if (v != null && v > 0 && v === target) wins[i] += 1;
      });
    }
  };
  run(LEETIFY_ROWS, (p) => p.leetify);
  run(CAREER_ROWS, (p) => (p.profile.career.matches > 0 ? p.profile.career : null));
  return wins;
}

function Verdict({ players, wins }: { players: ComparePlayer[]; wins: number[] }) {
  const total = wins.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const max = Math.max(...wins);
  const leaderCount = wins.filter((w) => w === max).length;
  const leadIdx = leaderCount === 1 ? wins.indexOf(max) : -1;
  const leaderName =
    leadIdx >= 0
      ? players[leadIdx].profile.player.personaName ||
        players[leadIdx].leetify?.name ||
        "Player"
      : null;

  return (
    <div className="card-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4">
      <div>
        <div className="stat-label">Head-to-head</div>
        <div className="mt-0.5 text-sm">
          {leaderName ? (
            <>
              <span className="font-bold text-good">{leaderName}</span>
              <span className="text-muted">
                {players.length === 2
                  ? ` leads ${wins[leadIdx]}–${wins[1 - leadIdx]} categories`
                  : ` leads ${max} categories`}
              </span>
            </>
          ) : (
            <span className="font-semibold text-muted">Evenly matched</span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {players.map((p, i) => {
          const lead = wins[i] === max && leaderCount === 1;
          return (
            <div
              key={i}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${
                lead ? "border-good/40 bg-good/5" : "border-line"
              }`}
            >
              <Avatar url={p.profile.player.avatarUrl} size="h-5 w-5" />
              <span className="max-w-27.5 truncate text-xs font-medium">
                {p.profile.player.personaName || p.profile.player.steamId64}
              </span>
              <span
                className={`text-sm font-bold tabular-nums ${lead ? "text-good" : "text-muted"}`}
              >
                {wins[i]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// One "higher (or lower) is better" comparison block across N players. Each cell
// shows the value, a magnitude bar (fuller = better, both directions), and the
// best is bolded green.
function StatGrid<T>({
  title,
  players,
  rows,
  pick,
}: {
  title: string;
  players: ComparePlayer[];
  rows: Row<T>[];
  pick: (p: ComparePlayer) => T | null;
}) {
  const stickyCell = "sticky left-0 z-10 bg-panel2";
  return (
    <div className="card-2 overflow-x-auto scroll-slim">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className={`${stickyCell} px-5 py-3 text-left align-bottom stat-label`}>
              {title}
            </th>
            {players.map((p, i) => (
              <th key={i} className="min-w-42.5 px-4 py-3 text-left font-normal">
                <Head p={p} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            if (row.render) {
              const render = row.render;
              return (
                <tr key={row.label} className="border-t border-line/60">
                  <td className={`${stickyCell} px-5 py-2.5 text-muted`}>{row.label}</td>
                  {players.map((p, i) => {
                    const d = pick(p);
                    return (
                      <td key={i} className="px-4 py-2.5">
                        {d ? render(d) : <span className="text-faint">—</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            }
            const get = row.get!;
            const fmt = row.fmt!;
            const vals = players.map((p) => {
              const d = pick(p);
              return d ? get(d) : null;
            });
            const nums = vals.filter((v): v is number => v != null && v > 0);
            const scaleMax = nums.length ? Math.max(...nums) : null;
            const scaleMin = nums.length ? Math.min(...nums) : null;
            const best = nums.length ? (row.lowerBetter ? scaleMin : scaleMax) : null;
            const allSame = nums.length > 1 && nums.every((v) => v === nums[0]);
            return (
              <tr key={row.label} className="border-t border-line/60">
                <td className={`${stickyCell} px-5 py-2.5 text-muted`}>{row.label}</td>
                {vals.map((v, i) => {
                  const isBest = v != null && v > 0 && v === best && !allSame;
                  let goodness = 0;
                  if (v != null && v > 0 && scaleMax && scaleMin != null) {
                    goodness = row.lowerBetter ? scaleMin / v : v / scaleMax;
                  }
                  const pct = Math.max(6, Math.round(goodness * 100));
                  return (
                    <td key={i} className="px-4 py-2.5 align-middle">
                      <div
                        className={`tabular-nums ${isBest ? "font-bold text-good" : "text-ink"}`}
                      >
                        {v != null ? fmt(v) : "—"}
                      </div>
                      {v != null && v > 0 ? (
                        <div className="mt-1 h-1 w-full max-w-25 overflow-hidden rounded-full bg-line/40">
                          <div
                            className={`h-full rounded-full ${isBest ? "bg-good" : "bg-brand/45"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ComparisonView({ players }: { players: ComparePlayer[] }) {
  const anyLeetify = players.some((p) => p.leetify);
  const anyCareer = players.some((p) => p.profile.career.matches > 0);
  const wins = tallyWins(players);
  return (
    <div className="space-y-4">
      <Verdict players={players} wins={wins} />
      {anyLeetify && (
        <StatGrid<LeetifyProfile>
          title="Leetify"
          players={players}
          rows={LEETIFY_ROWS}
          pick={(p) => p.leetify}
        />
      )}
      {anyCareer && (
        <StatGrid<PlayerCareer>
          title="Career"
          players={players}
          rows={CAREER_ROWS}
          pick={(p) => (p.profile.career.matches > 0 ? p.profile.career : null)}
        />
      )}
      {!anyLeetify && !anyCareer && (
        <div className="card-2 px-5 py-6 text-center text-sm text-muted">
          No comparable stats available for these players.
        </div>
      )}
    </div>
  );
}
