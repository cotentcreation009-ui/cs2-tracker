import Link from "next/link";
import type { LeaderboardEntry } from "@/lib/types";
import { ratingColor } from "@/lib/format";

// The "top analysed players" board: HLTV 1.0 ratings CSRun computed from the
// demos it parsed itself — not Leetify's numbers and not Valve's. The floor
// and window are the server's (the envelope echoes them), and the footnote
// prints them so a 1.32 next to a 9-demo sample is read for what it is.
// On a phone the numbers get fixed, narrow columns so the name keeps the
// room: fractional columns left "Liêm Quang Mai" as "Liêm …" at 390 px.
const GRID =
  "grid-cols-[1.25rem_minmax(0,1fr)_2.75rem_2.75rem_3rem] sm:grid-cols-[2rem_1fr_0.55fr_0.55fr_0.6fr_0.7fr]";

export function Leaderboard({
  players,
  minMatches,
  windowDays,
}: {
  players: LeaderboardEntry[];
  minMatches: number;
  windowDays: number;
}) {
  if (players.length === 0) return null;
  const windowNote = windowDays > 0 ? ` in the last ${windowDays} days` : "";

  return (
    <div className="card-2 overflow-hidden">
      <div
        className={`grid ${GRID} items-center gap-2 border-b border-line px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-faint`}
      >
        <span>#</span>
        <span>Player</span>
        <span className="text-right">
          <abbr title="Demos analysed on CSRun" className="no-underline">
            Demos
          </abbr>
        </span>
        <span className="text-right">
          <abbr title="Kills per death" className="no-underline">
            K/D
          </abbr>
        </span>
        <span className="hidden text-right sm:block">
          <abbr title="Average damage per round" className="no-underline">
            ADR
          </abbr>
        </span>
        <span className="text-right">
          <abbr
            title="HLTV 1.0 rating · 1.00 is average"
            className="no-underline"
          >
            Rating
          </abbr>
        </span>
      </div>
      <ol>
        {players.map((p, i) => (
          <li key={p.steamId64}>
            <Link
              href={`/profiles/${p.steamId64}`}
              className={`grid ${GRID} items-center gap-2 px-4 py-2.5 transition hover:bg-panel`}
            >
              <span className="text-sm font-semibold tabular-nums text-faint">
                {i + 1}
              </span>
              <div className="flex min-w-0 items-center gap-2.5">
                {p.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.avatarUrl}
                    alt=""
                    className="h-7 w-7 shrink-0 rounded border border-line object-cover"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="grid h-7 w-7 shrink-0 place-items-center rounded bg-panel text-xs font-bold text-faint"
                  >
                    {(p.personaName || "?").slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="truncate text-sm font-medium">
                  {p.personaName || p.steamId64}
                </span>
              </div>
              <span className="text-right text-sm tabular-nums text-muted">
                {p.matches}
              </span>
              <span className="text-right text-sm tabular-nums text-muted">
                {p.kd.toFixed(2)}
              </span>
              <span className="hidden text-right text-sm tabular-nums text-muted sm:block">
                {p.adr.toFixed(0)}
              </span>
              <span
                className={`text-right text-sm font-semibold tabular-nums ${ratingColor(p.rating)}`}
              >
                {p.rating.toFixed(2)}
              </span>
            </Link>
          </li>
        ))}
      </ol>
      <p className="border-t border-line px-4 py-2.5 text-[11px] leading-relaxed text-faint">
        Players appear after {minMatches} analysed demos{windowNote}. Ratings are
        HLTV 1.0, computed by CSRun from those demos — not Leetify&apos;s and
        not Valve&apos;s.
      </p>
    </div>
  );
}
