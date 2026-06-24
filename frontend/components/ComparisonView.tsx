import Link from "next/link";
import type {
  LeetifyProfile,
  PlayerCareer,
  PlayerProfile,
} from "@/lib/types";
import { flag } from "@/lib/format";

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
  { label: "Win rate", get: (p) => p.winrate * 100, fmt: (v) => `${v.toFixed(0)}%` },
  { label: "Matches", get: (p) => p.total_matches, fmt: (v) => String(v) },
  { label: "Aim", get: (p) => p.rating.aim, fmt: (v) => v.toFixed(0) },
  { label: "Positioning", get: (p) => p.rating.positioning, fmt: (v) => v.toFixed(0) },
  { label: "Utility", get: (p) => p.rating.utility, fmt: (v) => v.toFixed(0) },
  { label: "HS accuracy", get: (p) => p.stats.accuracy_head, fmt: (v) => `${v.toFixed(1)}%` },
];

function Head({ p }: { p: PlayerProfile }) {
  return (
    <Link
      href={`/profiles/${p.player.steamId64}`}
      className="flex items-center gap-3 hover:opacity-90"
    >
      {p.player.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={p.player.avatarUrl}
          alt=""
          className="h-12 w-12 rounded-lg border border-line object-cover"
        />
      ) : (
        <span className="h-12 w-12 rounded-lg border border-line bg-panel2" />
      )}
      <div className="min-w-0">
        <div className="truncate font-semibold">
          {p.player.personaName || p.player.steamId64}
        </div>
        {p.player.countryCode && (
          <div className="text-xs text-muted">
            {flag(p.player.countryCode)} {p.player.countryCode}
          </div>
        )}
      </div>
    </Link>
  );
}

// StatTable renders one "higher is better" comparison block for any dataset.
function StatTable<T>({
  title,
  a,
  b,
  rows,
}: {
  title: string;
  a: T;
  b: T;
  rows: Row<T>[];
}) {
  return (
    <div>
      <div className="stat-label px-5 pt-4">{title}</div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row) => {
            const av = row.get(a);
            const bv = row.get(b);
            const aWin = av > bv;
            const bWin = bv > av;
            return (
              <tr key={row.label} className="border-t border-line/60">
                <td
                  className={`px-5 py-2.5 text-left tabular-nums ${aWin ? "font-semibold text-good" : "text-muted"}`}
                >
                  {row.fmt(av)}
                </td>
                <td className="px-2 py-2.5 text-center text-xs uppercase tracking-wider text-faint">
                  {row.label}
                </td>
                <td
                  className={`px-5 py-2.5 text-right tabular-nums ${bWin ? "font-semibold text-good" : "text-muted"}`}
                >
                  {row.fmt(bv)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * ComparisonView shows two players head to head. It renders whichever stats the
 * pair has in common: native career stats when both have been parsed, and/or
 * Leetify stats when both have a public Leetify profile (the usual case for live
 * accounts). Falls back to a clear message when there's no shared data.
 */
export function ComparisonView({
  a,
  b,
  leetifyA = null,
  leetifyB = null,
}: {
  a: PlayerProfile;
  b: PlayerProfile;
  leetifyA?: LeetifyProfile | null;
  leetifyB?: LeetifyProfile | null;
}) {
  const hasCareer = a.career.matches > 0 && b.career.matches > 0;
  const hasLeetify = Boolean(leetifyA && leetifyB);

  return (
    <div className="card-2 overflow-hidden">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-line px-5 py-4">
        <Head p={a} />
        <span className="text-xs font-semibold uppercase tracking-wider text-faint">
          vs
        </span>
        <div className="justify-self-end">
          <Head p={b} />
        </div>
      </div>

      {hasLeetify && (
        <StatTable
          title="Leetify"
          a={leetifyA as LeetifyProfile}
          b={leetifyB as LeetifyProfile}
          rows={LEETIFY_ROWS}
        />
      )}

      {hasCareer && (
        <StatTable title="Career" a={a.career} b={b.career} rows={CAREER_ROWS} />
      )}

      {!hasCareer && !hasLeetify && (
        <div className="px-5 py-6 text-sm text-muted">
          No comparable stats for these two players — at least one has no public
          Leetify profile and no parsed matches.
        </div>
      )}
    </div>
  );
}
