"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FaceitRankedPlayer, FaceitRankingsResponse } from "@/lib/types";
import { faceitLevelHex, flag } from "@/lib/format";
import {
  REGIONS,
  REGION_STORAGE_KEY,
  asOfLabel,
  initialOf,
  levelTitle,
  pickRegion,
  regionLabel,
  rowHref,
  splitColumns,
} from "@/components/faceitTop";

// The client half of the FACEIT strip: region pills over a two-column board.
// Every region's rows arrive from the server component, so switching is a
// state change and nothing else — no fetch, no spinner. The last pick is a
// per-viewer convenience remembered in localStorage and applied after mount,
// so the server HTML is always the default region and never mismatches.
export function FaceitTopPlayersTabs({
  lists,
  initialRegion,
}: {
  lists: Partial<Record<string, FaceitRankingsResponse>>;
  initialRegion: string;
}) {
  const available = REGIONS.map((r) => r.code).filter((c) => lists[c]);
  const [region, setRegion] = useState<string>(
    pickRegion(initialRegion, available),
  );

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(REGION_STORAGE_KEY);
      if (stored) setRegion(pickRegion(stored, available));
    } catch {
      /* storage disabled — the default stands */
    }
    // The available set is fixed for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choose(code: string) {
    setRegion(code);
    try {
      window.localStorage.setItem(REGION_STORAGE_KEY, code);
    } catch {
      /* ignore */
    }
  }

  const list = lists[region] ?? lists[available[0]];
  if (!list) return null;
  const [left, right] = splitColumns(list.players);
  const label = regionLabel(region);
  const stamp = list.stale ? asOfLabel(list.fetchedAt, true) : "";

  return (
    <div className="card-2 px-3 pb-3 pt-3 sm:px-4 sm:pb-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <div
          role="group"
          aria-label="Region"
          className="flex flex-wrap gap-1"
        >
          {REGIONS.filter((r) => lists[r.code]).map((r) => {
            const on = r.code === region;
            return (
              <button
                key={r.code}
                type="button"
                aria-pressed={on}
                title={r.label}
                onClick={() => choose(r.code)}
                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition ${
                  on
                    ? "border-brand/60 bg-brand/15 text-ink"
                    : "border-line bg-panel text-muted hover:text-ink"
                }`}
              >
                {r.code}
              </button>
            );
          })}
        </div>
        <span className="text-[11px] text-faint">{label} · top 10 by elo</span>
      </div>

      <div className="grid gap-x-6 lg:grid-cols-2">
        <ol role="list" aria-label={`${label} leaderboard, places 1 to ${left.length}`}>
          {left.map((p) => (
            <li key={p.playerId || p.nickname}>
              <Row player={p} />
            </li>
          ))}
        </ol>
        {right.length > 0 && (
          <ol
            role="list"
            aria-label={`${label} leaderboard, places ${left.length + 1} to ${
              left.length + right.length
            }`}
          >
            {right.map((p) => (
              <li key={p.playerId || p.nickname}>
                <Row player={p} />
              </li>
            ))}
          </ol>
        )}
      </div>

      <p className="mt-2 px-1 text-[11px] text-faint">
        Elo is only comparable within a region.
        {stamp ? ` ${label}: ${stamp}.` : ""}
      </p>
    </div>
  );
}

// position · avatar (or an initial tile in the level's colour) · flag + nick
// · elo · level badge. A row with a Steam id is a profile link here; one
// without goes to FACEIT in a new tab and says so.
function Row({ player: p }: { player: FaceitRankedPlayer }) {
  const hex = faceitLevelHex(p.skillLevel);
  const cc = p.country && p.country.length === 2 ? p.country.toUpperCase() : "";
  const target = rowHref(p);
  const cls =
    "flex h-11 items-center gap-2.5 rounded-lg px-2 transition-colors hover:bg-panel focus-visible:bg-panel";

  const body = (
    <>
      <span className="w-6 shrink-0 text-right text-[11px] font-semibold tabular-nums text-faint">
        {p.position || ""}
      </span>
      {p.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={p.avatar}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-8 w-8 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-black"
          style={{
            color: hex,
            background: `color-mix(in srgb, ${hex} 16%, transparent)`,
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${hex} 45%, transparent)`,
          }}
        >
          {initialOf(p.nickname)}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
        {cc && (
          <>
            <span aria-hidden className="mr-1">
              {flag(cc)}
            </span>
            <span className="sr-only">{cc} </span>
          </>
        )}
        {p.nickname}
      </span>
      {p.elo > 0 && (
        <span className="shrink-0 text-xs font-bold tabular-nums text-ink">
          {p.elo.toLocaleString("en-US")}
          <span className="sr-only"> elo</span>
        </span>
      )}
      {p.skillLevel > 0 && (
        <span
          title={levelTitle(p.skillLevel)}
          className="grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[10px] font-black tabular-nums"
          style={{
            color: hex,
            borderColor: `color-mix(in srgb, ${hex} 55%, transparent)`,
            background: `color-mix(in srgb, ${hex} 14%, transparent)`,
          }}
        >
          <span aria-hidden>{p.skillLevel}</span>
          <span className="sr-only">{levelTitle(p.skillLevel)}</span>
        </span>
      )}
    </>
  );

  if (!target) return <span className={cls}>{body}</span>;
  if (!target.external) {
    return (
      <Link href={target.href} className={cls}>
        {body}
      </Link>
    );
  }
  return (
    <a href={target.href} target="_blank" rel="noreferrer" className={cls}>
      {body}
      <span aria-hidden className="shrink-0 text-[11px] text-faint">
        ↗
      </span>
      <span className="sr-only">, FACEIT profile (opens in a new tab)</span>
    </a>
  );
}
