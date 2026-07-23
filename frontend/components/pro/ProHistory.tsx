"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ProFormEntry, ProHistory, ProRosterPlayer, ProTeam } from "./types";
import { TeamLogo } from "./TeamLogo";
import { validHex } from "./format";

// Recent form + head-to-head, loaded lazily (after the live scoreboard) from
// /api/pro-matches/{id}/history so it never blocks the live data.
export function ProHistoryPanel({ id, teams }: { id: string; teams: ProTeam[] }) {
  const [data, setData] = useState<ProHistory | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/pro-matches/${id}/history`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const d = (await res.json()) as ProHistory;
        if (!alive) return;
        const anyForm = Object.values(d.form ?? {}).some((f) => f.length > 0);
        const anyH2H = (d.h2h ?? []).length > 0;
        const anyRoster = Object.values(d.rosters ?? {}).some((r) => r.length > 0);
        setData(d);
        setState(anyForm || anyH2H || anyRoster ? "ready" : "empty");
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
      <section className="space-y-3">
        <SectionTitle />
        <div className="grid gap-3 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="card h-40 animate-pulse bg-line/30" />
          ))}
        </div>
      </section>
    );
  }
  if (state !== "ready" || !data) return null; // empty/error → hide silently

  const a = teams[0];
  const b = teams[1];
  const h2h = data.h2h ?? [];
  const aWins = h2h.filter((m) => m.winnerId === a?.gridId).length;
  const bWins = h2h.filter((m) => m.winnerId === b?.gridId).length;

  return (
    <section className="space-y-3">
      <SectionTitle />

      {/* lineups: who's on each team + their recent-series stats */}
      {(data.rosters?.[a?.gridId ?? ""]?.length || data.rosters?.[b?.gridId ?? ""]?.length) ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {[a, b].map((t) =>
            t ? <LineupCard key={t.gridId} team={t} players={data.rosters?.[t.gridId] ?? []} /> : null,
          )}
        </div>
      ) : null}

      {/* head-to-head */}
      {h2h.length > 0 && a && b ? (
        <div className="card-2 p-4">
          <div className="mb-3 flex items-center justify-center gap-4 text-sm">
            <span className="truncate font-bold" style={{ color: validHex(a.colorPrimary) ?? "var(--color-ink)" }}>
              {a.shortName || a.name}
            </span>
            <span className="shrink-0 text-xl font-extrabold tabular-nums">
              <span className={aWins >= bWins ? "text-ink" : "text-faint"}>{aWins}</span>
              <span className="mx-1 text-sm text-faint">–</span>
              <span className={bWins >= aWins ? "text-ink" : "text-faint"}>{bWins}</span>
            </span>
            <span className="truncate font-bold" style={{ color: validHex(b.colorPrimary) ?? "var(--color-ink)" }}>
              {b.shortName || b.name}
            </span>
          </div>
          <div className="mx-auto max-w-md space-y-1">
            {h2h.map((m) => {
              const as = m.scoreByTeam[a.gridId] ?? 0;
              const bs = m.scoreByTeam[b.gridId] ?? 0;
              return (
                <Link
                  key={m.seriesId}
                  href={`/pro-matches/${m.seriesId}`}
                  className="flex items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-xs transition hover:bg-panel/60"
                >
                  <span className="w-16 shrink-0 tabular-nums text-faint">{fmtDate(m.date)}</span>
                  <span className="flex flex-1 items-center justify-center gap-2 tabular-nums">
                    <span className={m.winnerId === a.gridId ? "font-bold text-ink" : "text-muted"}>{as}</span>
                    <span className="text-faint">–</span>
                    <span className={m.winnerId === b.gridId ? "font-bold text-ink" : "text-muted"}>{bs}</span>
                  </span>
                  <span className="w-16 shrink-0 text-right text-faint">
                    {m.winnerId === a.gridId ? a.shortName : m.winnerId === b.gridId ? b.shortName : "—"}
                  </span>
                </Link>
              );
            })}
          </div>
          <p className="mt-2 text-center text-[10px] text-faint">Recent meetings (last ~120 days)</p>
        </div>
      ) : null}

      {/* recent form per team */}
      <div className="grid gap-3 lg:grid-cols-2">
        {[a, b].map((t) =>
          t ? <FormCard key={t.gridId} team={t} entries={data.form?.[t.gridId] ?? []} /> : null,
        )}
      </div>
    </section>
  );
}

// HLTV-style lineup: the team's current players with recent-series stats
// (K/D + kills-per-round aggregated over their last tracked series).
function LineupCard({ team, players }: { team: ProTeam; players: ProRosterPlayer[] }) {
  const hex = validHex(team.colorPrimary) ?? "#8a93a5";
  const kdColor = (v: number) => (v >= 1.1 ? "text-good" : v < 0.95 ? "text-bad" : "text-ink");
  return (
    <div className="card-2 overflow-hidden p-0">
      <Link href={`/pro-matches/team/${team.gridId}`} title="Team page — roster, stats & results" className="flex items-center gap-2 border-b px-4 py-2.5 transition hover:brightness-125" style={{ borderColor: `${hex}33`, background: `linear-gradient(90deg, ${hex}14, transparent)` }}>
        <TeamLogo name={team.shortName || team.name} src={team.logoUrl} color={team.colorPrimary} size={24} />
        <span className="truncate text-sm font-bold text-ink">{team.shortName || team.name}</span>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-faint">Lineup →</span>
      </Link>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[9px] uppercase tracking-wider text-faint">
            <th className="px-4 py-1.5 text-left font-semibold">Player</th>
            <th className="w-11 py-1.5 text-right font-semibold" title="Maps played in the window">Maps</th>
            <th className="w-11 py-1.5 text-right font-semibold" title="Kills / deaths">K/D</th>
            <th className="w-11 py-1.5 text-right font-semibold" title="Average kills per map">Avg K</th>
            <th className="w-11 px-4 py-1.5 text-right font-semibold" title="% of maps where they got the first kill">FK%</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => {
            const has = p.src !== "";
            const n = p.src === "grid" ? p.maps : p.series;
            return (
              <tr key={p.nick} className="border-t border-line/40">
                <td className="max-w-0 truncate px-4 py-1.5">
                  <span className="font-semibold text-ink">{p.nick}</span>
                  {!p.inRoster ? (
                    <span className="ml-1.5 rounded bg-panel px-1 text-[8px] uppercase tracking-wider text-faint" title="Played in recent series but not on the current published roster">recent</span>
                  ) : null}
                </td>
                <td className="py-1.5 text-right tabular-nums text-muted">{has ? n : "—"}</td>
                <td className={`py-1.5 text-right tabular-nums ${has ? kdColor(p.kd) : "text-faint"}`}>{has ? p.kd.toFixed(2) : "—"}</td>
                <td className="py-1.5 text-right tabular-nums text-muted">{has && p.avgKills > 0 ? p.avgKills.toFixed(1) : "—"}</td>
                <td className="px-4 py-1.5 text-right tabular-nums text-muted">{p.src === "grid" ? `${p.fkPct.toFixed(0)}%` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-line/40 px-4 py-1.5 text-[9px] text-faint">Official GRID player statistics, last 3 months</p>
    </div>
  );
}

function FormCard({ team, entries }: { team: ProTeam; entries: ProFormEntry[] }) {
  const hex = validHex(team.colorPrimary) ?? "#8a93a5";
  const wins = entries.filter((e) => e.won).length;
  return (
    <div className="card-2 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Link href={`/pro-matches/team/${team.gridId}`} title="Team page — roster, stats & results" className="flex min-w-0 items-center gap-2 hover:underline">
          <TeamLogo name={team.shortName || team.name} src={team.logoUrl} color={team.colorPrimary} size={22} />
          <span className="truncate text-sm font-bold text-ink">{team.shortName || team.name}</span>
        </Link>
        {entries.length > 0 ? (
          <div className="flex shrink-0 items-center gap-2">
            <span className="flex gap-0.5">
              {entries.map((e) => (
                <span
                  key={e.seriesId}
                  className={`grid h-4 w-4 place-items-center rounded text-[8px] font-bold ${e.won ? "bg-good/20 text-good" : "bg-bad/20 text-bad"}`}
                  title={`${e.won ? "Won" : "Lost"} ${e.score[0]}–${e.score[1]} vs ${e.opponentName}`}
                >
                  {e.won ? "W" : "L"}
                </span>
              ))}
            </span>
            <span className="text-[11px] tabular-nums text-faint">
              {wins}–{entries.length - wins}
            </span>
          </div>
        ) : null}
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-faint">No recent results on record.</p>
      ) : (
        <div className="divide-y divide-line/40" style={{ borderColor: `${hex}22` }}>
          {entries.map((e) => (
            <Link
              key={e.seriesId}
              href={`/pro-matches/${e.seriesId}`}
              className="flex items-center gap-2 py-1.5 text-xs transition hover:bg-panel/50"
            >
              <span
                className={`grid h-4 w-4 shrink-0 place-items-center rounded text-[8px] font-bold ${e.won ? "bg-good/20 text-good" : "bg-bad/20 text-bad"}`}
              >
                {e.won ? "W" : "L"}
              </span>
              <span className="w-14 shrink-0 tabular-nums text-faint">{fmtDate(e.date)}</span>
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="text-faint">vs</span>
                {e.opponentLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={e.opponentLogo} alt="" loading="lazy" className="h-3.5 w-3.5 shrink-0 rounded object-contain" />
                ) : null}
                <span className="truncate text-muted">{e.opponentName}</span>
              </span>
              <span className={`shrink-0 tabular-nums ${e.won ? "text-good" : "text-bad"}`}>
                {e.score[0]}–{e.score[1]}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionTitle() {
  return <h2 className="text-sm font-bold uppercase tracking-wider text-ink">Lineups, form &amp; head-to-head</h2>;
}

function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
