"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ProTeamPage } from "./types";
import { TeamLogo } from "./TeamLogo";
import { validHex } from "./format";

// HLTV-style team page: identity header (record + streak), the roster with
// per-player stats aggregated over recent tracked series, and the results list.
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
        <div className="card-2 h-32 animate-pulse bg-line/20" />
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
  const kdColor = (v: number) => (v >= 1.1 ? "text-good" : v < 0.95 ? "text-bad" : "text-ink");

  return (
    <div className="space-y-5">
      <BackLink />

      {/* identity header */}
      <div className="card-2 relative overflow-hidden p-6">
        <span aria-hidden className="pointer-events-none absolute -left-24 -top-28 h-64 w-64 rounded-full opacity-[0.18] blur-3xl" style={{ background: hex }} />
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ backgroundImage: `linear-gradient(90deg, ${hex}, transparent 70%)` }} />
        <div className="relative flex flex-wrap items-center gap-4">
          <TeamLogo name={t.shortName || t.name} src={t.logoUrl} color={t.colorPrimary} size={64} />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-extrabold tracking-tight text-ink">{t.name || t.shortName || "Team"}</h1>
            {rec && rec.wins + rec.losses > 0 ? (
              <p className="mt-0.5 text-sm text-muted">
                <span className="font-semibold text-good">{rec.wins}W</span>{" "}
                <span className="font-semibold text-bad">{rec.losses}L</span>{" "}
                <span className="text-faint">
                  · {Math.round((rec.wins / (rec.wins + rec.losses)) * 100)}% over recent series
                </span>
                {rec.streak > 1 ? (
                  <span className={`ml-1.5 ${rec.streakWon ? "text-good" : "text-bad"}`}>
                    · {rec.streak} {rec.streakWon ? "wins" : "losses"} in a row
                  </span>
                ) : null}
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-faint">No recent tracked series.</p>
            )}
          </div>
        </div>
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
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-2 text-left font-semibold">Player</th>
                  <th className="w-13 py-2 text-right font-semibold" title="Maps played in the last year">Maps</th>
                  <th className="w-20 py-2 text-right font-semibold" title="Total kills − deaths">K–D</th>
                  <th className="w-13 py-2 text-right font-semibold" title="Kills / deaths">K/D</th>
                  <th className="w-13 py-2 text-right font-semibold" title="Average kills per map">Avg K</th>
                  <th className="w-13 py-2 text-right font-semibold" title="% of maps where they got the first kill">FK%</th>
                  <th className="w-13 px-4 py-2 text-right font-semibold" title="Map win rate">Win%</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => {
                  const has = p.src !== "";
                  const grid = p.src === "grid";
                  const n = grid ? p.maps : p.series;
                  return (
                    <tr key={p.nick} className="border-t border-line/40">
                      <td className="max-w-0 truncate px-4 py-2">
                        <span className="font-semibold text-ink">{p.nick}</span>
                        {!p.inRoster ? (
                          <span className="ml-1.5 rounded bg-panel px-1 text-[8px] uppercase tracking-wider text-faint" title="Played recently but not on the current published roster">recent</span>
                        ) : null}
                      </td>
                      <td className="py-2 text-right tabular-nums text-muted">{has ? n : "—"}</td>
                      <td className="py-2 text-right tabular-nums text-muted">{has ? `${p.kills}–${p.deaths}` : "—"}</td>
                      <td className={`py-2 text-right tabular-nums ${has ? kdColor(p.kd) : "text-faint"}`}>{has ? p.kd.toFixed(2) : "—"}</td>
                      <td className="py-2 text-right tabular-nums text-muted">{grid && p.avgKills > 0 ? p.avgKills.toFixed(1) : "—"}</td>
                      <td className="py-2 text-right tabular-nums text-muted">{grid ? `${p.fkPct.toFixed(0)}%` : "—"}</td>
                      <td className={`px-4 py-2 text-right tabular-nums ${grid ? (p.winPct >= 55 ? "text-good" : p.winPct < 45 ? "text-bad" : "text-muted") : "text-faint"}`}>{grid ? `${p.winPct.toFixed(0)}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
                <Link
                  key={r.seriesId}
                  href={`/pro-matches/${r.seriesId}`}
                  className="flex items-center gap-3 px-4 py-2 text-sm transition hover:bg-panel/50"
                >
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded text-[9px] font-bold ${r.won ? "bg-good/20 text-good" : "bg-bad/20 text-bad"}`}>
                    {r.won ? "W" : "L"}
                  </span>
                  <span className="w-14 shrink-0 tabular-nums text-xs text-faint">{fmtDate(r.date)}</span>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="text-xs text-faint">vs</span>
                    <TeamLogo name={r.opponent?.shortName || r.opponent?.name} src={r.opponent?.logoUrl} color={r.opponent?.colorPrimary} size={20} />
                    <span className="truncate text-muted">{r.opponent?.shortName || r.opponent?.name || "TBD"}</span>
                  </span>
                  <span className={`shrink-0 tabular-nums text-sm font-semibold ${r.won ? "text-good" : "text-bad"}`}>
                    {r.score[0]}–{r.score[1]}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <p className="text-[11px] leading-snug text-faint">
        Player stats are GRID&apos;s official aggregates over the last year of tracked pro play
        (players without official data fall back to recent-series aggregates). Click a result to
        open that match.
      </p>
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
