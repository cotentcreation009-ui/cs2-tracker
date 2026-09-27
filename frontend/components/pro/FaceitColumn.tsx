"use client";

import { memo, useState } from "react";
import { usePoll } from "./usePoll";
import {
  REGIONS,
  SPOTLIGHT_POLL_MS,
  levelHex,
  type FaceitRanked,
  type SpotlightResponse,
} from "./ProSpotlight";
import { flag } from "@/lib/format";
import { COLUMN_CLS, ColumnSkeleton } from "./BoardSections";
import {
  DetailHint,
  DetailLine,
  DetailPopover,
  useDetailAnchor,
  type RowBind,
} from "./DetailPopover";

// The right column of the three-column board: FACEIT's leaderboard as a
// ranked list, with the same region switcher as the rail below xl. Its own
// fetch (?only=faceit) so a region change never re-runs the roster work
// behind the other columns.
//
// Three layers per player: the row is position, flag, nick, elo and level;
// hover or focus opens a panel with the face, country, region, elo and a
// level meter; a click opens their FACEIT profile.

const POP_ID = "faceit-detail";

const rowKey = (f: FaceitRanked) => f.playerId || f.nickname;

function countryName(cc: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(cc) ?? cc;
  } catch {
    return cc;
  }
}

export const FaceitColumn = memo(function FaceitColumn() {
  const [region, setRegion] = useState<string>("EU");
  const { data, loading } = usePoll<SpotlightResponse>(
    `/api/pro-matches/spotlight?only=faceit&region=${region}`,
    SPOTLIGHT_POLL_MS,
  );
  const rows = data?.faceit ?? [];
  const regionLabel = REGIONS.find((r) => r.code === region)?.label ?? region;
  const { anchor, bind } = useDetailAnchor();
  const open = anchor ? rows.find((f) => rowKey(f) === anchor.key) : undefined;

  return (
    <aside aria-labelledby="faceit-column-title" className={COLUMN_CLS}>
      <div className="sticky top-0 z-10 border-b border-line/60 bg-panel px-3 pb-2 pt-3">
        <h2
          id="faceit-column-title"
          className="text-sm font-semibold uppercase tracking-wider text-muted"
        >
          Top FACEIT players
        </h2>
        <p className="mt-0.5 text-[11px] leading-snug text-faint">
          FACEIT&apos;s published leaderboard, by elo
        </p>
        <div role="group" aria-label="Region" className="mt-2 flex flex-wrap gap-1">
          {REGIONS.map((r) => {
            const on = r.code === region;
            return (
              <button
                key={r.code}
                type="button"
                aria-pressed={on}
                title={r.label}
                onClick={() => setRegion(r.code)}
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
      </div>

      {loading && !data ? (
        <ColumnSkeleton />
      ) : rows.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted">
          FACEIT has no leaderboard for this region right now.
        </p>
      ) : (
        <ol role="list" aria-label={`${regionLabel} leaderboard`} className="p-2">
          {rows.map((f) => {
            const key = rowKey(f);
            return (
              <li key={key}>
                <FaceitRow
                  player={f}
                  bind={bind(key)}
                  describedBy={anchor?.key === key ? POP_ID : undefined}
                />
              </li>
            );
          })}
        </ol>
      )}

      {anchor && open ? (
        <DetailPopover key={anchor.key} id={POP_ID} anchor={anchor.rect} place="left" width={272}>
          <FaceitDetail player={open} regionLabel={regionLabel} />
        </DetailPopover>
      ) : null}
    </aside>
  );
});

// position · flag + nickname · elo · level badge in FACEIT's level colour
function FaceitRow({
  player: p,
  bind,
  describedBy,
}: {
  player: FaceitRanked;
  bind: RowBind;
  describedBy?: string;
}) {
  const hex = levelHex(p.skillLevel);
  const cc = p.country && p.country.length === 2 ? p.country.toUpperCase() : "";
  const cls = "flex items-center gap-2 rounded-lg px-2 py-1.5";

  const body = (
    <>
      <span className="w-6 shrink-0 text-right text-[11px] font-semibold tabular-nums text-faint">
        {p.position ?? ""}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
        {cc && (
          <>
            <span aria-hidden className="mr-1">{flag(cc)}</span>
            <span className="sr-only">{cc} </span>
          </>
        )}
        {p.nickname}
      </span>
      {p.elo != null && (
        <span className="shrink-0 text-xs font-bold tabular-nums text-ink">
          {p.elo.toLocaleString("en-US")}
          <span className="sr-only"> elo</span>
        </span>
      )}
      {p.skillLevel ? (
        <span
          className="grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[10px] font-black tabular-nums"
          style={{
            color: hex,
            borderColor: `color-mix(in srgb, ${hex} 55%, transparent)`,
            background: `color-mix(in srgb, ${hex} 14%, transparent)`,
          }}
        >
          <span aria-hidden>{p.skillLevel}</span>
          <span className="sr-only">level {p.skillLevel}</span>
        </span>
      ) : null}
    </>
  );

  if (!p.faceitUrl) return <span className={cls}>{body}</span>;
  const external = /^(https?:)?\/\//i.test(p.faceitUrl);
  return (
    <a
      href={p.faceitUrl}
      aria-describedby={describedBy}
      className={`${cls} transition-colors hover:bg-panel2 focus-visible:bg-panel2`}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      {...bind}
    >
      {body}
      <span className="sr-only">, FACEIT profile</span>
    </a>
  );
}

// The hover/focus layer: everything FACEIT's leaderboard says about them.
function FaceitDetail({ player: p, regionLabel }: { player: FaceitRanked; regionLabel: string }) {
  const hex = levelHex(p.skillLevel);
  const cc = p.country && p.country.length === 2 ? p.country.toUpperCase() : "";
  const initial = Array.from(p.nickname.trim())[0]?.toUpperCase() ?? "?";
  return (
    <>
      <div className="flex items-center gap-2.5">
        {p.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.avatar}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-11 w-11 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-base font-black"
            style={{
              color: hex,
              background: `color-mix(in srgb, ${hex} 16%, transparent)`,
              boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${hex} 45%, transparent)`,
            }}
          >
            {initial}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold text-ink">{p.nickname}</p>
          <p className="truncate text-[11px] text-muted">
            {cc ? `${flag(cc)} ${countryName(cc)}` : "Country not listed"}
          </p>
        </div>
      </div>
      <div className="mt-2 space-y-1">
        <DetailLine label="Position">
          {p.position != null ? `#${p.position} · ${regionLabel}` : regionLabel}
        </DetailLine>
        <DetailLine label="Elo">{p.elo != null ? p.elo.toLocaleString("en-US") : "—"}</DetailLine>
        <DetailLine label="Level">
          <span style={{ color: hex }}>{p.skillLevel ? `Level ${p.skillLevel}` : "—"}</span>
        </DetailLine>
        {p.skillLevel ? <LevelMeter level={p.skillLevel} hex={hex} /> : null}
      </div>
      <DetailHint>Click to open their FACEIT profile in a new tab.</DetailHint>
    </>
  );
}

// Ten segments, one per level, lit in the level's colour.
function LevelMeter({ level, hex }: { level: number; hex: string }) {
  return (
    <span aria-hidden className="mt-1 flex gap-0.5">
      {Array.from({ length: 10 }).map((_, i) => (
        <span
          key={i}
          className="h-1 flex-1 rounded-full"
          style={
            i < level
              ? { backgroundColor: hex, boxShadow: `0 0 6px -1px ${hex}` }
              : { backgroundColor: "color-mix(in srgb, var(--color-line) 85%, transparent)" }
          }
        />
      ))}
    </span>
  );
}
