"use client";

import { useState, type ReactNode } from "react";
import type { LeetifyRecentMatch } from "@/lib/types";
import { mapLabel, premierHex, timeAgo } from "@/lib/format";
import { AnalyzeDemoButton } from "@/components/AnalyzeDemoButton";

// Queue identity: Premier and Competitive both arrive as data_source
// "matchmaking" — rank_type is what actually distinguishes them (11 = Premier,
// 12 = Competitive), so labels/colors key off that first. Rendered as a small
// colour-keyed wordmark (dot + small caps), not a boxed pill — a border around
// the same word on every row was pure noise.
function sourceInfo(m: LeetifyRecentMatch): { label: string; hex: string } {
  if (m.rank_type === 11) return { label: "Premier", hex: "#b8a5ff" };
  if (m.data_source === "faceit") return { label: "FACEIT", hex: "#ff8a50" };
  if (m.rank_type === 12) return { label: "Comp", hex: "#38d6ff" };
  if (m.data_source === "matchmaking_wingman" || m.data_source === "wingman")
    return { label: "Wingman", hex: "#8a93a5" };
  const fallback: Record<string, string> = { matchmaking: "MM", renown: "Renown", esportal: "Esportal" };
  return { label: fallback[m.data_source] || m.data_source, hex: "#8a93a5" };
}

// The at-a-glance read of the whole window, so the table opens with a story
// instead of a wall of rows: record, K/D, net rating movement, average impact.
function WindowSummary({ matches }: { matches: LeetifyRecentMatch[] }) {
  let w = 0;
  let l = 0;
  let t = 0;
  let kills = 0;
  let deaths = 0;
  let netPremier = 0;
  let premierN = 0;
  let netElo = 0;
  let eloN = 0;
  let impact = 0;
  for (const m of matches) {
    if (m.outcome === "win") w++;
    else if (m.outcome === "loss") l++;
    else t++;
    kills += m.kills ?? 0;
    deaths += m.deaths ?? 0;
    if (m.rank_delta != null) {
      if (m.rank_type === 11) {
        netPremier += m.rank_delta;
        premierN++;
      } else if (m.data_source === "faceit") {
        netElo += m.rank_delta;
        eloN++;
      }
    }
    impact += m.leetify_rating;
  }
  const kd = deaths > 0 ? kills / deaths : 0;
  const avgImpact = matches.length ? (impact / matches.length) * 100 : 0;
  const item = (label: string, value: ReactNode) => (
    <span className="flex items-baseline gap-1.5">
      <span className="stat-label">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-line bg-panel/30 px-3 py-2">
      {item(
        "Record",
        <>
          <span className="text-good">{w}W</span>
          <span className="mx-0.5 text-faint">·</span>
          <span className="text-bad">{l}L</span>
          {t > 0 ? (
            <>
              <span className="mx-0.5 text-faint">·</span>
              <span className="text-mid">{t}T</span>
            </>
          ) : null}
        </>,
      )}
      {kd > 0 ? item("K/D", <span className={kd >= 1.1 ? "text-good" : kd < 0.95 ? "text-bad" : "text-ink"}>{kd.toFixed(2)}</span>) : null}
      {premierN > 0
        ? item(
            "Premier net",
            <span className={deltaColor(netPremier)}>{signedInt(netPremier)}</span>,
          )
        : null}
      {eloN > 0
        ? item("FACEIT net", <span className={deltaColor(netElo)}>{signedInt(netElo)}</span>)
        : null}
      {matches.length > 0
        ? item("Avg impact", <span className={impactColor(avgImpact / 100)}>{`${avgImpact >= 0 ? "+" : ""}${avgImpact.toFixed(2)}`}</span>)
        : null}
      <span className="ml-auto text-[10px] text-faint">last {matches.length} games</span>
    </div>
  );
}

// Valve's 18 competitive skill groups (rank_type 12's rank value).
const COMP_RANKS = [
  "Silver 1", "Silver 2", "Silver 3", "Silver 4", "Silver Elite", "Silver Elite Master",
  "Gold Nova 1", "Gold Nova 2", "Gold Nova 3", "Gold Nova Master",
  "Master Guardian 1", "Master Guardian 2", "Master Guardian Elite", "Distinguished Master Guardian",
  "Legendary Eagle", "Legendary Eagle Master", "Supreme Master First Class", "Global Elite",
];
// the in-game abbreviations, for the narrow rank column
const COMP_SHORT = [
  "S1", "S2", "S3", "S4", "SE", "SEM",
  "GN1", "GN2", "GN3", "GNM",
  "MG1", "MG2", "MGE", "DMG",
  "LE", "LEM", "SMFC", "GE",
];

