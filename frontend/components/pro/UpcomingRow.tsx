import Link from "next/link";
import type { MatchState } from "./types";
import { TeamLogo } from "./TeamLogo";
import { formatTag, startInfo } from "./format";

// Compact upcoming-match row: start time, the two teams, tournament, and a Bo
// tag. Links to the detail route. Grouped by day on the board.
export function UpcomingRow({ match }: { match: MatchState }) {
  const a = match.teams?.[0];
  const b = match.teams?.[1];
  const { rel, abs } = startInfo(match.startScheduled);
  const tag = formatTag(match);

  return (
    <Link
      href={`/pro-matches/${match.seriesId}`}
      className="card lift flex items-center gap-3 px-3 py-2.5 sm:gap-4 sm:px-4"
    >
      {/* time */}
      <div className="w-16 shrink-0 sm:w-20">
        <div className="truncate text-xs font-semibold text-brand">{rel || "TBD"}</div>
        <div className="text-[11px] tabular-nums text-faint">{abs}</div>
      </div>

      {/* teams */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <TeamLogo name={a?.name} src={a?.logoUrl} color={a?.colorPrimary} size={24} />
        <span className="truncate text-sm font-semibold text-ink">
          {a?.shortName || a?.name || "TBD"}
        </span>
        <span className="shrink-0 text-[11px] font-medium text-faint">vs</span>
        <span className="truncate text-sm font-semibold text-ink">
          {b?.shortName || b?.name || "TBD"}
        </span>
        <TeamLogo name={b?.name} src={b?.logoUrl} color={b?.colorPrimary} size={24} />
      </div>

      {/* tournament — hidden on the narrowest screens */}
      <div className="hidden min-w-0 max-w-[38%] items-center gap-1.5 sm:flex">
        {match.tournamentLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={match.tournamentLogoUrl}
            alt=""
            width={16}
            height={16}
            loading="lazy"
            className="h-4 w-4 shrink-0 rounded object-contain opacity-80"
          />
        ) : null}
        <span className="truncate text-xs text-muted">{match.tournamentName}</span>
      </div>

      {tag ? (
        <span className="pill shrink-0 border-line text-[10px] text-muted">{tag}</span>
      ) : null}
    </Link>
  );
}
