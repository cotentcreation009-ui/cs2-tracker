import type {
  FaceitProfile,
  LeetifyProfile,
  MapStat,
  PlayerMatchSummary,
  PlayerProfile,
  SteamExtras,
  SteamGameStats,
  WeaponStat,
} from "@/lib/types";
import type { ReactNode } from "react";
import { StatCard } from "@/components/StatCard";
import { RatingRing } from "@/components/RatingRing";
import { RecentMatches } from "@/components/RecentMatches";
import { RecentForm } from "@/components/RecentForm";
import { ParsedTrendChart } from "@/components/ParsedTrendChart";
import { LiveTrendChart } from "@/components/LiveTrendChart";
import { WeaponStats } from "@/components/WeaponStats";
import { MapStats } from "@/components/MapStats";
import { LeetifyPanel } from "@/components/LeetifyPanel";
import { FaceitPanel } from "@/components/FaceitPanel";
import { RankStrip } from "@/components/RankBadge";
import { MapStrength } from "@/components/MapStrength";
import { LiveForm } from "@/components/LiveForm";
import { CounterReport } from "@/components/CounterReport";
import { ShareButton } from "@/components/ShareButton";
import { RecordRecent } from "@/components/RecordRecent";
import { SteamStatsPanel } from "@/components/SteamStatsPanel";
import { CrossSource } from "@/components/CrossSource";
import { CheatMeter } from "@/components/CheatMeter";
import { PlatformSplit } from "@/components/PlatformSplit";
import { computeSuspicion } from "@/lib/suspicion";
import Link from "next/link";
import {
  flag,
  fmt,
  kdColor,
  ratingColor,
  tierColor,
} from "@/lib/format";

const PERSONA: Record<number, string> = {
  1: "Online",
  2: "Busy",
  3: "Away",
  4: "Snooze",
  5: "Online",
  6: "Online",
};

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted">
      <span className="h-3.5 w-1 rounded-full bg-linear-to-b from-brand to-brand2" />
      {children}
    </h2>
  );
}