const FACEIT_HEX = "#ff8a50";

// One rating badge in the game's own visual language: a slightly slanted
// plate, italic bold numerals, and the double-slash mark Premier uses —
// tinted with the tier colour, which genuinely changes when a rating crosses
// a bracket mid-pair.
function RatingBadge({
  text,
  hex,
  dim = false,
  slashes = false,
  title,
}: {
  text: string;
  hex: string;
  dim?: boolean;
  slashes?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-block shrink-0 -skew-x-6 rounded-[3px] px-1 py-px ${dim ? "opacity-60" : ""}`}
      style={{ background: `${hex}17`, boxShadow: `inset 0 0 0 1px ${hex}45` }}
    >
      <span className="inline-block skew-x-6 text-[10.5px] font-extrabold italic leading-4 tabular-nums" style={{ color: hex }}>
        {slashes ? <span className="mr-0.5 opacity-60">{"//"}</span> : null}
        {text}
      </span>
    </span>
  );
}

// The rank column, laid out like the game's own match history: the rating you
// carried in, the change stacked over a small arrow, and the rating you left
// with. Games Leetify never rated keep a neutral placeholder so the column
// always reads as a column.
function RankCell({ m }: { m: LeetifyRecentMatch }) {
  const delta = m.rank_delta;
  const isPremier = m.rank_type === 11;
  const isFaceit = m.data_source === "faceit";
  const before = m.rank_before ?? 0;
  const after = isPremier ? (m.rank ?? 0) : isFaceit ? (m.elo ?? 0) : 0;
  const hexOf = (v: number) => (isPremier ? premierHex(v) : FACEIT_HEX);
  const ladderName = isPremier ? "Premier rating" : "FACEIT elo";

  if ((isPremier || isFaceit) && after > 0) {
    return (
      <span
        className="flex items-center justify-end gap-1"
        title={
          delta != null
            ? `${ladderName}: ${before.toLocaleString()} → ${after.toLocaleString()} (${signedInt(delta)})`
            : `${ladderName} after this game — Leetify didn't record the change`
        }
      >
        {delta != null && before > 0 ? (
          <>
            <RatingBadge text={before.toLocaleString()} hex={hexOf(before)} slashes={isPremier} dim />
            {/* the change rides above the arrow, like the in-game history */}
            <span className="flex w-8 shrink-0 flex-col items-center gap-px leading-none">
              <span className={`text-[9px] font-bold tabular-nums ${deltaColor(delta)}`}>{signedInt(delta)}</span>
              <svg viewBox="0 0 16 6" className="h-1.5 w-4 text-faint" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                <path d="M1 3h13m0 0-2.4-2M14 3l-2.4 2" />
              </svg>
            </span>
          </>
        ) : null}
        <RatingBadge text={after.toLocaleString()} hex={hexOf(after)} slashes={isPremier} />
      </span>
    );
  }

  // no ladder number for this game: FACEIT level, a Competitive skill group,
  // or a queue with no rating at all
  const level = isFaceit ? (m.rank ?? 0) : 0;
  const comp = m.rank_type === 12 && (m.rank ?? 0) >= 1 && (m.rank ?? 0) <= 18 ? (m.rank ?? 1) - 1 : -1;
  return (
    <span className="flex items-center justify-end">
      {level > 0 ? (
        <RatingBadge text={`Lvl ${level}`} hex={FACEIT_HEX} title="FACEIT level" />
      ) : comp >= 0 ? (
        <RatingBadge text={COMP_SHORT[comp]} hex="#38d6ff" title={COMP_RANKS[comp]} />
      ) : (
        <span
          className="shrink-0 rounded bg-line/40 px-1 py-px text-[10px] font-bold text-faint"
          title="No rating recorded for this game"
        >
          —
        </span>
      )}
    </span>
  );
}

// Deterministic per-map hues so the map column scans by colour before it's
// read — the classic pool gets hand-picked tones, anything else derives one.
const MAP_HUES: Record<string, string> = {
  mirage: "#e8b04c", inferno: "#e8734c", dust2: "#d9c27a", nuke: "#7aa3d9",
  ancient: "#6cbf7a", anubis: "#4cc9c0", overpass: "#7ac292", vertigo: "#8a7dff",
  train: "#9aa7b8", cache: "#b8c96e", office: "#9cc1ff", italy: "#c9856e",
};

