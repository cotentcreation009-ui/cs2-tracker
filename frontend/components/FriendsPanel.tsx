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
  rating: number | null; // overall Leetify rating (ranks.leetify); null = unknown, can be negative
  kd?: number; // legacy-enriched accounts only
  total_matches: number;
  faceit_level?: number;
  faceit_elo?: number;
  premier?: number;
  aim?: number; // Leetify aim rating 0..100
  form?: string[]; // recent outcomes, newest first: "W" | "L" | "T"
  banned?: boolean;
  avatar?: string; // Steam avatar (64px), when public
}

// Steam-avatar tile with an initials fallback for private/missing avatars.
function Avatar({ name, src }: { name: string; src?: string }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={32}
      height={32}
      loading="lazy"
      className="h-8 w-8 shrink-0 rounded-md border border-line object-cover"
    />
  ) : (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-panel text-xs font-bold text-muted">
      {initial}
    </span>
  );
}

type SortKey = "rating" | "win" | "kd" | "together";
const SORTS: { key: SortKey; label: string; title: string }[] = [
  { key: "rating", label: "Rating", title: "Overall Leetify rating (same value shown on their profile)" },
  { key: "win", label: "Win %", title: "Lifetime win rate" },
  { key: "kd", label: "K/D", title: "Kills per death (only for accounts with legacy match data — sorted last when unknown)" },
  { key: "together", label: "Together", title: "Matches played together in this player's recent window" },
];

// Overall Leetify rating (can be negative for below-average players). Tiers
// mirror the CheatMeter's read: ≥3 elite, ≥1.5 strong, ≥0 average, <0 below.
const fmtRating = (v: number | null) => (v == null ? "—" : v.toFixed(2));
const ratingColor = (v: number | null) =>
  v == null ? "text-faint" : v >= 3 ? "text-good" : v >= 1.5 ? "text-mid" : v >= 0 ? "text-ink" : "text-bad";

// FACEIT level → its familiar colour band (grey→green→orange→red)
const faceitHex = (lvl: number) =>
  lvl >= 10 ? "#ff3f3f" : lvl >= 8 ? "#ff6c20" : lvl >= 5 ? "#ffcf39" : lvl >= 3 ? "#8bd346" : "#8a93a5";

function RankBadge({ r }: { r: FriendRow }) {
  if (r.faceit_level) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold"
        style={{ background: `${faceitHex(r.faceit_level)}22`, color: faceitHex(r.faceit_level) }}
        title={r.faceit_elo ? `FACEIT level ${r.faceit_level} · ${r.faceit_elo} elo` : `FACEIT level ${r.faceit_level}`}
      >
        FACEIT {r.faceit_level}
        {r.faceit_elo ? <span className="font-medium opacity-80">· {r.faceit_elo}</span> : null}
      </span>
    );
  }
  if (r.premier) {
    return (
      <span
        className="inline-flex items-center rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-bold text-brand"
        title={`Premier rating ${r.premier.toLocaleString()}`}
      >
        Premier {r.premier.toLocaleString()}
      </span>
    );
  }
  return null;
}

function FormDots({ form }: { form: string[] }) {
  return (
    <span className="inline-flex gap-0.5" title={`Recent form (newest first): ${form.join(" ")}`}>
      {form.map((o, i) => (
        <span
          key={i}
          className={`h-3.5 w-3.5 rounded-[3px] text-center text-[8px] font-bold leading-3.5 ${
            o === "W" ? "bg-good/20 text-good" : o === "T" ? "bg-mid/20 text-mid" : "bg-bad/20 text-bad"
          }`}
        >
          {o}
        </span>
      ))}
    </span>
  );
}

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
    sort === "rating"
      ? (r.rating ?? -Infinity)
      : sort === "win"
        ? r.winrate
        : sort === "together"
          ? r.matches_together
          : (r.kd ?? -1);
  const sorted = [...rows].sort((a, b) => val(b) - val(a));
  const cols = "2rem minmax(0,1fr) 4.5rem 3.5rem 3rem 4.5rem 3.5rem 2rem";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted">
          The {rows.length === 1 ? "player" : `${rows.length} players`} this account queues with most
          (from Leetify&apos;s recent matches) — click a row for their profile.
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
        <div
          className="grid items-center gap-2 border-b border-line bg-panel/40 px-3 py-2 text-[10px] uppercase tracking-wider text-faint"
          style={{ gridTemplateColumns: cols }}
        >
          <span>#</span>
          <span>Player</span>
          <span className="text-right">Rating</span>
          <span className="text-right">Win %</span>
          <span className="text-right">K/D</span>
          <span className="text-center">Form</span>
          <span className="text-right">Together</span>
          <span />
        </div>
        {sorted.map((r, i) => (
          <div
            key={r.steam64_id}
            className="group relative grid items-center gap-2 border-t border-line/60 px-3 py-2.5 text-sm transition first-of-type:border-t-0 hover:bg-panel/50"
            style={{ gridTemplateColumns: cols }}
          >
            {/* stretched link: the transparent overlay makes the WHOLE row a
                click target to their profile; static cell text sits under it,
                only the compare link is lifted above it (z-[2]) */}
            <Link
              href={`/profiles/${r.steam64_id}`}
              aria-label={`${r.name || "player"} profile`}
              className="absolute inset-0 z-1"
            />
            <span className="font-bold tabular-nums text-faint">{i + 1}</span>
            <span className="flex min-w-0 items-center gap-2.5">
              <Avatar name={r.name} src={r.avatar} />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-semibold text-ink">
                    {r.name || `Player ${r.steam64_id.slice(-5)}`}
                  </span>
                  {r.banned && (
                    <span className="shrink-0 rounded bg-bad/15 px-1 text-[9px] font-bold text-bad">⚠ BAN</span>
                  )}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5">
                  <RankBadge r={r} />
                  <span className="text-[10px] text-faint">
                    {r.total_matches > 0 ? `${r.total_matches.toLocaleString()} matches` : "not tracked"}
                  </span>
                </span>
              </span>
            </span>
            <span className={`text-right tabular-nums ${ratingColor(r.rating)}`}>{fmtRating(r.rating)}</span>
            <span className="text-right tabular-nums text-ink">
              {r.winrate > 0 ? `${(r.winrate * 100).toFixed(0)}%` : "—"}
            </span>
            <span className={`text-right tabular-nums ${r.kd ? kdColor(r.kd) : "text-faint"}`}>
              {r.kd ? r.kd.toFixed(2) : "—"}
            </span>
            <span className="flex justify-center">
              {r.form && r.form.length ? <FormDots form={r.form} /> : <span className="text-faint">—</span>}
            </span>
            <span className="text-right text-xs tabular-nums text-muted">{r.matches_together}×</span>
            <Link
              href={`/compare?ids=${steamId},${r.steam64_id}`}
              title="Compare this player against the profile you're viewing"
              className="relative z-2 grid h-6 w-6 place-items-center rounded-md border border-line text-muted opacity-0 transition hover:border-brand/60 hover:text-brand group-hover:opacity-100"
              aria-label={`Compare with ${r.name || "player"}`}
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />
              </svg>
            </Link>
          </div>
        ))}
      </div>

      <p className="text-[11px] leading-snug text-faint">
        Rating = their overall Leetify rating · rank badge = FACEIT level (+elo) or Premier rating ·
        Form = last 5 results (newest left) · Together = shared matches in this player&apos;s recent
        window. Hover a row and click <span className="text-muted">⇄</span> to compare that player
        against this profile. K/D and Rating show &quot;—&quot; when Leetify doesn&apos;t expose them.
      </p>
    </div>
  );
}
