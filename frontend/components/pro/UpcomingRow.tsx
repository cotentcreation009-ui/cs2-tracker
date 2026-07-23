import Link from "next/link";
import type { MatchState } from "./types";
import { TeamLogo } from "./TeamLogo";
import { formatTag, startInfo, validHex } from "./format";

// Upcoming-match row: a team-colour edge, the start time, both teams with badge
// logos, the tournament, and a Bo tag. Links to the detail route.
export function UpcomingRow({ match }: { match: MatchState }) {
  const a = match.teams?.[0];
  const b = match.teams?.[1];
  const { rel, abs } = startInfo(match.startScheduled);
  const tag = formatTag(match);
  const aColor = validHex(a?.colorPrimary) ?? "#38d6ff";
  const bColor = validHex(b?.colorPrimary) ?? "#8a7dff";
  const soon = rel === "starting soon";

  return (
    <Link
      href={`/pro-matches/${match.seriesId}`}
      className="group relative flex items-center gap-3 overflow-hidden rounded-xl border border-line bg-panel2/25 py-2.5 pl-4 pr-3 transition duration-150 hover:-translate-y-px hover:border-line2 hover:bg-panel2/50 sm:gap-4"
    >
      {/* team-colour left edge */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1"
        style={{ backgroundImage: `linear-gradient(${aColor}, ${bColor})` }}
      />

      {/* time */}
      <div className="w-16 shrink-0 sm:w-19">
        <div className={`truncate text-xs font-semibold ${soon ? "text-[#ff6b76]" : "text-brand"}`}>{rel || "TBD"}</div>
        <div className="text-[11px] tabular-nums text-faint">{abs}</div>
      </div>

      {/* teams */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <TeamLogo name={a?.shortName || a?.name} src={a?.logoUrl} color={a?.colorPrimary} size={28} />
        <span className="truncate text-sm font-semibold text-ink">{a?.shortName || a?.name || "TBD"}</span>
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-faint">vs</span>
        <span className="truncate text-sm font-semibold text-ink">{b?.shortName || b?.name || "TBD"}</span>
        <TeamLogo name={b?.shortName || b?.name} src={b?.logoUrl} color={b?.colorPrimary} size={28} />
      </div>

      {/* tournament — hidden on the narrowest screens */}
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
