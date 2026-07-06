import type {
  FaceitProfile,
  LeetifyProfile,
  Player,
  PlayerCareer,
  SteamExtras,
  SteamGameStats,
} from "@/lib/types";
import {
  BAND_HEX,
  BAND_LABEL,
  BAND_TEXT,
  RISK_LABEL,
  computeSuspicion,
  type Band,
  type SusFactor,
  type Suspicion,
} from "@/lib/suspicion";
import { flag, fmt, kdColor, tierColor } from "@/lib/format";
import Link from "next/link";
import { ShareButton } from "@/components/ShareButton";
import { RatingRing } from "@/components/RatingRing";
import { type PremierPoint } from "@/components/PremierRank";
import { RankRow } from "@/components/RankRow";
import { StatsPeek } from "@/components/StatsPeek";
import { RatingConsistencyChart } from "@/components/RatingConsistencyChart";
import { MapWinChart } from "@/components/MapStrength";
import type { ReactNode } from "react";

const PERSONA: Record<number, string> = { 1: "Online", 2: "Busy", 3: "Away", 4: "Snooze", 5: "Online", 6: "Online" };

// --- tiny icon set (stroke glyphs) ------------------------------------------
function Icon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  const p: Record<string, React.ReactNode> = {
    bolt: <path d="M13 2 4 14h6l-1 8 9-12h-6z" />,
    target: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    cross: (
      <>
        <circle cx="12" cy="12" r="7" />
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      </>
    ),
    swap: <path d="M4 8h13l-3-3M20 16H7l3 3" />,
    chart: <path d="M4 20V10M10 20V4M16 20v-7M20 20H3" />,
    flask: <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" />,
    flame: <path d="M12 3c1 4 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 .5 2 2 2 3 1-1-2-1-4 0-6z" />,
    shield: <path d="M12 3 5 6v5c0 4 3 7 7 8 4-1 7-4 7-8V6z" />,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {p[name] ?? p.target}
    </svg>
  );
}

const factorTag = (f: SusFactor): string => {
  if (f.key === "bans") return f.score > 0 ? "Flagged" : "Clean";
  return f.band === "verylow" ? "Normal" : BAND_LABEL[f.band];
};

// --- semicircular gauge -----------------------------------------------------
function Gauge({ score, hex }: { score: number; hex: string }) {
  const cx = 130;
  const cy = 132;
  const r = 104;
  const pol = (t: number, rad: number): [number, number] => {
    const a = (180 * (1 - t / 100) * Math.PI) / 180;
    return [cx + rad * Math.cos(a), cy - rad * Math.sin(a)];
  };
  const [nx, ny] = pol(score, r - 16);
  const ticks = [0, 25, 50, 75, 100];
  return (
    <svg viewBox="0 0 260 165" className="mt-1 w-full max-w-[250px]">
      <defs>
        <linearGradient id="cm-arc" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#46d369" />
          <stop offset="40%" stopColor="#f5b942" />
          <stop offset="68%" stopColor="#ff8a3d" />
          <stop offset="100%" stopColor="#f5694a" />
        </linearGradient>
      </defs>
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="url(#cm-arc)"
        strokeWidth="16"
        strokeLinecap="round"
      />
      {ticks.map((t) => {
        const [lx, ly] = pol(t, r + 16);
        const anchor = t < 45 ? "start" : t > 55 ? "end" : "middle";
        return (
          <text
            key={t}
            x={lx}
            y={ly}
            textAnchor={anchor}
            className="fill-faint text-[10px]"
          >
            {t}%
          </text>
        );
      })}
      <text
        x={cx}
        y={cy - 22}
        textAnchor="middle"
        className="fill-muted"
        style={{ fontSize: 38, opacity: 0.12 }}
      >
        ☠
      </text>
      <line
        x1={cx}
        y1={cy}
        x2={nx}
        y2={ny}
        stroke={hex}
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r="8" fill={hex} />
      <circle cx={cx} cy={cy} r="3.5" fill="var(--color-bg)" />
    </svg>
  );
}

const BANDS: { b: Band; r: string }[] = [
  { b: "verylow", r: "0–20%" },
  { b: "low", r: "20–40%" },
  { b: "moderate", r: "40–60%" },
  { b: "high", r: "60–80%" },
  { b: "veryhigh", r: "80–100%" },
];