export function ProfileView({
  profile,
  matches,
  weapons = [],
  maps = [],
  leetify = null,
  faceit = null,
  steamExtras = null,
  steamStats = null,
}: {
  profile: PlayerProfile;
  matches: PlayerMatchSummary[];
  weapons?: WeaponStat[];
  maps?: MapStat[];
  leetify?: LeetifyProfile | null;
  faceit?: FaceitProfile | null;
  steamExtras?: SteamExtras | null;
  steamStats?: SteamGameStats | null;
}) {
  const { player, career } = profile;
  const hasData = career.matches > 0;

  // Steam account age (public profiles only).
  const steamCreated = player.steamCreatedAt
    ? new Date(player.steamCreatedAt)
    : null;
  const accountAgeYears = steamCreated
    ? (Date.now() - steamCreated.getTime()) / (365.25 * 24 * 3600 * 1000)
    : null;

  // The CheatMeter is the page hero when there's enough data to analyze; it
  // self-hides otherwise, in which case we fall back to the plain hero below.
  const showMeter = !!computeSuspicion(leetify, faceit, steamStats, steamExtras)?.hasEnough;

  // The content behind the three name buttons — rendered here (server-side) and
  // handed to StatsPeek, which shows it in a modal over the CheatMeter. When the
  // CheatMeter is the whole page (showMeter), these popups carry ALL the detail
  // that used to sit below it, so a slot bundles its related sections:
  //   • FACEIT      → platform split + FACEIT career
  //   • Leetify     → full skill breakdown
  //   • Counter     → map ban plan (map win rates now live in the CheatMeter box)
  //   • Match stats → parsed career/weapons/maps/recent matches + Steam + cross-source
  // A slot is null when its data is absent, which also hides that button.
  const splitMatches = leetify?.recent_matches ?? [];
  const openTotal = career.openingKills + career.openingDeaths;
  const openWinPct = openTotal > 0 ? (career.openingKills / openTotal) * 100 : 0;
  const clutchTotal = career.clutchesWon + career.clutchesLost;
  const clutchWinPct =
    clutchTotal > 0 ? (career.clutchesWon / clutchTotal) * 100 : 0;

  // Per-round rates derived from the career sums (no extra stored columns).
  const rounds = career.roundsPlayed;
  const kpr = rounds > 0 ? career.kills / rounds : 0;
  const dpr = rounds > 0 ? career.deaths / rounds : 0;
  const udPerRound = rounds > 0 ? career.utilityDamage / rounds : 0;
  const flashesPerRound = rounds > 0 ? career.enemiesFlashed / rounds : 0;
  const mvpsPerMatch = career.matches > 0 ? career.mvps / career.matches : 0;

  // Full parsed-match detail + Steam lifetime stats + cross-source — everything
  // that doesn't fit the compact CheatMeter box. Rendered inline on the fallback
  // page, and behind the "Match stats" button when the box is the whole page, so
  // no data is ever dropped. Each sub-section self-hides when its data is absent.
  const matchStatsPanel =
    hasData || steamStats || leetify || faceit ? (
      <div className="space-y-5">
        {hasData && (
          <>
            <section>
              <SectionTitle>Career stats</SectionTitle>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <StatCard
                  label="Matches"
                  value={fmt(career.matches)}
                  sub={<span><span className="text-good">{career.wins}W</span> <span className="text-bad">{career.losses}L</span></span>}
                />
                <StatCard label="Win rate" value={`${career.winRate.toFixed(0)}%`} valueClass={tierColor(career.winRate, 55, 45)} />
                <StatCard label="K / D" value={career.kd.toFixed(2)} valueClass={kdColor(career.kd)} sub={`${fmt(career.kills)} / ${fmt(career.deaths)}`} />
                <StatCard label="ADR" value={career.adr.toFixed(0)} valueClass={tierColor(career.adr, 80, 65)} />
                <StatCard label="KAST" value={`${career.kastPct.toFixed(0)}%`} valueClass={tierColor(career.kastPct, 72, 65)} />
                <StatCard label="Headshot %" value={`${career.hsPct.toFixed(0)}%`} valueClass={tierColor(career.hsPct, 50, 40)} />
              </div>
            </section>

            {matches.length > 0 && <RecentForm matches={matches} />}
            {matches.length > 1 && <ParsedTrendChart matches={matches} />}

            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatCard label="Rounds" value={fmt(career.roundsPlayed)} />
              <StatCard label="Opening duels" value={`${openWinPct.toFixed(0)}%`} valueClass={tierColor(openWinPct, 55, 45)} sub={`${fmt(career.openingKills)}–${fmt(career.openingDeaths)}`} />
              <StatCard label="Clutch win" value={`${clutchWinPct.toFixed(0)}%`} valueClass={tierColor(clutchWinPct, 50, 30)} sub={`${fmt(career.clutchesWon)}/${fmt(clutchTotal)}`} />
              <StatCard label="Assists" value={fmt(career.assists)} />
              <StatCard label="Career rating" value={career.rating.toFixed(2)} valueClass={ratingColor(career.rating)} />
            </section>

            <section>
              <SectionTitle>Utility &amp; impact</SectionTitle>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <StatCard label="Kills / round" value={kpr.toFixed(2)} valueClass={tierColor(kpr, 0.75, 0.6)} />
                <StatCard label="Deaths / round" value={dpr.toFixed(2)} />
                <StatCard label="Utility dmg / round" value={udPerRound.toFixed(1)} valueClass={tierColor(udPerRound, 8, 5)} sub={`${fmt(career.utilityDamage)} total`} />
                <StatCard label="Flashes / round" value={flashesPerRound.toFixed(2)} valueClass={tierColor(flashesPerRound, 1, 0.6)} sub={`${fmt(career.enemiesFlashed)} enemies`} />
                <StatCard label="MVPs" value={fmt(career.mvps)} sub={`${mvpsPerMatch.toFixed(1)} / match`} />
              </div>
            </section>

            <section className="grid gap-5 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <SectionTitle>Recent matches</SectionTitle>
                <RecentMatches matches={matches} />
              </div>
              <div className="space-y-5">
                {maps.length > 0 && (
                  <div>
                    <SectionTitle>Maps</SectionTitle>
                    <MapStats maps={maps} />
                  </div>
                )}
                {weapons.length > 0 && (
                  <div>
                    <SectionTitle>Top weapons</SectionTitle>
                    <WeaponStats weapons={weapons} />
                  </div>
                )}
              </div>
            </section>
          </>
        )}

        {steamStats && <SteamStatsPanel data={steamStats} />}

        <CrossSource career={career} leetify={leetify} faceit={faceit} steamStats={steamStats} />
      </div>
    ) : null;

  const panels = {
    split:
      splitMatches.length > 0 || faceit ? (
        <div className="space-y-4">
          {splitMatches.length > 0 && (
            <PlatformSplit matches={splitMatches} faceitMatches={leetify?.faceit_matches} />
          )}
          {faceit && <FaceitPanel profile={faceit} />}
        </div>
      ) : null,
    leetify: leetify ? <LeetifyPanel profile={leetify} /> : null,
    counter: leetify ? (
      <CounterReport
        leetify={leetify}
        faceit={faceit}
        steamStats={steamStats}
        name={player.personaName || "this player"}
      />
    ) : null,
    matchstats: matchStatsPanel,
  };

  return (
    // Full-bleed: the whole stats page uses the viewport width, matching the
    // CheatMeter hero (the page <main> otherwise caps content at max-w-6xl).
    <div className="full-bleed space-y-5 px-4 lg:px-6">
      <RecordRecent
        player={{
          steamId64: player.steamId64,
          personaName: player.personaName,
          avatarUrl: player.avatarUrl,
        }}
      />

      {/* CheatMeter is the hero when there's enough data — full-bleed, with the
          full identity + Premier/FACEIT/Wingman ranks folded in. */}
      {showMeter && (
        <CheatMeter
          player={player}
          leetify={leetify}
          faceit={faceit}
          steamStats={steamStats}
          steamExtras={steamExtras}
          rating={hasData ? career.rating : null}
          career={career}
          panels={panels}
          generatedOn={new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        />
      )}

      {/* Fallback hero for accounts without enough data for the CheatMeter */}
      {!showMeter && (
        <>
      {/* Profile hero */}
      <section className="card-2 relative overflow-hidden">
        {/* faint brand banner (reuses the hero artwork) */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/hero-holo.webp"
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-[0.22]"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, rgba(4,6,14,0.30), rgba(14,23,48,0.92))",
            }}
          />
        </div>

        <div className="relative flex flex-col gap-5 px-5 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="shrink-0 rounded-2xl bg-linear-to-br from-brand to-brand2 p-[2px] shadow-[0_0_26px_-6px_rgba(91,157,255,0.55)]">
              {player.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={player.avatarUrl}
                  alt={player.personaName}
                  className="h-20 w-20 rounded-[14px] object-cover"
                />
              ) : (
                <div className="grid h-20 w-20 place-items-center rounded-[14px] bg-panel text-2xl font-bold text-faint">
                  {(player.personaName || "?").slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-extrabold leading-tight sm:text-3xl">
                {player.personaName || player.steamId64}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {steamExtras?.personaState != null &&
                  steamExtras.personaState > 0 && (
                    <span className="pill bg-good/15 text-good">
                      <span className="h-1.5 w-1.5 rounded-full bg-good" />
                      {PERSONA[steamExtras.personaState] || "Online"}
                    </span>
                  )}
                {steamExtras?.visibility === 1 && (
                  <span className="pill bg-mid/15 text-mid">Private profile</span>
                )}
                {steamExtras?.visibility === 2 && (
                  <span className="pill bg-mid/15 text-mid">Friends only</span>
                )}
                {player.countryCode && (
                  <span className="pill bg-panel text-muted">
                    {flag(player.countryCode)} {player.countryCode}
                  </span>
                )}
                {steamCreated && accountAgeYears != null && (
                  <span
                    className="pill bg-panel text-muted"
                    title={`Steam account created ${steamCreated.toLocaleDateString()}`}
                  >
                    {accountAgeYears.toFixed(1)}y on Steam
                  </span>
                )}
                {steamExtras != null && steamExtras.steamLevel > 0 && (
                  <span className="pill bg-panel text-muted">
                    Steam lvl {steamExtras.steamLevel}
                  </span>
                )}
                {steamExtras != null && steamExtras.friends > 0 && (
                  <span className="pill bg-panel text-muted">
                    {steamExtras.friends.toLocaleString("en-US")} friends
                  </span>
                )}
                {steamExtras?.friendCode && (
                  <span className="pill bg-panel font-mono text-muted">
                    {steamExtras.friendCode}
                  </span>
                )}
                {player.profileUrl && (
                  <a
                    href={player.profileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="pill bg-panel text-muted transition hover:text-ink"
                  >
                    Steam ↗
                  </a>
                )}
              </div>
              <div className="mt-1.5 font-mono text-[11px] text-faint">
                {player.steamId64}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 sm:flex-col sm:items-end">
            {hasData && <RatingRing rating={career.rating} />}
            <div className="flex gap-2">
              <ShareButton label="Share" />
              <Link
                href={`/compare?a=${player.steamId64}`}
                className="inline-flex shrink-0 items-center rounded-lg border border-line bg-panel2 px-3 py-1.5 text-sm font-medium text-ink transition hover:border-brand/60"
              >
                Compare
              </Link>
            </div>
          </div>
        </div>
      </section>

      <RankStrip leetify={leetify} faceit={faceit} />

      {/* Everything below is the traditional full page, shown ONLY when there's
          no CheatMeter. When the CheatMeter IS shown it's the whole screen — all
          of this detail lives in its three popup buttons instead. */}

      {leetify?.recent_matches && leetify.recent_matches.length > 0 && (
        <PlatformSplit matches={leetify.recent_matches} faceitMatches={leetify.faceit_matches} />
      )}

      {/* Recent form & trends — collapsed by default (the CheatMeter hero
          already shows recent W/L + a consistency trend), available on demand. */}
      {leetify?.recent_matches && leetify.recent_matches.length > 0 && (
        <details className="group card-2 px-5 py-4">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted [&::-webkit-details-marker]:hidden">
            <span className="h-3.5 w-1 rounded-full bg-linear-to-b from-brand to-brand2" />
            Recent form &amp; trends
            <span className="ml-2 text-[10px] font-normal normal-case text-faint">last {leetify.recent_matches.length}</span>
            <svg
              className="ml-auto h-4 w-4 text-faint transition-transform group-open:rotate-180"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </summary>
          <div className="mt-4 space-y-4">
            <LiveForm matches={leetify.recent_matches} />
            {leetify.recent_matches.length > 1 && (
              <LiveTrendChart matches={leetify.recent_matches} />
            )}
            <div className="text-right">
              <Link
                href={`/profiles/${player.steamId64}/matches`}
                className="text-sm font-medium text-brand hover:underline"
              >
                View all matches →
              </Link>
            </div>
          </div>
        </details>
      )}

      {leetify && <LeetifyPanel profile={leetify} />}

      {/* Other platforms */}
      {faceit && <FaceitPanel profile={faceit} />}

      {leetify?.recent_matches && leetify.recent_matches.length > 0 && (
        <MapStrength matches={leetify.recent_matches} />
      )}

      {!hasData && !leetify && !faceit && !steamStats && (
        <div className="card px-5 py-6 text-sm text-muted">
          We know this player&apos;s Steam identity, but have no CS2 stats for
          them yet — their Leetify/FACEIT profile may be private or unavailable.
        </div>
      )}

      {matchStatsPanel}

      {leetify && (
        <CounterReport
          leetify={leetify}
          faceit={faceit}
          steamStats={steamStats}
          name={player.personaName || "this player"}
        />
      )}
        </>
      )}

    </div>
  );
}
