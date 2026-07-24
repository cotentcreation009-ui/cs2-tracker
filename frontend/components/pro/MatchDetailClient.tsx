"use client";

import Link from "next/link";
import type { MatchState, ProMap, ProMapPlayer, ProTeam } from "./types";
import { usePoll, useNow } from "./usePoll";
import { TeamLogo } from "./TeamLogo";
import { LiveBadge } from "./LiveBadge";
import { RoundStrip } from "./RoundStrip";
import { TwitchLink } from "./TwitchLink";
import { ProHistoryPanel } from "./ProHistory";
import { agoShort, clockLabel, formatTag, mapsWon, sideHex, validHex } from "./format";

const POLL_MS = 10_000;

// Plain-language explanation of the series format.
function formatBlurb(m: MatchState): string {
  const bo = m.bestOf ?? 0;
  if (bo === 1) return "Best of 1 — a single map decides the match";
  if (bo > 1) return `Best of ${bo} — first to ${Math.ceil(bo / 2)} maps wins`;
  return m.formatName ?? "";
}

export function MatchDetailClient({
  id,
  initialData,
}: {
  id: string;
  initialData: MatchState | null;
}) {
  const { data, error, loading } = usePoll<MatchState>(`/api/pro-matches/${id}`, POLL_MS, { initialData });
  const now = useNow(1000);

  if (loading && !data) return <DetailSkeleton />;

  if (!data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="card-2 flex flex-col items-center gap-2 px-6 py-16 text-center">
          <p className="text-base font-semibold text-ink">Match not found</p>
          <p className="max-w-md text-sm text-muted">
            {error === "status 404"
              ? "This series isn't on the live feed anymore — it may have finished, or the ID is unknown."
              : "We couldn't load this match right now. It'll retry automatically."}
          </p>
          <Link href="/pro-matches" className="btn btn-ghost mt-2">Back to all matches</Link>
        </div>
      </div>
    );
  }

  const m = data;
  const a = m.teams?.[0];
  const b = m.teams?.[1];
  const aWon = mapsWon(m, a?.gridId);
  const bWon = mapsWon(m, b?.gridId);
  const isLive = m.status === "live";
  const isFinished = m.status === "finished";
  const isUpcoming = m.status === "upcoming";
  const aColor = validHex(a?.colorPrimary) ?? "#38d6ff";
  const bColor = validHex(b?.colorPrimary) ?? "#8a7dff";
  const aWinner = isFinished && m.seriesWinner && m.seriesWinner === a?.gridId;
  const bWinner = isFinished && m.seriesWinner && m.seriesWinner === b?.gridId;
  const fresh = agoShort(m.liveUpdatedAt ?? m.fetchedAt, now);
  const maps = [...(m.maps ?? [])].sort((x, y) => x.sequence - y.sequence);
  const startAbs = m.startScheduled
    ? new Date(m.startScheduled).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <BackLink />
        {isLive && fresh ? (
          <span className="flex items-center gap-1.5 text-[11px] text-faint">
            <span className="h-1.5 w-1.5 rounded-full bg-good" aria-hidden />
            Updated {fresh}
          </span>
        ) : null}
      </div>

      {/* header card */}
      <div className="card-2 relative overflow-hidden p-5 sm:p-7">
        <span aria-hidden className="pointer-events-none absolute -left-24 -top-28 h-64 w-64 rounded-full opacity-[0.16] blur-3xl" style={{ background: aColor }} />
        <span aria-hidden className="pointer-events-none absolute -right-24 -top-28 h-64 w-64 rounded-full opacity-[0.16] blur-3xl" style={{ background: bColor }} />
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ backgroundImage: `linear-gradient(90deg, ${aColor}, transparent 45%, transparent 55%, ${bColor})` }} />

        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {m.tournamentLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.tournamentLogoUrl} alt="" loading="lazy" className="h-5 w-5 shrink-0 rounded object-contain" />
            ) : null}
            <span className="truncate text-sm font-medium text-muted">{m.tournamentName ?? "Pro match"}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {formatTag(m) ? <span className="pill border-line text-[10px] text-muted">{formatTag(m)}</span> : null}
            {isLive ? <LiveBadge /> : isFinished ? (
              <span className="pill border-line bg-panel text-[10px] uppercase tracking-wider text-muted">Final</span>
            ) : (
              <>
                {countdown(m.startScheduled, now) ? (
                  <span className="pill border-brand/40 bg-brand/10 text-[11px] font-semibold tabular-nums text-brand" title={startAbs ? `Starts ${startAbs}` : undefined}>
                    {countdown(m.startScheduled, now)}
                  </span>
                ) : null}
                <span className="pill border-line bg-panel text-[10px] uppercase tracking-wider text-brand">Upcoming</span>
              </>
            )}
          </div>
        </div>

        {/* teams + series score */}
        <div className="relative mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <TeamSide gridId={a?.gridId} name={a?.shortName || a?.name} logo={a?.logoUrl} color={a?.colorPrimary} winner={!!aWinner} align="left" />
          <div className="flex flex-col items-center px-1">
            <div className="flex items-baseline gap-2 text-4xl font-extrabold tabular-nums sm:text-5xl">
              <span className={aWon >= bWon ? "text-ink" : "text-faint"}>{aWon}</span>
              <span className="text-2xl text-faint">:</span>
              <span className={bWon >= aWon ? "text-ink" : "text-faint"}>{bWon}</span>
            </div>
            <span className="mt-1 text-[10px] uppercase tracking-wider text-faint">maps</span>
          </div>
          <TeamSide gridId={b?.gridId} name={b?.shortName || b?.name} logo={b?.logoUrl} color={b?.colorPrimary} winner={!!bWinner} align="right" />
        </div>

        {/* format + schedule + stream / demo-analysis */}
        <div className="relative mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-4">
          <span className="text-xs text-muted">
            {formatBlurb(m)}
            {isUpcoming && startAbs ? ` · starts ${startAbs}` : ""}
            {isFinished && startAbs ? ` · played ${startAbs}` : ""}
          </span>
          <span className="flex items-center gap-2">
            {isFinished ? (
              <Link
                href="/demos"
                title="Grab this match's .dem from HLTV.org (or the event page) and drop it into StatRun's demo analyzer for round-by-round breakdowns, utility maps and duel stats"
                className="btn btn-ghost h-8 gap-1.5 px-3 text-xs"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                  <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" />
                </svg>
                Analyze demo
              </Link>
            ) : null}
            {m.streamUrl ? <TwitchLink url={m.streamUrl} /> : null}
          </span>
        </div>
      </div>

      {/* per-map breakdown with scoreboards */}
      {maps.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-ink">Maps &amp; player stats</h2>
          <div className="space-y-3">
            {maps.map((mp) => (
              <MapRow key={mp.sequence} map={mp} match={m} a={a} b={b} />
            ))}
          </div>
        </section>
      ) : isUpcoming ? (
        <div className="card px-5 py-8 text-center text-sm text-muted">
          Player stats and map scores appear here once the match goes live.
        </div>
      ) : isFinished ? (
        <div className="card px-5 py-8 text-center text-sm text-muted">
          Detailed per-map data isn&apos;t available for this series.
        </div>
      ) : null}

      {/* recent form + head-to-head, loaded lazily below the live data */}
      {a && b ? <ProHistoryPanel id={m.seriesId} teams={[a, b]} /> : null}
    </div>
  );
}

