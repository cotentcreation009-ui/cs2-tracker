import Link from "next/link";
import type { MatchState } from "./types";
import { TeamLogo } from "./TeamLogo";
import { formatTag, validHex } from "./format";

// Finished-series row for the board's "Recent results" section: winner reads
// at a glance (bold + colored score, loser dimmed), links to the durable
// result page. Mirrors UpcomingRow's shape so the board scans as one list.
export function ResultRow({ match, now }: { match: MatchState; now: number }) {
  const a = match.teams?.[0];
  const b = match.teams?.[1];
  const sa = match.seriesScore?.[a?.gridId ?? ""] ?? 0;
  const sb = match.seriesScore?.[b?.gridId ?? ""] ?? 0;
  const aWon = sa > sb;
  const bWon = sb > sa;
  const aColor = validHex(a?.colorPrimary) ?? "#38d6ff";
  const bColor = validHex(b?.colorPrimary) ?? "#8a7dff";
  const tag = formatTag(match);
  const ended = (() => {
    const t = new Date(match.liveUpdatedAt ?? match.startScheduled ?? 0).getTime();
    if (!t) return "";
    const h = Math.max(0, Math.round((now - t) / 3_600_000));
    if (h < 1) return "just now";
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  })();

  return (
    <Link
      href={`/pro-matches/${match.seriesId}`}
      className="group relative flex items-center gap-3 overflow-hidden rounded-xl border border-line bg-panel2/25 py-2.5 pl-4 pr-3 transition duration-150 hover:-translate-y-px hover:border-line2 hover:bg-panel2/50 sm:gap-4"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1 opacity-70"
        style={{ backgroundImage: `linear-gradient(${aColor}, ${bColor})` }}
      />

      {/* when it ended */}
      <div className="w-18 shrink-0 sm:w-21">
        <div className="truncate text-xs font-semibold text-faint">Final</div>
        <div className="truncate text-[11px] tabular-nums text-faint">{ended}</div>
      </div>

      {/* teams + final score */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <TeamLogo name={a?.shortName || a?.name} src={a?.logoUrl} color={a?.colorPrimary} size={34} />
        <span className={`truncate text-sm sm:text-[15px] ${aWon ? "font-bold text-ink" : "font-medium text-faint"}`}>
          {a?.shortName || a?.name || "?"}
        </span>
        <span className="shrink-0 text-sm font-extrabold tabular-nums sm:text-base">
          <span className={aWon ? "text-ink" : "text-faint"}>{sa}</span>
          <span className="mx-1 text-xs font-normal text-faint">–</span>
          <span className={bWon ? "text-ink" : "text-faint"}>{sb}</span>
        </span>
        <span className={`truncate text-sm sm:text-[15px] ${bWon ? "font-bold text-ink" : "font-medium text-faint"}`}>
          {b?.shortName || b?.name || "?"}
        </span>
        <TeamLogo name={b?.shortName || b?.name} src={b?.logoUrl} color={b?.colorPrimary} size={34} />
      </div>

      {/* tournament */}
      <div className="hidden min-w-0 max-w-[36%] items-center gap-1.5 sm:flex">
        {match.tournamentLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={match.tournamentLogoUrl} alt="" loading="lazy" className="h-4 w-4 shrink-0 rounded object-contain opacity-80" />
        ) : null}
        <span className="truncate text-xs text-muted">{match.tournamentName}</span>
      </div>

      {tag ? <span className="pill shrink-0 border-line text-[10px] text-muted">{tag}</span> : null}
    </Link>
  );
}
