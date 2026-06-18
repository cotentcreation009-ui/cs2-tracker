import Link from "next/link";
import type { PlayerCareer, PlayerProfile } from "@/lib/types";
import { flag, ratingColor } from "@/lib/format";

type Row = {
  label: string;
  get: (c: PlayerCareer) => number;
  fmt: (v: number) => string;
};

// All rows are "higher is better".
const ROWS: Row[] = [
  { label: "Rating", get: (c) => c.rating, fmt: (v) => v.toFixed(2) },
  { label: "K/D", get: (c) => c.kd, fmt: (v) => v.toFixed(2) },
  { label: "ADR", get: (c) => c.adr, fmt: (v) => v.toFixed(0) },
  { label: "KAST", get: (c) => c.kastPct, fmt: (v) => `${v.toFixed(0)}%` },
  { label: "Headshot %", get: (c) => c.hsPct, fmt: (v) => `${v.toFixed(0)}%` },
  { label: "Win rate", get: (c) => c.winRate, fmt: (v) => `${v.toFixed(0)}%` },
  { label: "Matches", get: (c) => c.matches, fmt: (v) => String(v) },
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

export function ComparisonView({
  a,
  b,
}: {
  a: PlayerProfile;
  b: PlayerProfile;
}) {
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

      <table className="w-full text-sm">
        <tbody>
          {ROWS.map((row) => {
            const av = row.get(a.career);
            const bv = row.get(b.career);
            const aWin = av > bv;
            const bWin = bv > av;
            const rateColor = row.label === "Rating";
            return (
              <tr key={row.label} className="border-t border-line/60">
                <td
                  className={`px-5 py-2.5 text-left tabular-nums ${
                    aWin ? "font-semibold text-good" : "text-muted"
                  } ${rateColor && !aWin ? ratingColor(av) : ""}`}
                >
                  {row.fmt(av)}
                </td>
                <td className="px-2 py-2.5 text-center text-xs uppercase tracking-wider text-faint">
                  {row.label}
                </td>
                <td
                  className={`px-5 py-2.5 text-right tabular-nums ${
                    bWin ? "font-semibold text-good" : "text-muted"
                  } ${rateColor && !bWin ? ratingColor(bv) : ""}`}
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
