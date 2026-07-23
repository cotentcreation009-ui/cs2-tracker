import Link from "next/link";
import type { MatchState } from "./types";
import { TeamLogo } from "./TeamLogo";
import { LiveBadge } from "./LiveBadge";
import { RoundStrip } from "./RoundStrip";
import { clockLabel, formatTag, liveMap, mapsWon, sideHex, validHex } from "./format";
import { TwitchLink } from "./TwitchLink";

// Series-progress pips: one dot per map needed to win (ceil(bestOf/2)), filled
// in the team's colour for maps already won.
function MapPips({
  won,
  bestOf,
  color,
  align = "left",
}: {
  won: number;
  bestOf: number;
  color: string;
  align?: "left" | "right";
}) {
  const need = Math.max(1, Math.ceil(bestOf / 2));
  return (
    <span className={`mt-1 flex gap-1 ${align === "right" ? "justify-end" : ""}`} aria-hidden>
      {Array.from({ length: need }).map((_, i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full"
          style={i < won ? { background: color } : { boxShadow: "inset 0 0 0 1px var(--color-line2)" }}
        />
      ))}
    </span>
  );
}

// A broadcast-style live-series card: team-colour glows, both teams flanking the
// LIVE MAP round score (the action), map/round/clock context, a round strip,
// and series-map pips when it's a Bo3+. Links to the detail route.
export function LiveMatchCard({ match }: { match: MatchState }) {
  const a = match.teams?.[0];
  const b = match.teams?.[1];
  const aColor = validHex(a?.colorPrimary) ?? "#38d6ff";
  const bColor = validHex(b?.colorPrimary) ?? "#8a7dff";
  const aWon = mapsWon(match, a?.gridId);
  const bWon = mapsWon(match, b?.gridId);
  const bo = match.bestOf ?? 0;
  const showPips = bo > 1;

  const lm = liveMap(match);
  const aRounds = lm && a ? (lm.scoreByTeam?.[a.gridId] ?? 0) : 0;
  const bRounds = lm && b ? (lm.scoreByTeam?.[b.gridId] ?? 0) : 0;
  const aSide = lm && a ? lm.sideByTeam?.[a.gridId] : undefined;
  const bSide = lm && b ? lm.sideByTeam?.[b.gridId] : undefined;
  const round = lm?.currentRound;
  const clock = clockLabel(lm?.clockSeconds);

  // Hero = the live map's round score when a map is running; between maps (or
  // no live map) fall back to the series maps score so the number is never blank.
  const heroA = lm ? aRounds : aWon;
  const heroB = lm ? bRounds : bWon;
  const heroAColor = lm ? sideHex(aSide) : undefined;
  const heroBColor = lm ? sideHex(bSide) : undefined;

  return (
    <Link
      href={`/pro-matches/${match.seriesId}`}
      className="group relative block overflow-hidden rounded-2xl border border-line bg-panel2/40 p-5 shadow-lg ring-1 ring-[#ff4655]/10 transition duration-200 hover:-translate-y-0.5 hover:border-line2 hover:ring-[#ff4655]/25"
    >
      {/* team-colour ambient glows */}
      <span aria-hidden className="pointer-events-none absolute -left-20 -top-24 h-52 w-52 rounded-full opacity-[0.18] blur-3xl" style={{ background: aColor }} />
      <span aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-52 w-52 rounded-full opacity-[0.18] blur-3xl" style={{ background: bColor }} />
      {/* dual-colour hairline */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ backgroundImage: `linear-gradient(90deg, ${aColor}, transparent 42%, transparent 58%, ${bColor})` }}
      />

      {/* header */}
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {match.tournamentLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={match.tournamentLogoUrl} alt="" loading="lazy" className="h-4 w-4 shrink-0 rounded object-contain opacity-90" />
          ) : null}
          <span className="truncate text-xs font-medium text-muted">{match.tournamentName ?? "Pro match"}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {formatTag(match) ? <span className="pill border-line text-[10px] text-muted">{formatTag(match)}</span> : null}
          <LiveBadge />
        </div>
      </div>

      {/* teams flanking the hero score */}
      <div className="relative mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <TeamLogo name={a?.shortName || a?.name} src={a?.logoUrl} color={a?.colorPrimary} size={48} />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold leading-tight text-ink">{a?.shortName || a?.name || "TBD"}</div>
            {showPips ? <MapPips won={aWon} bestOf={bo} color={aColor} /> : null}
          </div>
        </div>

        <div className="flex flex-col items-center px-1">
          <div className="flex items-baseline gap-2 text-4xl font-extrabold leading-none tabular-nums sm:text-5xl">
            <span style={heroAColor ? { color: heroAColor } : undefined} className={heroAColor ? "" : "text-ink"}>
              {heroA}
            </span>
            <span className="text-lg text-faint sm:text-xl">:</span>
            <span style={heroBColor ? { color: heroBColor } : undefined} className={heroBColor ? "" : "text-ink"}>
              {heroB}
            </span>
          </div>
          <div className="mt-1.5 max-w-36 truncate text-center text-[11px] tabular-nums text-faint">
            {lm ? (
              <>
                <span className="font-medium text-muted">{lm.mapName || `Map ${lm.sequence}`}</span>
                {round ? ` · Rd ${round}` : null}
                {clock ? ` · ${clock}` : null}
              </>
            ) : (
              <span className="text-muted">Maps won</span>
            )}
          </div>
        </div>

        <div className="flex min-w-0 items-center justify-end gap-3">
          <div className="min-w-0 text-right">
            <div className="truncate text-[15px] font-bold leading-tight text-ink">{b?.shortName || b?.name || "TBD"}</div>
            {showPips ? <MapPips won={bWon} bestOf={bo} color={bColor} align="right" /> : null}
          </div>
          <TeamLogo name={b?.shortName || b?.name} src={b?.logoUrl} color={b?.colorPrimary} size={48} />
        </div>
      </div>

      {/* round-by-round strip */}
      {lm?.rounds && lm.rounds.length ? (
        <div className="relative mt-4 border-t border-line/50 pt-3">
          <RoundStrip rounds={lm.rounds} teams={match.teams} />
        </div>
      ) : null}

      {/* footer: maps line (Bo3+) + stream */}
      {showPips || match.streamUrl ? (
        <div className="relative mt-3 flex items-center justify-between">
          {showPips ? (
            <span className="text-[11px] tabular-nums text-muted">
              Maps <span className="font-semibold text-ink">{aWon}–{bWon}</span>
            </span>
          ) : (
            <span />
          )}
          {match.streamUrl ? <TwitchLink url={match.streamUrl} /> : null}
        </div>
      ) : null}
    </Link>
  );
}
