"use client";

import Link from "next/link";
import { useState } from "react";
import type { MatchState } from "./types";
import { TeamLogo } from "./TeamLogo";
import { LiveBadge } from "./LiveBadge";
import { RoundStrip } from "./RoundStrip";
import { PointPill } from "./PointPill";
import { MatchDetails } from "./MatchDetails";
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
//
// Three layers: at rest the score, map, round and clock; on hover or focus the
// footer swaps "Maps 1–1" for every map's score so far; the "Maps & scoreboard"
// toggle expands the per-map table and the live map's player scoreboard
// inline (MatchDetails). A click anywhere else opens the match page.
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
  const aName = a?.shortName || a?.name || "TBD";
  const bName = b?.shortName || b?.name || "TBD";

  const maps = match.maps ?? [];
  const hasMaps = maps.length > 0;
  const [open, setOpen] = useState(false);
  const detailsId = `live-details-${match.seriesId}`;
  // One line of the series so far — "Ancient 11–13 · Anubis 16–14 · Dust2 10–7 •"
  // — for the footer on hover. Bo1 has nothing the hero does not already say.
  const mapsLine =
    hasMaps && showPips
      ? maps
          .map((m) => {
            const name = m.mapName || `Map ${m.sequence}`;
            if (!m.started) return name;
            const sa = a ? (m.scoreByTeam?.[a.gridId] ?? 0) : 0;
            const sb = b ? (m.scoreByTeam?.[b.gridId] ?? 0) : 0;
            return `${name} ${sa}–${sb}${m.finished ? "" : " •"}`;
          })
          .join(" · ")
      : "";
  const footer = showPips || hasMaps || !!match.streamUrl;

  // The detail link is a stretched overlay (last in DOM so it paints above the
  // card's relative sections) rather than a wrapping <Link> — the Watch pill is
  // an anchor, and nested <a> is invalid HTML that trips hydration.
  return (
    <div className="group relative block overflow-hidden rounded-xl border border-line bg-panel2/40 p-3.5 shadow-lg ring-1 ring-[#ff4655]/10 transition duration-200 hover:-translate-y-0.5 hover:border-line2 hover:ring-[#ff4655]/25">
      {/* team-colour ambient glows */}
      <span aria-hidden className="pointer-events-none absolute -left-20 -top-24 h-36 w-36 rounded-full opacity-[0.18] blur-3xl" style={{ background: aColor }} />
      <span aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-36 w-36 rounded-full opacity-[0.18] blur-3xl" style={{ background: bColor }} />
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
          <PointPill match={match} map={lm} />
          {formatTag(match) ? <span className="pill border-line text-[10px] text-muted">{formatTag(match)}</span> : null}
          <LiveBadge />
        </div>
      </div>

      {/* teams flanking the hero score */}
      <div className="relative mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <TeamLogo name={aName} src={a?.logoUrl} color={a?.colorPrimary} size={36} />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-bold leading-tight text-ink">{aName}</div>
            {showPips ? <MapPips won={aWon} bestOf={bo} color={aColor} /> : null}
          </div>
        </div>

        <div className="flex flex-col items-center px-1">
          {/* aria-live: the score is what changes between polls, so this line —
              with the team names for context, not the whole card — is what a
              screen reader hears update. */}
          <div
            aria-live="polite"
            aria-atomic="true"
            className="flex items-baseline gap-2 text-2xl font-extrabold leading-none tabular-nums sm:text-3xl"
          >
            <span className="sr-only">{aName} </span>
            <span style={heroAColor ? { color: heroAColor } : undefined} className={heroAColor ? "" : "text-ink"}>
              {heroA}
            </span>
            <span className="text-sm text-faint sm:text-base">:</span>
            <span style={heroBColor ? { color: heroBColor } : undefined} className={heroBColor ? "" : "text-ink"}>
              {heroB}
            </span>
            <span className="sr-only"> {bName}</span>
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

        <div className="flex min-w-0 items-center justify-end gap-2">
          <div className="min-w-0 text-right">
            <div className="truncate text-[13px] font-bold leading-tight text-ink">{bName}</div>
            {showPips ? <MapPips won={bWon} bestOf={bo} color={bColor} align="right" /> : null}
          </div>
          <TeamLogo name={bName} src={b?.logoUrl} color={b?.colorPrimary} size={36} />
        </div>
      </div>

      {/* round-by-round strip */}
      {lm?.rounds && lm.rounds.length ? (
        <div className="relative mt-2.5 border-t border-line/50 pt-2">
          <RoundStrip rounds={lm.rounds} teams={match.teams} />
        </div>
      ) : null}

      {/* footer: maps line (series score at rest, per-map scores on hover) +
          the details toggle + stream */}
      {footer ? (
        <div className="relative mt-2 flex items-center justify-between gap-2">
          <span className="grid min-w-0 flex-1 text-[11px] tabular-nums text-muted">
            {showPips ? (
              <span
                className={`col-start-1 row-start-1 transition-opacity ${
                  mapsLine ? "group-hover:opacity-0 group-focus-within:opacity-0" : ""
                }`}
              >
                Maps <span className="font-semibold text-ink">{aWon}–{bWon}</span>
              </span>
            ) : null}
            {mapsLine ? (
              <span
                className="col-start-1 row-start-1 truncate opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                title={mapsLine}
              >
                {mapsLine}
              </span>
            ) : null}
          </span>
          <span className="relative z-10 flex shrink-0 items-center gap-1.5">
            {hasMaps ? (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={detailsId}
                onClick={() => setOpen((v) => !v)}
                className="pill border-line text-[10px] font-semibold text-muted transition-colors hover:border-brand/50 hover:text-ink"
              >
                Maps &amp; scoreboard
                <svg
                  aria-hidden
                  viewBox="0 0 20 20"
                  className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="m5 8 5 5 5-5" />
                </svg>
              </button>
            ) : null}
            {match.streamUrl ? <TwitchLink url={match.streamUrl} /> : null}
          </span>
        </div>
      ) : null}

      {open && hasMaps ? <MatchDetails match={match} id={detailsId} /> : null}

      <Link
        href={`/pro-matches/${match.seriesId}`}
        aria-label={`${aName} vs ${bName} — live match page`}
        className="absolute inset-0 rounded-xl"
      />
    </div>
  );
}
