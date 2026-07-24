"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ProPlayerStatsResponse, ProPlayerWindow } from "./types";
import { PlayerAvatar } from "./PlayerAvatar";
import { resolvePlayerSteamId } from "@/lib/liquipediaClient";

// Click-a-player drill-down: official GRID aggregates compared across time
// windows (last week → last 12 months) plus peak-map highlights. Fetched
// lazily on first open; each cell is cached hard server-side.
export function PlayerStatsDrawer({
  playerId,
  nick,
  hex,
}: {
  playerId: string;
  nick: string;
  hex: string;
}) {
  const [data, setData] = useState<ProPlayerStatsResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [steamId, setSteamId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    resolvePlayerSteamId(nick)
      .then((id) => {
        if (alive) setSteamId(id);
      })
      .catch(() => {
        // no buttons, that's all
      });
    return () => {
      alive = false;
    };
  }, [nick]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/pro-matches/player/${encodeURIComponent(playerId)}`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const d = (await res.json()) as ProPlayerStatsResponse;
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
  }, [playerId]);

  if (state === "loading") {
    return (
      <div className="space-y-1.5 p-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-6 animate-pulse rounded bg-line/30" />
        ))}
      </div>
    );
  }
  const windows = (data?.windows ?? []).filter((w): w is ProPlayerWindow => !!w);
  if (state === "error" || !data?.any) {
    return (
      <p className="px-4 py-3 text-center text-xs text-faint">
        No tracked stats for {nick} in GRID&apos;s data yet.
      </p>
    );
  }

  const kdColor = (v: number) => (v >= 1.1 ? "text-good" : v < 0.95 ? "text-bad" : "text-ink");
  const year = windows.find((w) => w.window === "LAST_YEAR")?.stats;

  return (
    <div className="overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-line/40 px-4 py-2">
        <PlayerAvatar nick={nick} hex={hex} size={26} />
        <span className="text-sm font-bold text-ink">{nick}</span>
        <span className="text-[10px] uppercase tracking-wider text-faint">form over time</span>
        {year ? (
          <span className="ml-auto text-[10px] tabular-nums text-faint" title="Best single-map kill count in the last 12 months">
            peak <span className="font-bold text-ink">{year.maxKills}</span> kills · one map
          </span>
        ) : null}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[9px] uppercase tracking-wider text-faint">
            <th className="px-4 py-1.5 text-left font-semibold">Period</th>
            <th className="w-12 py-1.5 pl-2 text-right font-semibold" title="Maps GRID tracked in this window">Maps</th>
            <th className="w-12 py-1.5 pl-2 text-right font-semibold" title="Kills / deaths">K/D</th>
            <th className="w-12 py-1.5 pl-2 text-right font-semibold" title="Kills per round">KPR</th>
            <th className="w-13 py-1.5 pl-2 text-right font-semibold" title="Average kills per map">Avg K</th>
            <th className="w-12 py-1.5 pl-2 text-right font-semibold" title="Assists per map">A/map</th>
            <th className="w-12 py-1.5 pl-2 text-right font-semibold" title="% of maps with the opening kill">FK%</th>
            <th className="w-13 py-1.5 pl-2 pr-4 text-right font-semibold" title="Map win rate">Win%</th>
          </tr>
        </thead>
        <tbody>
          {windows.map((w) => {
            const st = w.stats;
            const has = !!st && st.maps > 0;
            return (
              <tr key={w.window} className="border-t border-line/30">
                <td className="px-4 py-1.5 font-medium text-muted">{w.label}</td>
                <td className="py-1.5 pl-2 text-right tabular-nums text-muted">{has ? st.maps : "—"}</td>
                <td className={`py-1.5 pl-2 text-right font-semibold tabular-nums ${has ? kdColor(st.kd) : "text-faint"}`}>{has ? st.kd.toFixed(2) : "—"}</td>
                <td className="py-1.5 pl-2 text-right tabular-nums text-muted">{has && st.kpr > 0 ? st.kpr.toFixed(2) : "—"}</td>
                <td className="py-1.5 pl-2 text-right tabular-nums text-muted">{has ? st.avgKills.toFixed(1) : "—"}</td>
                <td className="py-1.5 pl-2 text-right tabular-nums text-muted">{has && st.maps > 0 ? (st.assists / st.maps).toFixed(1) : "—"}</td>
                <td className="py-1.5 pl-2 text-right tabular-nums text-muted">{has ? `${st.firstKillPct.toFixed(0)}%` : "—"}</td>
                <td className={`py-1.5 pl-2 pr-4 text-right tabular-nums ${has ? (st.mapWinPct >= 55 ? "text-good" : st.mapWinPct < 45 ? "text-bad" : "text-muted") : "text-faint"}`}>
                  {has ? `${st.mapWinPct.toFixed(0)}%` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/30 px-4 py-2">
        <p className="text-[9px] text-faint">
          Official GRID aggregates · map counts reflect GRID&apos;s tracked event coverage per window
        </p>
        {steamId ? (
          <span className="flex items-center gap-1.5">
            <Link
              href={`/profiles/${steamId}`}
              title={`Open ${nick}'s player page on StatRun — matchmaking/FACEIT stats, friends and more (public data only)`}
              className="btn btn-primary h-7 px-2.5 text-[11px]"
            >
              {nick} on StatRun
            </Link>
            <a
              href={`https://steamcommunity.com/profiles/${steamId}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Steam profile"
              className="btn btn-ghost h-7 px-2.5 text-[11px]"
            >
              Steam ↗
            </a>
          </span>
        ) : null}
      </div>
    </div>
  );
}
