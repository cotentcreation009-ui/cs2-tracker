import Link from "next/link";
import type { MatchState } from "./types";
import { TeamLogo } from "./TeamLogo";
import { dayGroup, formatTag, startInfo, validHex } from "./format";

// Upcoming-match row: a team-colour edge, the start time, both teams with badge
// logos (and their standing when they are in the top 20), the tournament
// unless the row sits under its event's own header, and a Bo tag. Links to
// the detail route.
export function UpcomingRow({
  match,
  describedBy,
  ranks,
  showEvent = true,
}: {
  match: MatchState;
  /** id of the row's hover/focus detail panel while it is open (BoardSections). */
  describedBy?: string;
  /** gridId → standing, for the rank pill beside a top-20 team's name. */
  ranks?: Record<string, number>;
  /** False when the row already sits under a header naming its event. */
  showEvent?: boolean;
}) {
  const a = match.teams?.[0];
  const b = match.teams?.[1];
  const { rel, abs, date, delayed } = startInfo(match.startScheduled);
  // rows group by event (not day), so carry the day on the row itself
  const day = date ? dayGroup(date) : "";
  const dayShort =
    day === "Today" ? "" : day === "Tomorrow" ? "Tmrw" : date ? date.toLocaleDateString([], { weekday: "short" }) : "";
  const tag = formatTag(match);
  const aColor = validHex(a?.colorPrimary) ?? "#38d6ff";
  const bColor = validHex(b?.colorPrimary) ?? "#8a7dff";
  const soon = rel === "starting soon";
  const ra = a?.gridId ? ranks?.[a.gridId] : undefined;
  const rb = b?.gridId ? ranks?.[b.gridId] : undefined;
  const rank = (n?: number) =>
    n ? (
      <span className="shrink-0 rounded-full bg-brand/15 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-brand" title={`#${n} in Valve's Regional Standings`}>
        #{n}
      </span>
    ) : null;

  return (
    <Link
      href={`/pro-matches/${match.seriesId}`}
      aria-describedby={describedBy}
      className="group relative flex items-center gap-3 overflow-hidden rounded-xl border border-line bg-panel2/25 py-2.5 pl-4 pr-3 transition duration-150 hover:-translate-y-px hover:border-line2 hover:bg-panel2/50 sm:gap-4"
    >
      {/* team-colour left edge */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1"
        style={{ backgroundImage: `linear-gradient(${aColor}, ${bColor})` }}
      />

      {/* time */}
      <div
        className="w-18 shrink-0 sm:w-21"
        title={delayed ? "Running late — likely waiting on the previous series to finish" : undefined}
      >
        <div className={`truncate text-xs font-semibold ${delayed ? "text-mid" : soon ? "text-[#ff6b76]" : "text-brand"}`}>
          {delayed ? "Delayed" : rel || "TBD"}
        </div>
        <div className="truncate text-[11px] tabular-nums text-faint">
          {delayed ? `was ${abs}` : `${dayShort ? `${dayShort} · ` : ""}${abs}`}
        </div>
      </div>

      {/* teams */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <TeamLogo name={a?.shortName || a?.name} src={a?.logoUrl} color={a?.colorPrimary} size={34} />
        <span className="truncate text-sm font-semibold text-ink sm:text-[15px]">{a?.shortName || a?.name || "TBD"}</span>
        {rank(ra)}
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-faint">vs</span>
        <span className="truncate text-sm font-semibold text-ink sm:text-[15px]">{b?.shortName || b?.name || "TBD"}</span>
        {rank(rb)}
        <TeamLogo name={b?.shortName || b?.name} src={b?.logoUrl} color={b?.colorPrimary} size={34} />
      </div>

      {/* tournament — hidden on the narrowest screens, and under an event header */}
      {showEvent ? (
      <div className="hidden min-w-0 max-w-[36%] items-center gap-1.5 sm:flex">
        {match.tournamentLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={match.tournamentLogoUrl} alt="" loading="lazy" className="h-4 w-4 shrink-0 rounded object-contain opacity-80" />
        ) : null}
        <span className="truncate text-xs text-muted">{match.tournamentName}</span>
      </div>
      ) : null}

      {tag ? <span className="pill shrink-0 border-line text-[10px] text-muted">{tag}</span> : null}
    </Link>
  );
}
