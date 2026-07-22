import Link from "next/link";
import type { MatchState } from "./types";
import { TeamLogo } from "./TeamLogo";
import { LiveBadge } from "./LiveBadge";
import { RoundStrip } from "./RoundStrip";
import {
  clockLabel,
  formatTag,
  liveMap,
  mapsWon,
  sideHex,
  validHex,
} from "./format";
import { TwitchLink } from "./TwitchLink";

// A prominent live-series card: tournament header, both teams with the big
// SERIES score (maps) between them, then the live map's round score + round
// number + a round-by-round strip. The whole card links to the detail route.
export function LiveMatchCard({ match }: { match: MatchState }) {
  const a = match.teams?.[0];
  const b = match.teams?.[1];
  const aWon = mapsWon(match, a?.gridId);
  const bWon = mapsWon(match, b?.gridId);
  const lm = liveMap(match);

  const aRounds = lm && a ? (lm.scoreByTeam?.[a.gridId] ?? 0) : 0;
  const bRounds = lm && b ? (lm.scoreByTeam?.[b.gridId] ?? 0) : 0;
  const aSide = lm && a ? lm.sideByTeam?.[a.gridId] : undefined;
  const bSide = lm && b ? lm.sideByTeam?.[b.gridId] : undefined;
  const round = lm?.currentRound;
  const clock = clockLabel(lm?.clockSeconds);

  // Team accent colours drive a thin gradient bar across the top of the card.
  const aColor = validHex(a?.colorPrimary) ?? "#38d6ff";
  const bColor = validHex(b?.colorPrimary) ?? "#8a7dff";

  return (
    <Link
      href={`/pro-matches/${match.seriesId}`}
      className="card-2 lift group relative block overflow-hidden p-4 sm:p-5"
    >
      {/* team-colour accent */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5 opacity-80"
        style={{ backgroundImage: `linear-gradient(90deg, ${aColor}, ${bColor})` }}
      />

      {/* header: tournament + format/live */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {match.tournamentLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={match.tournamentLogoUrl}
              alt=""
              width={18}
              height={18}
              loading="lazy"
              className="h-4.5 w-4.5 shrink-0 rounded object-contain opacity-90"
            />
          ) : null}
          <span className="truncate text-xs font-medium text-muted">
            {match.tournamentName ?? "Pro match"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {formatTag(match) ? (
            <span className="pill border-line text-[10px] text-muted">
              {formatTag(match)}
            </span>
          ) : null}
          <LiveBadge />
        </div>
      </div>

      {/* teams + series score */}
      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <TeamLogo name={a?.name} src={a?.logoUrl} color={a?.colorPrimary} size={44} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-ink">
              {a?.shortName || a?.name || "TBD"}
            </span>
          </span>
        </div>

        <div className="flex items-center gap-2 px-1 text-3xl font-extrabold tabular-nums sm:text-4xl">
          <span className={aWon >= bWon ? "text-ink" : "text-faint"}>{aWon}</span>
          <span className="text-lg text-faint sm:text-xl">:</span>
          <span className={bWon >= aWon ? "text-ink" : "text-faint"}>{bWon}</span>
        </div>

        <div className="flex min-w-0 items-center justify-end gap-2.5">
          <span className="min-w-0 text-right">
            <span className="block truncate text-sm font-bold text-ink">
              {b?.shortName || b?.name || "TBD"}
            </span>
          </span>
          <TeamLogo name={b?.name} src={b?.logoUrl} color={b?.colorPrimary} size={44} />
        </div>
      </div>

      {/* live map bar */}
      {lm ? (
        <div className="mt-4 rounded-xl border border-line/70 bg-panel/40 px-3 py-2.5">
          <div className="flex items-center justify-between text-[11px] text-faint">
            <span className="truncate font-medium text-muted">
              {lm.mapName ? lm.mapName : `Map ${lm.sequence}`}
              <span className="text-faint"> · Map {lm.sequence}</span>
            </span>
            <span className="shrink-0 tabular-nums">
              {round ? `Round ${round}` : null}
              {round && clock ? " · " : null}
              {clock}
            </span>
          </div>

          <div className="mt-1.5 flex items-center justify-center gap-2 text-xl font-bold tabular-nums">
            <span style={{ color: sideHex(aSide) ?? undefined }}>{aRounds}</span>
            <span className="text-sm text-faint">–</span>
            <span style={{ color: sideHex(bSide) ?? undefined }}>{bRounds}</span>
          </div>

          {lm.rounds && lm.rounds.length ? (
            <div className="mt-2 flex justify-center">
              <RoundStrip rounds={lm.rounds} teams={match.teams} />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* stream */}
      {match.streamUrl ? (
        <div className="mt-3 flex justify-end">
          <TwitchLink url={match.streamUrl} />
        </div>
      ) : null}
    </Link>
  );
}