function mapHue(name: string): string {
  if (MAP_HUES[name]) return MAP_HUES[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h} 45% 62%)`;
}

// "D2" for dust2, "MI" for mirage, "SD" for shortdust — a compact monogram.
function mapCode(name: string): string {
  const m = /^(.*?)(\d)$/.exec(name);
  if (m && m[1]) return (m[1][0] + m[2]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function MapBadge({ name }: { name: string }) {
  const hue = mapHue(name);
  return (
    <span
      aria-hidden
      className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-[8px] font-extrabold"
      style={{ background: `color-mix(in srgb, ${hue} 14%, transparent)`, color: hue, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${hue} 35%, transparent)` }}
    >
      {mapCode(name)}
    </span>
  );
}

// Per-game leetify_rating arrives as a raw fraction (0.0434); Leetify's own
// site displays it x100 ("+4.34"), matching the overall ranks.leetify scale.
function signed(n: number): string {
  const v = n * 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
}
const impactColor = (n: number) =>
  n > 0.03 ? "text-good" : n < -0.03 ? "text-bad" : "text-mid";

// Friends-only Leetify profiles redact per-match aim detail (it comes back as
// 0). A 0 here means "hidden", so show a dash rather than "0.0%".
const dash = (v: number, fmt: (n: number) => string) => (v > 0 ? fmt(v) : "—");

// The ladder number this game moved, if any. `value` is the rating AFTER the
// game; `ladder` marks the ones that carry a before→after movement (Premier
// rating and FACEIT elo) as opposed to static context (level, comp rank).
function rankAfter(
  m: LeetifyRecentMatch,
): { label: string; value: string; ladder: boolean } | null {
  if (m.rank_type === 11 && (m.rank ?? 0) > 0)
    return { label: "Premier rating", value: (m.rank ?? 0).toLocaleString(), ladder: true };
  if (m.data_source === "faceit" && (m.elo ?? 0) > 0)
    return { label: "FACEIT elo", value: (m.elo ?? 0).toLocaleString(), ladder: true };
  if (m.data_source === "faceit" && (m.rank ?? 0) > 0)
    return { label: "FACEIT level", value: String(m.rank), ladder: false };
  if (m.rank_type === 12 && (m.rank ?? 0) >= 1 && (m.rank ?? 0) <= 18)
    return { label: "Comp rank", value: COMP_RANKS[(m.rank ?? 1) - 1], ladder: false };
  return null;
}

const deltaColor = (d: number) => (d > 0 ? "text-good" : d < 0 ? "text-bad" : "text-muted");
const signedInt = (d: number) => `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d)}`;

// Column widths + row padding shared by the header and every row, so the
// labels always sit over the numbers they describe.
const ROW_PAD = "gap-1.5 px-2 py-2 sm:gap-3 sm:px-3";
// Column reveal by breakpoint: phones get map/score/impact/queue; ≥sm adds the
// rank pair; ≥md splits out K, D and +/−; ≥lg adds HS%. Everything hidden from
// a narrow row still appears in the expanded panel.
const COL = {
  badge: "w-5",
  map: "w-16 sm:w-24",
  score: "w-11 sm:w-12",
  k: "md:w-7",
  d: "md:w-7",
  diff: "md:w-9",
  hs: "lg:w-10",
  rating: "w-12 sm:w-13",
  // fits "27,853 → 27,974" as two slanted plates with the change over the arrow
  delta: "sm:w-40",
  // fits the longest wordmark ("WINGMAN") with its dot at both breakpoints
  queue: "w-16 sm:w-21",
};

function Stat({
  label,
  value,
  valueHex,
  sub,
}: {
  label: string;
  value: ReactNode;
  valueHex?: string;
  sub?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-line bg-panel px-2.5 py-1.5">
      <div className="stat-label">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums" style={valueHex ? { color: valueHex } : undefined}>
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-[10px] leading-tight tabular-nums">{sub}</div> : null}
    </div>
  );
}

/**
 * LeetifyRecentMatches renders the Leetify recent-match list with click-to-expand
 * rows: queue chip (Premier/Comp/FACEIT), score, K-D, per-game Leetify rating,
 * Premier-rating/FACEIT-elo change, and an expandable per-match stat panel.
 */
