"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ProTeamPage, ProTeamPlayer, ProTeamResult } from "./types";
import { TeamLogo } from "./TeamLogo";
import { PlayerAvatar } from "./PlayerAvatar";
import { validHex } from "./format";

// HLTV-style team page: identity header with a record/form stat strip, the
// roster with official per-player stats, and the results list (each result
// links to the full match breakdown).
export function ProTeamClient({ id }: { id: string }) {
  const [data, setData] = useState<ProTeamPage | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/pro-matches/team/${id}`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const d = (await res.json()) as ProTeamPage;
        if (alive) {
          setData(d);
          setState("ready");
        }
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  if (state === "loading") {
    return (
      <div className="space-y-4" aria-busy="true">
        <BackLink />
        <div className="card-2 h-36 animate-pulse bg-line/20" />
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="card h-64 animate-pulse bg-line/20" />
          <div className="card h-64 animate-pulse bg-line/20" />
        </div>
      </div>
    );
  }
  if (state === "error" || !data || data.enabled === false || !data.team) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="card-2 flex flex-col items-center gap-2 px-6 py-16 text-center">
          <p className="text-base font-semibold text-ink">Team not found</p>
          <p className="max-w-md text-sm text-muted">
            We couldn&apos;t load this team right now — it may not be on the live feed.
          </p>
          <Link href="/pro-matches" className="btn btn-ghost mt-2">Back to matches</Link>
        </div>
      </div>
    );
  }

  const t = data.team;
  const hex = validHex(t.colorPrimary) ?? "#38d6ff";
  const rec = data.record;
  const players = data.players ?? [];
  const results = data.results ?? [];
  const total = rec ? rec.wins + rec.losses : 0;
  const winPct = rec && total > 0 ? Math.round((rec.wins / total) * 100) : null;
  const withStats = players.filter((p) => p.src !== "");
  const noStats = players.filter((p) => p.src === "");

  return (
    <div className="space-y-5">
      <BackLink />

      {/* identity header + stat strip */}
      <div className="card-2 relative overflow-hidden p-6">
        <span aria-hidden className="pointer-events-none absolute -left-24 -top-28 h-72 w-72 rounded-full opacity-[0.18] blur-3xl" style={{ background: hex }} />
        <span aria-hidden className="pointer-events-none absolute -right-20 -bottom-32 h-64 w-64 rounded-full opacity-[0.08] blur-3xl" style={{ background: hex }} />
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ backgroundImage: `linear-gradient(90deg, ${hex}, transparent 70%)` }} />
        <div className="relative flex flex-wrap items-center gap-4">
          <TeamLogo name={t.shortName || t.name} src={t.logoUrl} color={t.colorPrimary} size={72} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">{t.name || t.shortName || "Team"}</h1>
            <p className="mt-0.5 text-xs uppercase tracking-wider text-faint">
              Counter-Strike 2 · pro team
              {total > 0 ? <span className="ml-2 normal-case tracking-normal">last {total} series tracked</span> : null}
            </p>
          </div>
        </div>

        {total > 0 && rec ? (
          <div className="relative mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile label="Record">
              <span className="text-good">{rec.wins}</span>
              <span className="mx-0.5 text-faint">–</span>
              <span className="text-bad">{rec.losses}</span>
            </StatTile>
            <StatTile label="Win rate" sub={<WinBar pct={winPct ?? 0} hex={hex} />}>
              <span className={winPct != null && winPct >= 55 ? "text-good" : winPct != null && winPct < 45 ? "text-bad" : "text-ink"}>
                {winPct}%
              </span>
            </StatTile>
            <StatTile label="Streak">
              {rec.streak > 0 ? (
                <span className={rec.streakWon ? "text-good" : "text-bad"}>
                  {rec.streak}{rec.streakWon ? "W" : "L"}
                </span>
              ) : (
                <span className="text-faint">—</span>
              )}
            </StatTile>
            <StatTile label="Last 5" sub={undefined}>
              <span className="inline-flex items-center gap-1">
                {results.slice(0, 5).map((r) => (
                  <span
                    key={r.seriesId}
                    title={`${r.won ? "Won" : "Lost"} ${r.score[0]}–${r.score[1]} vs ${r.opponent?.shortName || r.opponent?.name || "?"}`}
                    className={`grid h-4.5 w-4.5 place-items-center rounded text-[8px] font-bold leading-none ${r.won ? "bg-good/20 text-good" : "bg-bad/20 text-bad"}`}
                  >
                    {r.won ? "W" : "L"}
                  </span>
                ))}
              </span>
            </StatTile>
          </div>
        ) : (
          <p className="relative mt-4 text-sm text-faint">No recent tracked series.</p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* roster + stats */}
        <section className="card-2 overflow-hidden p-0 self-start">
          <div className="flex items-center justify-between border-b border-line/70 px-4 py-2.5">
            <span className="text-sm font-bold uppercase tracking-wider text-ink">Roster &amp; stats</span>
            <span className="text-[10px] text-faint">official GRID statistics · last year</span>
          </div>
          {players.length === 0 ? (
            <p className="px-4 py-6 text-sm text-faint">No roster on record for this team.</p>
          ) : (
            <>
              {withStats.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[9px] uppercase tracking-wider text-faint">
                      <th className="px-4 py-2 text-left font-semibold">Player</th>
                      <th className="w-12 py-2 pl-2 text-right font-semibold" title="Maps played in the last year">Maps</th>
                      <th className="w-13 py-2 pl-2 text-right font-semibold" title="Kills / deaths">K/D</th>
                      <th className="w-14 py-2 pl-2 text-right font-semibold" title="Total kills − deaths over the window">+/−</th>
                      <th className="w-13 py-2 pl-2 text-right font-semibold" title="Average kills per map">Avg K</th>
                      <th className="w-13 py-2 pl-2 text-right font-semibold" title="% of maps where they got the first kill">FK%</th>
                      <th className="w-14 py-2 pl-2 pr-4 text-right font-semibold" title="Map win rate">Win%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {withStats.map((p, i) => (
                      <RosterRow key={p.nick} p={p} rank={i + 1} hex={hex} />
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="px-4 py-6 text-sm text-faint">No tracked stats yet for this roster.</p>
              )}
              {noStats.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5 border-t border-line/40 px-4 py-2.5">
                  <span className="text-[10px] uppercase tracking-wider text-faint">Also on the roster</span>
                  {noStats.map((p) => (
                    <span key={p.nick} className="rounded bg-panel px-1.5 py-0.5 text-xs font-medium text-muted" title="No tracked matches in GRID's data yet (new signing or inactive)">
                      {p.nick}
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </section>

        {/* results */}
        <section className="card-2 overflow-hidden p-0 self-start">
          <div className="flex items-center justify-between border-b border-line/70 px-4 py-2.5">
            <span className="text-sm font-bold uppercase tracking-wider text-ink">Recent results</span>
            {rec ? <span className="text-[10px] tabular-nums text-faint">{rec.wins}–{rec.losses}</span> : null}
          </div>
          {results.length === 0 ? (
            <p className="px-4 py-6 text-sm text-faint">No finished series in the recent window.</p>
          ) : (
            <div className="divide-y divide-line/40">
              {results.map((r) => (
                <ResultRow key={r.seriesId} r={r} />
              ))}
            </div>
          )}
        </section>
      </div>

      <p className="text-[11px] leading-snug text-faint">
        Player stats are GRID&apos;s official aggregates over the last year of tracked pro play
        (players without official data fall back to recent-series aggregates). Click a result to
        open the full match breakdown with per-map scoreboards. Player photos from{" "}
        <a href="https://liquipedia.net/counterstrike/" target="_blank" rel="noopener noreferrer" className="underline hover:text-muted">Liquipedia</a>{" "}
        (CC&nbsp;BY-SA&nbsp;3.0).
      </p>
    </div>
  );
}

function RosterRow({ p, rank, hex }: { p: ProTeamPlayer; rank: number; hex: string }) {
  const grid = p.src === "grid";
  const n = grid ? p.maps : p.series;
  const diff = p.kills - p.deaths;
  const kdColor = (v: number) => (v >= 1.1 ? "text-good" : v < 0.95 ? "text-bad" : "text-ink");
  return (
    <tr className="border-t border-line/40 transition-colors hover:bg-panel/40">
      <td className="max-w-0 px-4 py-2">
        <span className="flex items-center gap-2.5">
          <span className="w-3 shrink-0 text-right text-[10px] tabular-nums text-faint">{rank}</span>
          <PlayerAvatar nick={p.nick} hex={hex} size={28} />
          <span className="truncate font-semibold text-ink">{p.nick}</span>
          {!p.inRoster ? (
            <span className="shrink-0 rounded bg-panel px-1 text-[8px] uppercase tracking-wider text-faint" title="Played recently but not on the current published roster">recent</span>
          ) : null}
        </span>
      </td>
      <td className="py-2 pl-2 text-right tabular-nums text-muted">{n}</td>
      <td className={`py-2 pl-2 text-right font-semibold tabular-nums ${kdColor(p.kd)}`}>{p.kd.toFixed(2)}</td>
      <td className={`whitespace-nowrap py-2 pl-2 text-right tabular-nums ${diff > 0 ? "text-good" : diff < 0 ? "text-bad" : "text-faint"}`} title={`${p.kills} kills − ${p.deaths} deaths`}>
        {diff > 0 ? `+${diff}` : diff}
      </td>
      <td className="py-2 pl-2 text-right tabular-nums text-muted">{grid && p.avgKills > 0 ? p.avgKills.toFixed(1) : "—"}</td>
      <td className="py-2 pl-2 text-right tabular-nums text-muted">{grid ? `${p.fkPct.toFixed(0)}%` : "—"}</td>
      <td className={`py-2 pl-2 pr-4 text-right tabular-nums ${grid ? (p.winPct >= 55 ? "text-good" : p.winPct < 45 ? "text-bad" : "text-muted") : "text-faint"}`}>{grid ? `${p.winPct.toFixed(0)}%` : "—"}</td>
    </tr>
  );
}

function ResultRow({ r }: { r: ProTeamResult }) {
  const meta = [r.tournament, r.format, fmtDate(r.date)].filter(Boolean).join(" · ");
  return (
    <Link
      href={`/pro-matches/${r.seriesId}`}
      className="group flex items-center gap-3 px-4 py-2.5 text-sm transition hover:bg-panel/50 active:bg-panel/80"
      title="Open the full match breakdown"
    >
      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded text-[10px] font-bold ${r.won ? "bg-good/20 text-good" : "bg-bad/20 text-bad"}`}>
        {r.won ? "W" : "L"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-xs text-faint">vs</span>
          <TeamLogo name={r.opponent?.shortName || r.opponent?.name} src={r.opponent?.logoUrl} color={r.opponent?.colorPrimary} size={18} />
          <span className="truncate font-medium text-muted">{r.opponent?.shortName || r.opponent?.name || "TBD"}</span>
        </span>
        <span className="mt-0.5 block truncate text-[10px] text-faint">{meta}</span>
      </span>
      <span className={`shrink-0 tabular-nums text-sm font-semibold ${r.won ? "text-good" : "text-bad"}`}>
        {r.score[0]}–{r.score[1]}
      </span>
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-faint opacity-0 transition group-hover:opacity-100" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
        <path d="M9 6l6 6-6 6" />
      </svg>
    </Link>
  );
}

function StatTile({ label, sub, children }: { label: string; sub?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line/50 bg-panel/40 px-3 py-2">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-faint">{label}</p>
      <p className="mt-0.5 text-lg font-extrabold tabular-nums leading-tight text-ink">{children}</p>
      {sub ? <div className="mt-1">{sub}</div> : null}
    </div>
  );
}

function WinBar({ pct, hex }: { pct: number; hex: string }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-line/50" role="presentation">
      <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: hex }} />
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/pro-matches" className="link-muted inline-flex items-center gap-1.5 text-sm font-medium">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
        <path d="M15 18l-6-6 6-6" />
      </svg>
      Pro matches
    </Link>
  );
}

function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
