import type {
  LeetifyProfile,
  MapStat,
  PlayerMatchSummary,
  PlayerProfile,
  WeaponStat,
} from "@/lib/types";
import { StatCard } from "@/components/StatCard";
import { RatingRing } from "@/components/RatingRing";
import { RecentMatches } from "@/components/RecentMatches";
import { RecentForm } from "@/components/RecentForm";
import { RatingTrend } from "@/components/RatingTrend";
import { WeaponStats } from "@/components/WeaponStats";
import { MapStats } from "@/components/MapStats";
import { LeetifyPanel } from "@/components/LeetifyPanel";
import {
  flag,
  fmt,
  kdColor,
  ratingColor,
  tierColor,
} from "@/lib/format";

export function ProfileView({
  profile,
  matches,
  weapons = [],
  maps = [],
  leetify = null,
  isSelf = false,
}: {
  profile: PlayerProfile;
  matches: PlayerMatchSummary[];
  weapons?: WeaponStat[];
  maps?: MapStat[];
  leetify?: LeetifyProfile | null;
  isSelf?: boolean;
}) {
  const { player, career } = profile;
  const hasData = career.matches > 0;
  const multiKillRounds = career.k3 + career.k4 + career.k5;

  const openTotal = career.openingKills + career.openingDeaths;
  const openWinPct = openTotal > 0 ? (career.openingKills / openTotal) * 100 : 0;
  const clutchTotal = career.clutchesWon + career.clutchesLost;
  const clutchWinPct =
    clutchTotal > 0 ? (career.clutchesWon / clutchTotal) * 100 : 0;

  return (
    <div className="space-y-5">
      {/* Identity + rating */}
      <section className="card-2 flex flex-col gap-5 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          {player.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={player.avatarUrl}
              alt={player.personaName}
              className="h-20 w-20 rounded-xl border border-line object-cover"
            />
          ) : (
            <div className="grid h-20 w-20 place-items-center rounded-xl border border-line bg-panel text-2xl font-bold text-faint">
              {(player.personaName || "?").slice(0, 1).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold leading-tight">
              {player.personaName || player.steamId64}
              {isSelf && (
                <span className="rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">
                  This is you
                </span>
              )}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              {player.countryCode && (
                <span>
                  {flag(player.countryCode)} {player.countryCode}
                </span>
              )}
              <span className="font-mono text-xs text-faint">
                {player.steamId64}
              </span>
              {player.profileUrl && (
                <a
                  href={player.profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="link-muted underline-offset-2 hover:underline"
                >
                  View on Steam ↗
                </a>
              )}
            </div>
          </div>
        </div>

        {hasData && <RatingRing rating={career.rating} />}
      </section>

      {leetify && <LeetifyPanel profile={leetify} />}

      {!hasData && !leetify && (
        <div className="card px-5 py-6 text-sm text-muted">
          We know this player&apos;s Steam identity, but no demos have been
          parsed for them yet. Ingest a demo via{" "}
          <code className="rounded bg-panel px-1.5 py-0.5 text-xs text-ink">
            POST /api/ingest/demo
          </code>{" "}
          to populate career stats and match history.
        </div>
      )}

      {hasData && (
        <>
          {/* Headline stats */}
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <StatCard
              label="Matches"
              value={fmt(career.matches)}
              sub={
                <span>
                  <span className="text-good">{career.wins}W</span>{" "}
                  <span className="text-bad">{career.losses}L</span>
                </span>
              }
            />
            <StatCard
              label="Win rate"
              value={`${career.winRate.toFixed(0)}%`}
              valueClass={tierColor(career.winRate, 55, 45)}
            />
            <StatCard
              label="K / D"
              value={career.kd.toFixed(2)}
              valueClass={kdColor(career.kd)}
              sub={`${fmt(career.kills)} / ${fmt(career.deaths)}`}
            />
            <StatCard
              label="ADR"
              value={career.adr.toFixed(0)}
              valueClass={tierColor(career.adr, 80, 65)}
            />
            <StatCard
              label="KAST"
              value={`${career.kastPct.toFixed(0)}%`}
              valueClass={tierColor(career.kastPct, 72, 65)}
            />
            <StatCard
              label="Headshot %"
              value={`${career.hsPct.toFixed(0)}%`}
              valueClass={tierColor(career.hsPct, 50, 40)}
            />
          </section>

          {matches.length > 0 && (
            <section className="grid gap-3 lg:grid-cols-2">
              <RecentForm matches={matches} />
              <RatingTrend matches={matches} />
            </section>
          )}

          {/* Secondary stats */}
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Rounds" value={fmt(career.roundsPlayed)} />
            <StatCard
              label="Opening duels"
              value={`${openWinPct.toFixed(0)}%`}
              valueClass={tierColor(openWinPct, 55, 45)}
              sub={`${fmt(career.openingKills)}–${fmt(career.openingDeaths)}`}
            />
            <StatCard
              label="Clutch win"
              value={`${clutchWinPct.toFixed(0)}%`}
              valueClass={tierColor(clutchWinPct, 50, 30)}
              sub={`${fmt(career.clutchesWon)}/${fmt(clutchTotal)}`}
            />
            <StatCard label="Multi-kill rounds" value={fmt(multiKillRounds)} />
            <StatCard label="Assists" value={fmt(career.assists)} />
            <StatCard
              label="Career rating"
              value={career.rating.toFixed(2)}
              valueClass={ratingColor(career.rating)}
            />
          </section>

          {/* Recent matches + weapons */}
          <section className="grid gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
                Recent matches
              </h2>
              <RecentMatches matches={matches} />
            </div>
            <div className="space-y-5">
              {maps.length > 0 && (
                <div>
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
                    Maps
                  </h2>
                  <MapStats maps={maps} />
                </div>
              )}
              {weapons.length > 0 && (
                <div>
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
                    Top weapons
                  </h2>
                  <WeaponStats weapons={weapons} />
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