export function LeetifyRecentMatches({
  matches,
  steamId,
}: {
  matches: LeetifyRecentMatch[];
  steamId: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (matches.length === 0) return null;

  return (
    <div className="mt-5">
      <div className="stat-label mb-2">Recent matches (Leetify)</div>
      <div className="overflow-hidden rounded-xl border border-line bg-panel2/20">
        <WindowSummary matches={matches} />
        {/* column headers — four similar-looking numbers per row are
            unreadable without labels; widths are shared with the rows below
            via COL so the two can never drift apart */}
        <div
          aria-hidden
          className={`flex items-center border-b border-line bg-panel/40 text-[9px] font-semibold uppercase tracking-[0.14em] text-faint ${ROW_PAD}`}
        >
          <span className={`${COL.badge} shrink-0`} />
          <span className={`${COL.map} shrink-0`}>Map</span>
          <span className={`${COL.score} shrink-0 text-right`}>Score</span>
          <span className={`${COL.k} hidden shrink-0 text-right md:inline`} title="Kills">K</span>
          <span className={`${COL.d} hidden shrink-0 text-right md:inline`} title="Deaths">D</span>
          <span className={`${COL.diff} hidden shrink-0 text-right md:inline`} title="Kill − death difference">+/−</span>
          <span className={`${COL.hs} hidden shrink-0 text-right lg:inline`} title="Headshot accuracy">HS%</span>
          <span className={`${COL.rating} shrink-0 text-right`} title="Leetify's rating for the game">
            Leetify
          </span>
          <span
            className={`${COL.delta} hidden shrink-0 text-right sm:inline`}
            title="Premier rating / FACEIT elo before and after this game, and the change"
          >
            Rank before → after
          </span>
          <span className={`${COL.queue} shrink-0`}>Queue</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            When
            <span className="w-3.5" />
          </span>
        </div>

        <div className="divide-y divide-line/30">
        {matches.map((m, i) => {
          const key = m.id || String(i);
          const won = m.outcome === "win";
          const tie = m.outcome === "tie";
          const isOpen = open === key;
          const src = sourceInfo(m);
          // Go omits zero values, so a genuine 0-kill game arrives with no
          // `kills` field — default before formatting or the row renders
          // "undefined-7".
          const kills = m.kills ?? 0;
          const deaths = m.deaths ?? 0;
          const hasKD = kills + deaths > 0;
          const kdDiff = kills - deaths;
          const delta = m.rank_delta;
          const after = rankAfter(m);
          const afterHex =
            after?.label === "Premier rating" ? premierHex(m.rank ?? 0) : undefined;
          return (
            <div key={key} className={isOpen ? "bg-panel/30" : ""}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : key)}
                aria-expanded={isOpen}
                className={`group relative flex w-full items-center text-left text-sm transition hover:bg-panel/60 ${ROW_PAD}`}
              >
                {/* outcome edge + badge */}
                <span
                  aria-hidden
                  className={`absolute inset-y-1 left-0 w-0.75 rounded-r-full ${tie ? "bg-mid/70" : won ? "bg-good/70" : "bg-bad/70"}`}
                />
                <span
                  className={`${COL.badge} grid h-5 shrink-0 place-items-center rounded text-[11px] font-bold ${
                    tie
                      ? "bg-mid/20 text-mid"
                      : won
                        ? "bg-good/20 text-good"
                        : "bg-bad/20 text-bad"
                  }`}
                >
                  {tie ? "T" : won ? "W" : "L"}
                </span>
                <span className={`${COL.map} flex shrink-0 items-center gap-1.5`}>
                  <MapBadge name={mapLabel(m.map_name)} />
                  <span className="truncate font-medium capitalize">{mapLabel(m.map_name)}</span>
                </span>
                {/* the score wears the outcome colour — win green, loss red */}
                <span
                  className={`${COL.score} shrink-0 whitespace-nowrap text-right font-semibold tabular-nums ${
                    tie ? "text-mid" : won ? "text-good" : "text-bad"
                  }`}
                >
                  {m.score?.length === 2 ? `${m.score[0]}–${m.score[1]}` : "—"}
                </span>
                <span className={`${COL.k} hidden shrink-0 text-right font-semibold tabular-nums text-ink md:inline`}>
                  {hasKD ? kills : <span className="font-normal text-faint">—</span>}
                </span>
                <span className={`${COL.d} hidden shrink-0 text-right tabular-nums text-muted md:inline`}>
                  {hasKD ? deaths : <span className="text-faint">—</span>}
                </span>
                <span
                  className={`${COL.diff} hidden shrink-0 text-right tabular-nums md:inline ${
                    hasKD ? (kdDiff > 0 ? "text-good" : kdDiff < 0 ? "text-bad" : "text-faint") : "text-faint"
                  }`}
                >
                  {hasKD ? `${kdDiff > 0 ? "+" : kdDiff < 0 ? "−" : ""}${Math.abs(kdDiff)}` : "—"}
                </span>
                <span className={`${COL.hs} hidden shrink-0 text-right tabular-nums text-muted lg:inline`}>
                  {m.accuracy_head > 0 ? `${m.accuracy_head.toFixed(0)}%` : <span className="text-faint">—</span>}
                </span>
                <span
                  className={`${COL.rating} shrink-0 text-right tabular-nums ${impactColor(m.leetify_rating)}`}
                  title="Leetify rating for this game"
                >
                  {signed(m.leetify_rating)}
                </span>
                <span className={`${COL.delta} hidden shrink-0 sm:block`}>
                  <RankCell m={m} />
                </span>
                {/* colour-keyed wordmark: tiny dot + small caps, no box */}
                <span className={`${COL.queue} flex shrink-0 items-center gap-1.5`}>
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: src.hex, boxShadow: `0 0 6px ${src.hex}66` }}
                  />
                  <span
                    className="truncate text-[9px] font-bold uppercase tracking-[0.08em]"
                    style={{ color: src.hex }}
                  >
                    {src.label}
                  </span>
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-faint sm:gap-2">
                  {/* "1d" on phones, "1d ago" once there's room */}
                  <span className="sm:hidden">{timeAgo(m.finished_at).replace(" ago", "")}</span>
                  <span className="hidden sm:inline">{timeAgo(m.finished_at)}</span>
                  <svg
                    className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </span>
              </button>

              {isOpen && (
                <div className="border-t border-line/60 bg-linear-to-b from-panel/40 to-transparent px-3 py-3">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat
                      label="K-D"
                      value={
                        hasKD
                          ? `${m.kills}-${m.deaths}${(m.deaths ?? 0) > 0 ? ` (${((m.kills ?? 0) / (m.deaths ?? 1)).toFixed(2)})` : ""}`
                          : "—"
                      }
                    />
                    {after ? (
                      <Stat
                        label={after.label}
                        // before → after is the whole point: where the game
                        // started you and where it left you
                        value={
                          delta != null ? (
                            <span className="text-[13px]">
                              <span className="font-normal text-muted">
                                {(m.rank_before ?? 0).toLocaleString()}
                              </span>
                              <span className="mx-1 text-faint">→</span>
                              <span style={afterHex ? { color: afterHex } : undefined}>{after.value}</span>
                            </span>
                          ) : (
                            after.value
                          )
                        }
                        valueHex={delta == null ? afterHex : undefined}
                        sub={
                          delta != null ? (
                            <span className={`font-semibold ${deltaColor(delta)}`}>
                              {signedInt(delta)}
                            </span>
                          ) : after.ladder ? (
                            <span className="text-faint">change not recorded</span>
                          ) : null
                        }
                      />
                    ) : (
                      <Stat label="Queue" value={src.label} />
                    )}
                    <Stat label="Leetify rating" value={signed(m.leetify_rating)} />
                    <Stat label="HS accuracy" value={dash(m.accuracy_head, (v) => `${v.toFixed(1)}%`)} />
                    <Stat
                      label="Spotted accuracy"
                      value={dash(m.accuracy_enemy_spotted, (v) => `${v.toFixed(0)}%`)}
                    />
                    <Stat label="Spray" value={dash(m.spray_accuracy, (v) => `${v.toFixed(0)}%`)} />
                    <Stat label="Preaim" value={dash(m.preaim, (v) => `${v.toFixed(1)}°`)} />
                    <Stat
                      label="Reaction"
                      value={dash(m.reaction_time_ms, (v) => `${v.toFixed(0)} ms`)}
                    />
                  </div>
                  {m.id && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-3">
                      <AnalyzeDemoButton
                        gameId={m.id}
                        steamId={steamId}
                        dataSource={m.data_source}
                        finishedAt={m.finished_at}
                        mapName={m.map_name}
                        score={m.score}
                      />
                      <a
                        href={`https://leetify.com/app/match-details/${m.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-brand hover:underline"
                      >
                        View full match on Leetify ↗
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        </div>
      </div>
      <p className="mt-1.5 text-[10px] text-faint">
        Rank shows the Premier rating / FACEIT elo you carried into the game → what you left with,
        and the change. Badges carry the in-game tier colour, so a rating crossing a bracket
        changes colour too. Leetify doesn&apos;t record a rating on every game; those show a single
        badge or a dash rather than a change stretched across several games. K-D per game via
        Leetify.
      </p>
    </div>
  );
}