function BandLegend({ band }: { band: Band }) {
  return (
    <div className="mt-1.5 grid grid-cols-5 gap-1">
      {BANDS.map((x) => {
        const on = x.b === band;
        return (
          <div
            key={x.b}
            className="rounded-md border px-1 py-1 text-center"
            style={
              on
                ? { borderColor: BAND_HEX[band], background: `${BAND_HEX[band]}1f` }
                : { borderColor: "var(--color-line)" }
            }
          >
            <div
              className="text-[9px] font-bold uppercase leading-tight"
              style={{ color: on ? BAND_HEX[band] : "var(--color-faint)" }}
            >
              {BAND_LABEL[x.b]}
            </div>
            <div className="text-[9px] text-faint">{x.r}</div>
          </div>
        );
      })}
    </div>
  );
}

// --- compact career stat ----------------------------------------------------
function CStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-2.5 py-1.5">
      <div className="stat-label">{label}</div>
      <div className={`mt-0.5 text-sm font-bold tabular-nums ${color ?? "text-ink"}`}>{value}</div>
    </div>
  );
}

// --- match-history donut ----------------------------------------------------
function Donut({
  wins,
  losses,
  draws,
  total,
  sizeClass = "h-32 w-32",
}: {
  wins: number;
  losses: number;
  draws: number;
  total: number;
  sizeClass?: string;
}) {
  const R = 54;
  const C = 2 * Math.PI * R;
  const cx = 70;
  const cy = 70;
  const segs = [
    { v: wins, c: "#46d369" },
    { v: losses, c: "#f5694a" },
    { v: draws, c: "#f5b942" },
  ];
  let acc = 0;
  return (
    <svg viewBox="0 0 140 140" className={`${sizeClass} shrink-0`}>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--color-line)" strokeWidth="13" />
      {segs.map((s, i) => {
        const frac = total ? s.v / total : 0;
        const len = frac * C;
        const el = (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={R}
            fill="none"
            stroke={s.c}
            strokeWidth="13"
            strokeDasharray={`${len} ${C - len}`}
            strokeDashoffset={-acc}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        );
        acc += len;
        return el;
      })}
      <text x={cx} y={cy - 1} textAnchor="middle" className="fill-ink" style={{ fontSize: 26, fontWeight: 800 }}>
        {total}
      </text>
      <text x={cx} y={cy + 15} textAnchor="middle" className="fill-faint" style={{ fontSize: 9, letterSpacing: 1 }}>
        MATCHES
      </text>
    </svg>
  );
}

const VERDICT_TITLE: Record<Band, string> = {
  verylow: "Looks legit",
  low: "Likely legit",
  moderate: "Some flags",
  high: "Suspicious",
  veryhigh: "Highly suspicious",
};

/**
 * CheatMeter rolls every cheating-associated signal we can derive from public
 * stats into one dashboard — gauge, factor breakdown, per-metric scales,
 * cross-queue performance, recent W/L and a confidence read. It is explicitly a
 * "look closer" anomaly score, NOT proof; elite legit players score high too.
 */
