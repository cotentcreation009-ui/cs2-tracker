"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { kdColor } from "@/lib/format";

// FriendsPanel — the "Friends" peek. Leetify's recent_teammates gives the ≤5
// players this account queues with most; the backend resolves each one's
// profile (cached) into ranked rows. Lazy: fetches when the modal mounts.

interface FriendRow {
  steam64_id: string;
  name: string;
  matches_together: number;
  winrate: number; // 0..1
  rating: number; // avg Leetify rating over their recent matches
  kd?: number; // legacy-enriched accounts only
  total_matches: number;
}

type SortKey = "rating" | "win" | "kd";
const SORTS: { key: SortKey; label: string; title: string }[] = [
  { key: "rating", label: "Rating", title: "Average Leetify rating over their recent matches" },
  { key: "win", label: "Win %", title: "Lifetime win rate" },
  { key: "kd", label: "K/D", title: "Kills per death (only for accounts with legacy match data — sorted last when unknown)" },
];

const fmtRating = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
const ratingColor = (v: number) => (v >= 0.05 ? "text-good" : v <= -0.05 ? "text-bad" : "text-ink");

export function FriendsPanel({ steamId }: { steamId: string }) {
  const [rows, setRows] = useState<FriendRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("rating");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/profiles/${steamId}/teammates`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as { teammates: FriendRow[] };
        if (alive) setRows(data.teammates ?? []);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [steamId]);

  if (error)
    return <div className="card px-5 py-6 text-sm text-muted">Couldn&apos;t load friends ({error}).</div>;
  if (rows == null)
    return (
      <div className="card px-5 py-6 text-sm text-muted">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-line border-t-brand align-middle" />{" "}
        Looking up who they queue with…
      </div>
    );
  if (rows.length === 0)
    return (
      <div className="card px-5 py-6 text-sm text-muted">
        No frequent teammates on record — Leetify lists the players someone queued with most across
        their recent matches, and this account has none tracked.
      </div>
    );

  const val = (r: FriendRow): number =>
    sort === "rating" ? r.rating : sort === "win" ? r.winrate : (r.kd ?? -1);
  const sorted = [...rows].sort((a, b) => val(b) - val(a));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted">
          The {rows.length === 1 ? "player" : `${rows.length} players`} this account queues with most
          (from Leetify&apos;s recent matches) — click through to their profiles.
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-faint">Rank by</span>
          <div className="flex rounded-lg border border-line bg-panel p-0.5">
            {SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSort(s.key)}
                aria-pressed={sort === s.key}
                title={s.title}
                className={`rounded-md px-2 py-0.5 text-xs font-medium transition ${
                  sort === s.key ? "bg-brand/15 text-brand" : "text-muted hover:text-ink"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-line">
        <div className="grid grid-cols-[2rem_minmax(0,1fr)_5rem_5rem_4rem_5.5rem] items-center gap-2 border-b border-line bg-panel/40 px-3 py-2 text-[10px] uppercase tracking-wider text-faint">
          <span>#</span>
          <span>Player</span>
          <span className="text-right">Rating</span>
          <span className="text-right">Win %</span>
          <span className="text-right">K/D</span>
          <span className="text-right">Together</span>
        </div>
        {sorted.map((r, i) => (
          <Link
            key={r.steam64_id}
            href={`/profiles/${r.steam64_id}`}
            className="grid grid-cols-[2rem_minmax(0,1fr)_5rem_5rem_4rem_5.5rem] items-center gap-2 border-t border-line/60 px-3 py-2.5 text-sm transition first-of-type:border-t-0 hover:bg-panel/50"
          >
            <span className="font-bold tabular-nums text-faint">{i + 1}</span>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-ink">
                {r.name || `Player ${r.steam64_id.slice(-5)}`}
              </span>
              <span className="block text-[10px] text-faint">
                {r.total_matches > 0 ? `${r.total_matches.toLocaleString()} matches tracked` : "profile not tracked"}
              </span>
            </span>
            <span className={`text-right tabular-nums ${ratingColor(r.rating)}`}>{fmtRating(r.rating)}</span>
            <span className="text-right tabular-nums text-ink">
              {r.winrate > 0 ? `${(r.winrate * 100).toFixed(0)}%` : "—"}
            </span>
            <span className={`text-right tabular-nums ${r.kd ? kdColor(r.kd) : "text-faint"}`}>
              {r.kd ? r.kd.toFixed(2) : "—"}
            </span>
            <span className="text-right text-xs tabular-nums text-muted" title="matches played together in their recent window">
              {r.matches_together}×
            </span>
          </Link>
        ))}
      </div>

      <p className="text-[11px] leading-snug text-faint">
        Rating = their average Leetify rating over recent matches · Win % = lifetime · K/D shows
        &quot;—&quot; when Leetify&apos;s data doesn&apos;t expose it for that account. &quot;Together&quot; counts
        shared matches in this player&apos;s recent window.
      </p>
    </div>
  );
}
