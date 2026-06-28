import Link from "next/link";
import type { LeetifyProfile, PlayerCareer, PlayerProfile } from "@/lib/types";
import { flag } from "@/lib/format";

export interface ComparePlayer {
  profile: PlayerProfile;
  leetify: LeetifyProfile | null;
}

type Row<T> = {
  label: string;
  get: (x: T) => number;
  fmt: (v: number) => string;
};

// Native career rows (only present for players we've parsed/seeded).
const CAREER_ROWS: Row<PlayerCareer>[] = [
  { label: "Rating", get: (c) => c.rating, fmt: (v) => v.toFixed(2) },
  { label: "K/D", get: (c) => c.kd, fmt: (v) => v.toFixed(2) },
  { label: "ADR", get: (c) => c.adr, fmt: (v) => v.toFixed(0) },
  { label: "KAST", get: (c) => c.kastPct, fmt: (v) => `${v.toFixed(0)}%` },
  { label: "Headshot %", get: (c) => c.hsPct, fmt: (v) => `${v.toFixed(0)}%` },
  { label: "Win rate", get: (c) => c.winRate, fmt: (v) => `${v.toFixed(0)}%` },
  { label: "Matches", get: (c) => c.matches, fmt: (v) => String(v) },
];

// Leetify rows (present for any tracked player with a public Leetify profile).
const LEETIFY_ROWS: Row<LeetifyProfile>[] = [
  { label: "Leetify rating", get: (p) => p.ranks?.leetify ?? 0, fmt: (v) => v.toFixed(2) },
  { label: "Premier", get: (p) => p.ranks?.premier ?? 0, fmt: (v) => (v ? v.toLocaleString("en-US") : "—") },
  { label: "FACEIT ELO", get: (p) => p.ranks?.faceit_elo ?? 0, fmt: (v) => (v ? v.toLocaleString("en-US") : "—") },
  { label: "Win rate", get: (p) => p.winrate * 100, fmt: (v) => `${v.toFixed(0)}%` },
  { label: "Matches", get: (p) => p.total_matches, fmt: (v) => String(v) },
  { label: "Aim", get: (p) => p.rating.aim, fmt: (v) => v.toFixed(0) },
  { label: "Positioning", get: (p) => p.rating.positioning, fmt: (v) => v.toFixed(0) },
  { label: "Utility", get: (p) => p.rating.utility, fmt: (v) => v.toFixed(0) },
  { label: "HS accuracy", get: (p) => p.stats.accuracy_head, fmt: (v) => `${v.toFixed(1)}%` },
];

function Head({ p }: { p: PlayerProfile }) {
  return (
    <Link href={`/profiles/${p.player.steamId64}`} className="flex items-center gap-2.5 hover:opacity-90">
      {p.player.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.player.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg border border-line object-cover" />
      ) : (
        <span className="h-9 w-9 shrink-0 rounded-lg border border-line bg-panel2" />
      )}
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{p.player.personaName || p.player.steamId64}</div>
        {p.player.countryCode && (
          <div className="text-[11px] text-muted">
            {flag(p.player.countryCode)} {p.player.countryCode}
          </div>
        )}
      </div>
    </Link>
  );
}

// One "higher is better" comparison block across N players. The best value in
// each row is bolded green; players missing that dataset show "—".
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
            <th className={`${stickyCell} px-5 py-3 text-left align-bottom stat-label`}>{title}</th>
            {players.map((p, i) => (
              <th key={i} className="min-w-[150px] px-4 py-3 text-left font-normal">
                <Head p={p.profile} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const vals = players.map((p) => {
              const d = pick(p);
              return d ? row.get(d) : null;
            });
            const nums = vals.filter((v): v is number => v != null && v > 0);
            const best = nums.length ? Math.max(...nums) : null;
            const allSame = nums.length > 1 && nums.every((v) => v === nums[0]);
            return (
              <tr key={row.label} className="border-t border-line/60">
                <td className={`${stickyCell} px-5 py-2 text-muted`}>{row.label}</td>
                {vals.map((v, i) => (
                  <td
                    key={i}
                    className={`px-4 py-2 tabular-nums ${
                      v != null && v === best && !allSame ? "font-bold text-good" : "text-ink"
                    }`}
                  >
                    {v != null ? row.fmt(v) : "—"}
                  </td>
                ))}
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
  return (
    <div className="space-y-4">
      {anyLeetify && (
        <StatGrid<LeetifyProfile> title="Leetify" players={players} rows={LEETIFY_ROWS} pick={(p) => p.leetify} />
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