export function CheatMeter({
  player,
  leetify,
  faceit,
  steamStats,
  steamExtras,
  rating,
  career,
  generatedOn,
  panels,
}: {
  player: Player;
  leetify?: LeetifyProfile | null;
  faceit?: FaceitProfile | null;
  steamStats?: SteamGameStats | null;
  steamExtras?: SteamExtras | null;
  rating?: number | null;
  career?: PlayerCareer | null;
  generatedOn?: string;
  // Pre-rendered section nodes shown in the StatsPeek modal (built in ProfileView
  // so the server components render server-side); a missing slot hides its button.
  panels?: { split?: ReactNode; leetify?: ReactNode; counter?: ReactNode; matchstats?: ReactNode };
}) {
  const sus: Suspicion | null = computeSuspicion(leetify, faceit, steamStats, steamExtras);
  if (!sus || !sus.hasEnough) return null;

  // identity + ranks for the hero (everything visible in the CheatMeter view)
  const steamCreated = player.steamCreatedAt ? new Date(player.steamCreatedAt) : null;
  const ageY =
    steamCreated && !Number.isNaN(steamCreated.getTime())
      ? (Date.now() - steamCreated.getTime()) / (365.25 * 24 * 3600 * 1000)
      : null;
  const premier = leetify?.ranks?.premier ?? 0;
  const premierHistory: PremierPoint[] = (leetify?.recent_matches ?? [])
    .filter((m) => m.rank_type === 11 && (m.rank ?? 0) > 0)
    .map((m) => ({ rating: m.rank as number, date: m.finished_at }));
  const {
    score,
    band,
    subtitle,
    verdict,
    confidence,
    lowConfidence,
    factors,
    summary,
    scope,
    trend,
  } = sus;
  const hex = BAND_HEX[band];
  const pct = (v: number) => (summary.total ? (v / summary.total) * 100 : 0);

  // Career stats + map win rates now fill the row where the scale cards used to
  // sit — those duplicated the factors column, whereas these are new signal.
  const recentMatches = leetify?.recent_matches ?? [];
  const distinctMaps = new Set(
    recentMatches.filter((m) => m.map_name).map((m) => m.map_name),
  ).size;
  const showMapChart = distinctMaps >= 3;
  const showCareer = !!career && career.matches > 0;
  const openTotal = career ? career.openingKills + career.openingDeaths : 0;
  const openPct = openTotal > 0 ? (career!.openingKills / openTotal) * 100 : 0;
  const clutchTotal = career ? career.clutchesWon + career.clutchesLost : 0;
  const clutchPct = clutchTotal > 0 ? (career!.clutchesWon / clutchTotal) * 100 : 0;
  const udPerRound =
    career && career.roundsPlayed > 0 ? career.utilityDamage / career.roundsPlayed : 0;

  // Most profiles have NO parsed-demo career yet — the parsed numbers only exist
  // once we've ingested their demos. So when they're absent, fill the same card
  // from Leetify / FACEIT / Steam instead, so every profile gets its career
  // panel (clearly labelled by source). Cells self-hide when a value is missing.
  const ls0 = leetify?.stats;
  const fallbackCells: { label: string; value: string; color?: string }[] = [];
  if (!showCareer) {
    const st = steamStats?.stats;
    const cMatches =
      leetify?.total_matches || faceit?.matches || st?.["total_matches_played"] || 0;
    if (cMatches > 0)
      fallbackCells.push({ label: "Matches", value: fmt(cMatches) });
    const cWin =
      leetify && leetify.winrate > 0
        ? leetify.winrate * 100
        : faceit && faceit.winRatePct > 0
          ? faceit.winRatePct
          : st?.["total_wins"] && st?.["total_matches_played"]
            ? (st["total_wins"] / st["total_matches_played"]) * 100
            : 0;
    if (cWin > 0)
      fallbackCells.push({ label: "Win rate", value: `${cWin.toFixed(0)}%`, color: tierColor(cWin, 55, 45) });
    const cKd =
      leetify?.kd ||
      faceit?.kdRatio ||
      (st?.["total_kills"] && st?.["total_deaths"] ? st["total_kills"] / st["total_deaths"] : 0);
    if (cKd > 0)
      fallbackCells.push({ label: "K/D", value: cKd.toFixed(2), color: kdColor(cKd) });
    const cHs =
      faceit?.hsPct ||
      (st?.["total_kills_headshot"] && st?.["total_kills"]
        ? (st["total_kills_headshot"] / st["total_kills"]) * 100
        : 0);
    if (cHs > 0)
      fallbackCells.push({ label: "HS %", value: `${cHs.toFixed(0)}%`, color: tierColor(cHs, 50, 40) });
    const openCt = ls0?.ct_opening_duel_success_percentage ?? 0;
    const openT = ls0?.t_opening_duel_success_percentage ?? 0;
    const cOpen = openCt > 0 && openT > 0 ? (openCt + openT) / 2 : openCt || openT;
    if (cOpen > 0)
      fallbackCells.push({ label: "Opening", value: `${cOpen.toFixed(0)}%`, color: tierColor(cOpen, 55, 45) });
    if (ls0 && ls0.trade_kills_success_percentage > 0)
      fallbackCells.push({ label: "Trades won", value: `${ls0.trade_kills_success_percentage.toFixed(0)}%` });
    if (ls0 && ls0.spray_accuracy > 0)
      fallbackCells.push({ label: "Spray acc", value: `${ls0.spray_accuracy.toFixed(0)}%` });
    if (ls0 && ls0.counter_strafing_good_shots_ratio > 0)
      fallbackCells.push({
        label: "C-strafe",
        value: `${(ls0.counter_strafing_good_shots_ratio * 100).toFixed(0)}%`,
      });
    if (st?.["total_mvps"] && fallbackCells.length < 8)
      fallbackCells.push({ label: "MVPs", value: fmt(st["total_mvps"]) });
  }
  // The career card renders for parsed data OR a reasonably-filled fallback.
  const showCareerCard = showCareer || fallbackCells.length >= 3;

  // A friends-only Leetify profile redacts the aim micro-stats (reaction/preaim/
  // HS → 0), so most of the CheatMeter's scale cards are missing. Surface the
  // performance stats we DO have (ratings, ranks, K/D, win rate…) right by the
  // meter so a private profile still reads as a full page.
  const ls = leetify?.stats;
  const statsHidden =
    !!leetify &&
    leetify.total_matches > 0 &&
    (ls?.accuracy_head ?? 0) === 0 &&
    (ls?.preaim ?? 0) === 0 &&
    (ls?.reaction_time_ms ?? 0) === 0;
  const sgn1 = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
  const perfStats: { label: string; value: string }[] =
    leetify && statsHidden
      ? [
          leetify.ranks?.leetify != null
            ? { label: "Rating", value: sgn1(leetify.ranks.leetify) }
            : null,
          { label: "Aim", value: leetify.rating.aim.toFixed(0) },
          { label: "Position", value: leetify.rating.positioning.toFixed(0) },
          { label: "Utility", value: leetify.rating.utility.toFixed(0) },
          { label: "Clutch", value: sgn1(leetify.rating.clutch * 100) },
          { label: "Opening", value: sgn1(leetify.rating.opening * 100) },
          leetify.kd ? { label: "K/D", value: leetify.kd.toFixed(2) } : null,
          { label: "Win rate", value: `${(leetify.winrate * 100).toFixed(0)}%` },
          { label: "Matches", value: leetify.total_matches.toLocaleString("en-US") },
          leetify.peak_premier
            ? { label: "Peak Premier", value: leetify.peak_premier.toLocaleString("en-US") }
            : null,
          leetify.avg_party_size
            ? { label: "Avg party", value: leetify.avg_party_size.toFixed(1) }
            : null,
        ].filter((x): x is { label: string; value: string } => x != null)
      : [];

  return (
    <section className="card-2 px-5 py-4">
      {/* top row: title (left) · player identity + section buttons (center) · actions (right) —
          one slim line so the meter grid gets the vertical room. */}
      <div className="mb-3 grid grid-cols-1 items-center gap-2 border-b border-line/60 pb-3 lg:grid-cols-[1fr_auto_1fr]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-lg bg-bad/15 text-bad">
            <Icon name="shield" className="h-3.5 w-3.5" />
          </span>
          <h2 className="text-base font-extrabold tracking-tight">CheatMeter</h2>
          <span className="pill bg-brand/15 text-brand">BETA</span>
          {lowConfidence && (
            <span
              className="pill bg-mid/15 text-mid"
              title={`Confidence ${confidence}/100 — thin data, so the risk band is capped and hedged`}
            >
              Low confidence
            </span>
          )}
        </div>
        {/* center: avatar + name with the three section buttons on the same line */}
        <div className="flex min-w-0 flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <div className="shrink-0 rounded-lg bg-linear-to-br from-brand to-brand2 p-[2px]">
              {player.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={player.avatarUrl} alt={player.personaName} className="h-8 w-8 rounded-md object-cover" />
              ) : (
                <div className="grid h-8 w-8 place-items-center rounded-md bg-panel text-sm font-bold text-faint">
                  {(player.personaName || "?").slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>
            <span className="truncate text-xl font-extrabold leading-tight">
              {player.personaName || player.steamId64}
            </span>
          </div>
          <StatsPeek
            split={panels?.split}
            leetify={panels?.leetify}
            counter={panels?.counter}
            matchstats={panels?.matchstats}
          />
        </div>
        <div className="flex items-center gap-2 lg:justify-end">
          <ShareButton label="Share" />
          <Link
            href={`/compare?a=${player.steamId64}`}
            className="inline-flex shrink-0 items-center rounded-lg border border-line bg-panel2 px-2.5 py-1 text-[13px] font-medium text-ink transition hover:border-brand/60"
          >
            Compare
          </Link>
        </div>
      </div>

      {/* ranks + steam profile (left) · meter (centered) · factors (right) */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,330px)_minmax(0,1fr)_minmax(0,330px)] lg:items-start">
        {/* left: ranks + steam profile + rating/scope */}
        <div className="space-y-2.5">
          <RankRow
            premier={premier}
            premierHistory={premierHistory}
            faceit={faceit}
            faceitLevelFallback={leetify?.ranks?.faceit ?? 0}
            faceitEloFallback={leetify?.ranks?.faceit_elo ?? 0}
          />
          <div className="space-y-1.5">
            <div className="stat-label">Steam profile</div>
            <div className="flex flex-wrap gap-1.5">
              {steamExtras?.personaState != null && steamExtras.personaState > 0 && (
                <span className="pill bg-good/15 text-good">
                  <span className="h-1.5 w-1.5 rounded-full bg-good" />
                  {PERSONA[steamExtras.personaState] || "Online"}
                </span>
              )}
              {steamExtras?.visibility === 1 && <span className="pill bg-mid/15 text-mid">Private</span>}
              {steamExtras?.visibility === 2 && <span className="pill bg-mid/15 text-mid">Friends only</span>}
              {player.countryCode && (
                <span className="pill bg-panel text-muted">
                  {flag(player.countryCode)} {player.countryCode}
                </span>
              )}
              {ageY != null && (
                <span className="pill bg-panel text-muted" title={`Steam account created ${steamCreated?.toLocaleDateString()}`}>
                  {ageY.toFixed(1)}y on Steam
                </span>
              )}
              {steamExtras != null && steamExtras.steamLevel > 0 && (
                <span className="pill bg-panel text-muted">Steam lvl {steamExtras.steamLevel}</span>
              )}
              {steamExtras != null && steamExtras.friends > 0 && (
                <span className="pill bg-panel text-muted">{steamExtras.friends.toLocaleString("en-US")} friends</span>
              )}
              {steamExtras?.friendCode && <span className="pill bg-panel font-mono text-muted">{steamExtras.friendCode}</span>}
              {player.profileUrl && (
                <a href={player.profileUrl} target="_blank" rel="noreferrer" className="pill bg-panel text-muted transition hover:text-ink">
                  Steam ↗
                </a>
              )}
            </div>
            <div className="font-mono text-[11px] text-faint">{player.steamId64}</div>
          </div>
          {/* rating ring beside the analysis scope — one compact row */}
          <div className="flex items-center gap-3 pt-1">
            {rating != null && <RatingRing rating={rating} size={100} />}
            <div className="min-w-0 flex-1 rounded-xl border border-line bg-panel/40 p-2.5">
              <div className="stat-label">Analysis scope</div>
              <div className="mt-1 text-sm leading-snug text-ink">
                {scope.hours != null && (
                  <>
                    <span className="font-semibold tabular-nums">{fmt(Math.round(scope.hours))}h</span>
                    <span className="text-faint"> playtime</span>
                    <br />
                  </>
                )}
                <span className="font-semibold tabular-nums">{fmt(scope.matches)}</span>
                <span className="text-faint"> matches</span>
              </div>
            </div>
          </div>
        </div>

        {/* center: the meter */}
        <div className="flex flex-col items-center text-center">
          <div className="stat-label">Cheating likelihood</div>
          <div className={`text-5xl font-extrabold leading-none tabular-nums ${BAND_TEXT[band]}`}>
            {score.toFixed(0)}%
          </div>
          <div className={`mt-0.5 text-sm font-bold uppercase ${BAND_TEXT[band]}`}>{RISK_LABEL[band]}</div>
          <div className="text-xs text-muted">{subtitle}</div>
          <Gauge score={score} hex={hex} />
          <div className="w-full max-w-[290px]">
            <BandLegend band={band} />
          </div>
        </div>

        {/* factors — single stacked column on the right */}
        <div>
          <div className="stat-label mb-1">Factors analyzed <span className="font-normal normal-case text-faint">· biggest drivers first</span></div>
          <ul className="space-y-1">
            {[...factors]
              .sort((a, b) => b.score - a.score || Number(!!b.primary) - Number(!!a.primary))
              .map((f) => (
              <li
                key={f.key}
                className={`flex items-center gap-2 rounded-lg px-2 py-0.5 ${
                  f.primary ? "border border-brand/30 bg-brand/5" : "bg-panel/40"
                }`}
              >
                <span
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-panel2"
                  style={{ color: BAND_HEX[f.band] }}
                >
                  <Icon name={f.icon} className="h-3 w-3" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium leading-tight">{f.label}</div>
                  <div className="truncate text-[10px] leading-tight text-faint">{f.detail}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[13px] font-bold leading-tight tabular-nums">{f.display}</div>
                  <div
                    className="text-[9px] font-bold uppercase leading-tight"
                    style={{ color: BAND_HEX[f.band] }}
                  >
                    {factorTag(f)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Career stats (left) + map win rates (right) — the real detail that
          replaces the old scale-card row (which just duplicated the factors). */}
      {/* Leetify performance — for friends-only profiles whose aim detail is
          redacted, show the stats we DO have next to the meter. */}
      {perfStats.length > 0 && (
        <div className="mt-3 rounded-xl border border-line bg-panel/30 px-4 py-3">
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="stat-label">Leetify performance</span>
            <span className="text-[10px] text-faint">
              detailed aim stats are hidden on this friends-only profile — here&apos;s what&apos;s available
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {perfStats.map((st) => (
              <div key={st.label} className="rounded-lg border border-line bg-panel px-2.5 py-1.5">
                <div className="stat-label">{st.label}</div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                  {st.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* bottom row: career stats · map win rates · consistency + history/verdict —
          one compact strip so the whole box fits a desktop viewport. */}
      <div
        className={`mt-3 grid gap-3 ${
          showCareerCard && showMapChart
            ? "lg:grid-cols-[minmax(0,1.1fr)_minmax(0,280px)_minmax(0,1.35fr)]"
            : showCareerCard || showMapChart
              ? "lg:grid-cols-2"
              : ""
        }`}
      >
        {showCareerCard && (
          <div className="card flex flex-col px-3.5 py-3">
            <div className="stat-label mb-2">
              Career stats{" "}
              <span className="font-normal normal-case text-faint">
                · {showCareer ? `${fmt(career!.matches)} parsed matches` : "Leetify / FACEIT / Steam"}
              </span>
            </div>
            {showCareer ? (
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                <CStat label="ADR" value={career!.adr.toFixed(0)} color={tierColor(career!.adr, 80, 65)} />
                <CStat label="KAST" value={`${career!.kastPct.toFixed(0)}%`} color={tierColor(career!.kastPct, 72, 65)} />
                <CStat label="Rounds" value={fmt(career!.roundsPlayed)} />
                <CStat label="Opening" value={`${openPct.toFixed(0)}%`} color={tierColor(openPct, 55, 45)} />
                <CStat label="Clutch" value={`${clutchPct.toFixed(0)}%`} color={tierColor(clutchPct, 50, 30)} />
                <CStat label="Assists" value={fmt(career!.assists)} />
                <CStat label="Util/rd" value={udPerRound.toFixed(1)} color={tierColor(udPerRound, 8, 5)} />
                <CStat label="MVPs" value={fmt(career!.mvps)} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {fallbackCells.slice(0, 8).map((c) => (
                  <CStat key={c.label} label={c.label} value={c.value} color={c.color} />
                ))}
              </div>
            )}
            {/* multi-kill rounds — slim inline strip (parsed data only) */}
            {showCareer && (() => {
              const buckets = [
                { label: "1K", n: career!.k1, tone: "bg-line2" },
                { label: "2K", n: career!.k2, tone: "bg-brand/50" },
                { label: "3K", n: career!.k3, tone: "bg-brand" },
                { label: "4K", n: career!.k4, tone: "bg-brand2" },
                { label: "5K", n: career!.k5, tone: "bg-mid" },
              ];
              const mkTotal = buckets.reduce((s, b) => s + b.n, 0);
              if (mkTotal === 0) return null;
              return (
                <div className="mt-auto pt-2.5">
                  <div className="stat-label mb-1.5">Multi-kill rounds</div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-panel">
                    {buckets.map((b) =>
                      b.n > 0 ? (
                        <span
                          key={b.label}
                          className={b.tone}
                          style={{ width: `${(b.n / mkTotal) * 100}%` }}
                          title={`${b.label}: ${fmt(b.n)} rounds`}
                        />
                      ) : null,
                    )}
                  </div>
                  <div className="mt-1.5 grid grid-cols-5 gap-1 text-center">
                    {buckets.map((b) => (
                      <div key={b.label}>
                        <div className="flex items-center justify-center gap-1 text-[10px] text-muted">
                          <span className={`h-1.5 w-1.5 rounded-full ${b.tone}`} />
                          {b.label}
                        </div>
                        <div className="text-xs font-semibold tabular-nums">{fmt(b.n)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {showMapChart && <MapWinChart matches={recentMatches} embedded />}

        <div className="flex min-w-0 flex-col gap-2.5">
          {summary.total > 0 && (
            <RatingConsistencyChart
              ratings={trend.rating}
              outcomes={trend.outcomes}
              total={summary.total}
            />
          )}
          <div className={`grid flex-1 gap-3 ${summary.total > 0 ? "sm:grid-cols-[auto_1fr]" : ""}`}>
            {summary.total > 0 && (
              <div className="card flex items-center gap-2.5 px-3 py-2.5">
                <Donut
                  wins={summary.wins}
                  losses={summary.losses}
                  draws={summary.draws}
                  total={summary.total}
                  sizeClass="h-[74px] w-[74px]"
                />
                <div className="min-w-0 space-y-0.5 text-xs">
                  <div className="stat-label">Last {summary.total}</div>
                  <div className="flex items-center gap-1.5 whitespace-nowrap text-good">
                    <span className="h-1.5 w-1.5 rounded-full bg-good" />
                    {summary.wins}W
                    <span className="text-faint">({pct(summary.wins).toFixed(0)}%)</span>
                  </div>
                  <div className="flex items-center gap-1.5 whitespace-nowrap text-bad">
                    <span className="h-1.5 w-1.5 rounded-full bg-bad" />
                    {summary.losses}L
                    <span className="text-faint">({pct(summary.losses).toFixed(0)}%)</span>
                  </div>
                  {summary.draws > 0 && (
                    <div className="flex items-center gap-1.5 whitespace-nowrap text-mid">
                      <span className="h-1.5 w-1.5 rounded-full bg-mid" />
                      {summary.draws}D
                      <span className="text-faint">({pct(summary.draws).toFixed(0)}%)</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="card min-w-0 px-3.5 py-2.5">
              <div className="stat-label mb-1">Overall verdict</div>
              <div className="flex items-start gap-2">
                <span style={{ color: hex }} className="mt-0.5 text-lg leading-none">
                  ⚠
                </span>
                <div className="min-w-0">
                  <div className="text-[15px] font-extrabold leading-tight" style={{ color: hex }}>
                    {VERDICT_TITLE[band]}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted">{verdict}</p>
                </div>
              </div>
              <div className="mt-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="stat-label">Confidence</span>
                  <span className="font-bold tabular-nums">{confidence.toFixed(0)}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel">
                  <div
                    className="h-full rounded-full bg-linear-to-r from-brand to-brand2"
                    style={{ width: `${confidence}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-1 border-t border-line pt-2 text-[10px] leading-snug text-faint sm:flex-row sm:items-center sm:justify-between">
        <span>
          Statistical anomaly from public stats —{" "}
          <span className="text-muted">not a ban and not definitive proof</span>. Playstyle,
          role and sample size all matter; elite legit players score high too.
        </span>
        {generatedOn && (
          <span className="shrink-0">Generated {generatedOn}</span>
        )}
      </div>
    </section>
  );
}
