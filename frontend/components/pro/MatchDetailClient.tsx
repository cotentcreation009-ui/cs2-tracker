"use client";

import Link from "next/link";
import type { MatchState, ProMap } from "./types";
import { usePoll, useNow } from "./usePoll";
import { TeamLogo } from "./TeamLogo";
import { LiveBadge } from "./LiveBadge";
import { RoundStrip } from "./RoundStrip";
import { TwitchLink } from "./TwitchLink";
import {
  agoShort,
  clockLabel,
  formatTag,
  mapsWon,
  sideHex,
  validHex,
} from "./format";

const POLL_MS = 10_000;

export function MatchDetailClient({
  id,
  initialData,
}: {
  id: string;
  initialData: MatchState | null;
}) {
  const { data, error, loading } = usePoll<MatchState>(
    `/api/pro-matches/${id}`,
    POLL_MS,
    { initialData },
  );
  const now = useNow(1000);

  if (loading && !data) return <DetailSkeleton />;

  // 404 / unavailable — the proxy returned non-2xx and we have nothing to show.
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
          <Link href="/pro-matches" className="btn btn-ghost mt-2">
            Back to all matches
          </Link>
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
  const aColor = validHex(a?.colorPrimary) ?? "#38d6ff";
  const bColor = validHex(b?.colorPrimary) ?? "#8a7dff";
  const aWinner = isFinished && m.seriesWinner && m.seriesWinner === a?.gridId;
  const bWinner = isFinished && m.seriesWinner && m.seriesWinner === b?.gridId;
  const fresh = agoShort(m.liveUpdatedAt ?? m.fetchedAt, now);
  const maps = [...(m.maps ?? [])].sort((x, y) => x.sequence - y.sequence);

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
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-0.5 opacity-80"
          style={{ backgroundImage: `linear-gradient(90deg, ${aColor}, ${bColor})` }}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {m.tournamentLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={m.tournamentLogoUrl}
                alt=""
                width={22}
                height={22}
                loading="lazy"
                className="h-5.5 w-5.5 shrink-0 rounded object-contain"
              />
            ) : null}
            <span className="truncate text-sm font-medium text-muted">
              {m.tournamentName ?? "Pro match"}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {formatTag(m) ? (
              <span className="pill border-line text-[10px] text-muted">
                {formatTag(m)}
              </span>
            ) : null}
            {isLive ? (
              <LiveBadge />
            ) : isFinished ? (
              <span className="pill border-line bg-panel text-[10px] uppercase tracking-wider text-muted">
                Final
              </span>
            ) : (
              <span className="pill border-line bg-panel text-[10px] uppercase tracking-wider text-brand">
                Upcoming
              </span>
            )}
          </div>
        </div>

        {/* teams + series score */}
        <div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <TeamSide
            name={a?.shortName || a?.name}
            fullName={a?.name}
            logo={a?.logoUrl}
            color={a?.colorPrimary}
            winner={!!aWinner}
            align="left"
          />
          <div className="flex items-center gap-2 px-1 text-4xl font-extrabold tabular-nums sm:text-5xl">
            <span className={aWon >= bWon ? "text-ink" : "text-faint"}>{aWon}</span>
            <span className="text-2xl text-faint">:</span>
            <span className={bWon >= aWon ? "text-ink" : "text-faint"}>{bWon}</span>
          </div>
          <TeamSide
            name={b?.shortName || b?.name}
            fullName={b?.name}
            logo={b?.logoUrl}
            color={b?.colorPrimary}
            winner={!!bWinner}
            align="right"
          />
        </div>

        {(m.streamUrl || m.formatName) && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-4">
            <span className="text-xs text-faint">
              {m.formatName ?? formatTag(m)}
              {m.status === "upcoming" && m.startScheduled
                ? ` · ${new Date(m.startScheduled).toLocaleString([], {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : ""}
            </span>
            {m.streamUrl ? <TwitchLink url={m.streamUrl} /> : null}
          </div>
        )}
      </div>

      {/* per-map breakdown */}
      {maps.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-ink">
            Maps
          </h2>
          <div className="space-y-3">
            {maps.map((mp) => (
              <MapRow
                key={mp.sequence}
                map={mp}
                match={m}
                aId={a?.gridId}
                bId={b?.gridId}
              />
            ))}
          </div>
        </section>
      ) : m.status === "upcoming" ? (
        <div className="card px-5 py-8 text-center text-sm text-muted">
          Maps and scores appear here once the match goes live.
        </div>
      ) : null}
    </div>
  );
}

function TeamSide({
  name,
  fullName,
  logo,
  color,
  winner,
  align,
}: {
  name?: string;
  fullName?: string;
  logo?: string;
  color?: string;
  winner: boolean;
  align: "left" | "right";
}) {
  return (
    <div
      className={`flex min-w-0 items-center gap-3 ${
        align === "right" ? "flex-row-reverse text-right" : ""
      }`}
    >
      <TeamLogo name={fullName} src={logo} color={color} size={56} />
      <div className="min-w-0">
        <div className="truncate text-base font-bold text-ink sm:text-lg">
          {name || "TBD"}
        </div>
        {winner ? (
          <div className="text-[11px] font-semibold uppercase tracking-wider text-good">
            Winner
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MapRow({
  map,
  match,
  aId,
  bId,
}: {
  map: ProMap;
  match: MatchState;
  aId?: string;
  bId?: string;
}) {
  const aScore = aId ? (map.scoreByTeam?.[aId] ?? 0) : 0;
  const bScore = bId ? (map.scoreByTeam?.[bId] ?? 0) : 0;
  const aSide = aId ? map.sideByTeam?.[aId] : undefined;
  const bSide = bId ? map.sideByTeam?.[bId] : undefined;
  const isLive = map.started && !map.finished;
  const isDone = map.finished;
  const aWon = isDone && map.winnerTeam && map.winnerTeam === aId;
  const bWon = isDone && map.winnerTeam && map.winnerTeam === bId;
  const clock = clockLabel(map.clockSeconds);

  return (
    <div
      className={`card overflow-hidden p-4 ${
        isLive ? "border-[#ff4655]/30" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-line bg-panel text-[11px] font-bold tabular-nums text-muted">
            {map.sequence}
          </span>
          <span className="truncate text-sm font-semibold text-ink">
            {map.mapName || (map.started ? "Live map" : "TBD")}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isLive ? (
            <>
              {map.currentRound ? (
                <span className="text-[11px] tabular-nums text-faint">
                  Round {map.currentRound}
                  {clock ? ` · ${clock}` : ""}
                </span>
              ) : null}
              <LiveBadge />
            </>
          ) : isDone ? (
            <span className="text-[11px] uppercase tracking-wider text-faint">
              Final
            </span>
          ) : (
            <span className="text-[11px] uppercase tracking-wider text-faint">
              Not started
            </span>
          )}
        </div>
      </div>

      {(map.started || isDone) && (
        <div className="mt-3 flex items-center gap-3">
          <div className="flex items-baseline gap-2 text-2xl font-bold tabular-nums">
            <span
              className={aWon ? "text-good" : ""}
              style={!aWon ? { color: sideHex(aSide) ?? undefined } : undefined}
            >
              {aScore}
            </span>
            <span className="text-sm text-faint">–</span>
            <span
              className={bWon ? "text-good" : ""}
              style={!bWon ? { color: sideHex(bSide) ?? undefined } : undefined}
            >
              {bScore}
            </span>
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
    </div>
  );
}

function SideChip({ side }: { side?: string }) {
  const s = (side || "").toUpperCase();
  if (s !== "CT" && s !== "T") return null;
  const hex = sideHex(s);
  return (
    <span
      style={{ color: hex ?? undefined, borderColor: `${hex}55` }}
      className="rounded border px-1 py-0.5"
    >
      {s}
    </span>
  );
}

function BackLink() {
  return (
    <Link
      href="/pro-matches"
      className="link-muted inline-flex items-center gap-1.5 text-sm font-medium"
    >
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