// Live countdown to an upcoming match's scheduled start.
function countdown(iso: string | undefined, now: number): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  let s = Math.floor((t - now) / 1000);
  if (s <= 0) return "starting soon";
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  if (d > 0) return `in ${d}d ${h}h ${m}m`;
  if (h > 0) return `in ${h}h ${m}m ${sec}s`;
  return `in ${m}m ${sec}s`;
}

function TeamSide({
  gridId,
  name,
  logo,
  color,
  winner,
  align,
}: {
  gridId?: string;
  name?: string;
  logo?: string;
  color?: string;
  winner: boolean;
  align: "left" | "right";
}) {
  const inner = (
    <>
      <TeamLogo name={name} src={logo} color={color} size={68} />
      <div className="min-w-0">
        <div className="truncate text-base font-bold text-ink sm:text-lg">{name || "TBD"}</div>
        {winner ? <div className="text-[11px] font-semibold uppercase tracking-wider text-good">Winner</div> : null}
      </div>
    </>
  );
  const cls = `flex min-w-0 items-center gap-3 ${align === "right" ? "flex-row-reverse text-right" : ""}`;
  // team names click through to the team page (roster + stats + results)
  return gridId ? (
    <Link href={`/pro-matches/team/${gridId}`} title={`${name || "Team"} — roster, stats & results`} className={`${cls} group/team rounded-lg transition hover:bg-panel/40`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function MapRow({
  map,
  match,
  a,
  b,
}: {
  map: ProMap;
  match: MatchState;
  a?: ProTeam;
  b?: ProTeam;
}) {
  const aId = a?.gridId;
  const bId = b?.gridId;
  const aScore = aId ? (map.scoreByTeam?.[aId] ?? 0) : 0;
  const bScore = bId ? (map.scoreByTeam?.[bId] ?? 0) : 0;
  const aSide = aId ? map.sideByTeam?.[aId] : undefined;
  const bSide = bId ? map.sideByTeam?.[bId] : undefined;
  const isLive = map.started && !map.finished;
  const isDone = !!map.finished;
  const aMapWon = isDone && map.winnerTeam && map.winnerTeam === aId;
  const bMapWon = isDone && map.winnerTeam && map.winnerTeam === bId;
  const clock = clockLabel(map.clockSeconds);

  const teamA = map.teams?.find((t) => t.gridId === aId);
  const teamB = map.teams?.find((t) => t.gridId === bId);
  // Lower-tier events sometimes carry player LISTS but no stat ingestion —
  // an all-zero scoreboard reads as broken, so require some real data.
  const anyData = [teamA, teamB].some((t) =>
    (t?.players ?? []).some((p) => p.kills > 0 || p.deaths > 0 || p.assists > 0 || (p.netWorth ?? 0) > 0),
  );
  const hasBoards = anyData && ((teamA?.players?.length ?? 0) > 0 || (teamB?.players?.length ?? 0) > 0);
  const emptyBoards = !anyData && ((teamA?.players?.length ?? 0) > 0 || (teamB?.players?.length ?? 0) > 0);

  return (
    <div className={`card overflow-hidden p-4 ${isLive ? "border-[#ff4655]/30" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-line bg-panel text-[11px] font-bold tabular-nums text-muted">
            {map.sequence}
          </span>
          <span className="truncate text-sm font-semibold text-ink">{map.mapName || (map.started ? "Live map" : "TBD")}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isLive ? (
            <>
              {map.currentRound ? <span className="text-[11px] tabular-nums text-faint">Round {map.currentRound}{clock ? ` · ${clock}` : ""}</span> : null}
              <LiveBadge />
            </>
          ) : isDone ? (
            <span className="text-[11px] uppercase tracking-wider text-faint">Final</span>
          ) : (
            <span className="text-[11px] uppercase tracking-wider text-faint">Not started</span>
          )}
        </div>
      </div>

      {(map.started || isDone) && (
        <div className="mt-3 flex items-center gap-3">
          <div className="flex items-baseline gap-2 text-2xl font-bold tabular-nums">
            <span className={aMapWon ? "text-good" : ""} style={!aMapWon ? { color: sideHex(aSide) ?? undefined } : undefined}>{aScore}</span>
            <span className="text-sm text-faint">–</span>
            <span className={bMapWon ? "text-good" : ""} style={!bMapWon ? { color: sideHex(bSide) ?? undefined } : undefined}>{bScore}</span>
          </div>
          {(aSide || bSide) && !isDone ? (
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
              <SideChip side={aSide} />
              <SideChip side={bSide} />
            </div>
          ) : null}
        </div>
      )}

      {map.rounds && map.rounds.length ? (
        <div className="mt-3">
          <RoundStrip rounds={map.rounds} teams={match.teams} size="md" />
        </div>
      ) : null}

      {/* per-team player scoreboards */}
      {hasBoards ? (
        <div className="mt-4 grid gap-3 border-t border-line/60 pt-4 lg:grid-cols-2">
          <TeamScoreboard team={a} side={aSide} score={aScore} players={teamA?.players} won={!!aMapWon} />
          <TeamScoreboard team={b} side={bSide} score={bScore} players={teamB?.players} won={!!bMapWon} />
        </div>
      ) : emptyBoards && isDone ? (
        <p className="mt-3 border-t border-line/60 pt-3 text-xs text-faint">
          GRID didn&apos;t track per-player stats for this map (common at qualifier level) — only the map score is available.
        </p>
      ) : null}
    </div>
  );
}

// One team's HLTV-style scoreboard on a map: header (team, side, score) + a
// row per player with K / A / D / +− and net worth. Sorted by kills.
function TeamScoreboard({
  team,
  side,
  score,
  players,
  won,
}: {
  team?: ProTeam;
  side?: string;
  score: number;
  players?: ProMapPlayer[];
  won: boolean;
}) {
  const hex = validHex(team?.colorPrimary) ?? "#8a93a5";
  const rows = [...(players ?? [])].sort((x, y) => y.kills - x.kills);
  const s = (side || "").toUpperCase();
  const sHex = sideHex(s);

  return (
    <div className="overflow-hidden rounded-lg border border-line/70">
      <div className="flex items-center justify-between gap-2 border-b border-line/70 bg-panel/50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <TeamLogo name={team?.shortName || team?.name} src={team?.logoUrl} color={team?.colorPrimary} size={26} />
          {team?.gridId ? (
            <Link href={`/pro-matches/team/${team.gridId}`} title="Team page — roster, stats & results" className="truncate text-xs font-bold hover:underline" style={{ color: won ? "var(--color-good)" : hex }}>
              {team.shortName || team.name || "TBD"}
            </Link>
          ) : (
            <span className="truncate text-xs font-bold text-ink" style={{ color: won ? "var(--color-good)" : hex }}>
              {team?.shortName || team?.name || "TBD"}
            </span>
          )}
          {sHex ? (
            <span className="rounded border px-1 text-[9px] font-bold" style={{ color: sHex, borderColor: `${sHex}55` }}>{s}</span>
          ) : null}
        </div>
        <span className="shrink-0 text-sm font-bold tabular-nums" style={{ color: won ? "var(--color-good)" : undefined }}>{score}</span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[9px] uppercase tracking-wider text-faint">
            <th className="px-3 py-1 text-left font-semibold">Player</th>
            <th className="w-8 py-1 text-right font-semibold" title="Kills">K</th>
            <th className="w-8 py-1 text-right font-semibold" title="Assists">A</th>
            <th className="w-8 py-1 text-right font-semibold" title="Deaths">D</th>
            <th className="w-9 py-1 text-right font-semibold" title="Kill − death difference">+/−</th>
            <th className="w-12 px-3 py-1 text-right font-semibold" title="Net worth ($)">Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => {
            const diff = p.kills - p.deaths;
            return (
              <tr key={`${p.name}-${i}`} className="border-t border-line/40">
                <td className="max-w-0 truncate px-3 py-1.5 font-medium text-ink">{p.name}</td>
                <td className="py-1.5 text-right tabular-nums text-ink">{p.kills}</td>
                <td className="py-1.5 text-right tabular-nums text-muted">{p.assists}</td>
                <td className="py-1.5 text-right tabular-nums text-muted">{p.deaths}</td>
                <td className={`py-1.5 text-right tabular-nums ${diff > 0 ? "text-good" : diff < 0 ? "text-bad" : "text-faint"}`}>
                  {diff > 0 ? `+${diff}` : diff}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-faint">{p.netWorth ? `$${p.netWorth.toLocaleString()}` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SideChip({ side }: { side?: string }) {
  const s = (side || "").toUpperCase();
  if (s !== "CT" && s !== "T") return null;
  const hex = sideHex(s);
  return (
    <span style={{ color: hex ?? undefined, borderColor: `${hex}55` }} className="rounded border px-1 py-0.5">{s}</span>
  );
}

function BackLink() {
  return (
    <Link href="/pro-matches" className="link-muted inline-flex items-center gap-1.5 text-sm font-medium">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
        <path d="M15 18l-6-6 6-6" />
      </svg>
      All matches
    </Link>
  );
}

function DetailSkeleton() {
  const bar = "animate-pulse rounded bg-line/50";
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading match">
      <span className={`block h-4 w-28 ${bar}`} />
      <div className="card-2 space-y-6 p-7">
        <div className="flex items-center justify-between">
          <span className={`h-4 w-40 ${bar}`} />
          <span className={`h-5 w-14 ${bar}`} />
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-3">
            <span className={`h-14 w-14 ${bar}`} />
            <span className={`h-5 w-24 ${bar}`} />
          </span>
          <span className={`h-10 w-20 ${bar}`} />
          <span className="flex items-center gap-3">
            <span className={`h-5 w-24 ${bar}`} />
            <span className={`h-14 w-14 ${bar}`} />
          </span>
        </div>
      </div>
      {Array.from({ length: 2 }).map((_, i) => (
        <span key={i} className={`block h-24 w-full ${bar}`} />
      ))}
    </div>
  );
}
