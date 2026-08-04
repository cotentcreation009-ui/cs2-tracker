"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { LeetifyRecentMatch } from "@/lib/types";
import { mapLabel, premierHex, timeAgo } from "@/lib/format";
import { radarImage } from "@/lib/maps/calibration";
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

// The Premier rating plate drawn like the in-game asset: two angled wing
// slashes, then the sheared plate carrying the number — geometry traced from
// the game's own premier_rating_bg.svg (178×64 with a 12°-ish shear), tinted
// with the tier colour of the rating it holds.
function PremierPlate({
  value,
  hex,
  dim = false,
  title,
}: {
  value: number;
  hex: string;
  dim?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`relative inline-block h-4.5 w-18 shrink-0 ${dim ? "opacity-60" : ""}`}
    >
      <svg viewBox="0 0 178 64" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
        {/* wings */}
        <path d="M12 0h9L9 64H0L12 0Z" fill={hex} />
        <path d="M27 0h7L22 64h-7L27 0Z" fill={hex} opacity="0.45" />
        {/* plate */}
        <path d="M40 0h138l-12 64H28L40 0Z" fill={hex} opacity="0.13" />
        <path d="M40.9 1h136.3l-11.6 62H29.1L40.9 1Z" fill="none" stroke={hex} strokeOpacity="0.5" strokeWidth="2.4" />
      </svg>
      {/* number band pinned to the PLATE polygon (x≈40→172 of 178), so the
          value always sits inside the plate — never on the wings or past the
          sheared right edge */}
      <span
        className="absolute inset-y-0 left-[22%] right-[6%] z-10 flex items-center justify-center text-[10px] font-extrabold italic leading-none tabular-nums"
        style={{ color: hex }}
      >
        {value.toLocaleString()}
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

  // the change rides above a small arrow, like the in-game match history
  const deltaArrow =
    delta != null ? (
      <span className="flex w-8 shrink-0 flex-col items-center gap-px leading-none">
        <span className={`text-[9px] font-bold tabular-nums ${deltaColor(delta)}`}>{signedInt(delta)}</span>
        <svg viewBox="0 0 16 6" className="h-1.5 w-4 text-faint" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
          <path d="M1 3h13m0 0-2.4-2M14 3l-2.4 2" />
        </svg>
      </span>
    ) : null;

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
            {isPremier ? (
              <PremierPlate value={before} hex={hexOf(before)} dim />
            ) : (
              <RatingBadge text={before.toLocaleString()} hex={hexOf(before)} dim />
            )}
            {deltaArrow}
          </>
        ) : null}
        {isPremier ? (
          <PremierPlate value={after} hex={hexOf(after)} />
        ) : (
          <RatingBadge text={after.toLocaleString()} hex={hexOf(after)} />
        )}
      </span>
    );
  }

  // no ladder number for this game: FACEIT level, a Competitive skill group,
  // or a queue with no rating at all
  const level = isFaceit ? (m.rank ?? 0) : 0;
  const comp = m.rank_type === 12 && (m.rank ?? 0) >= 1 && (m.rank ?? 0) <= 18 ? (m.rank ?? 0) : 0;
  const compBefore = m.rank_type === 12 && before >= 1 && before <= 18 ? before : 0;
  return (
    <span className="flex items-center justify-end gap-1">
      {level > 0 ? (
        <RatingBadge text={`Lvl ${level}`} hex={FACEIT_HEX} title="FACEIT level" />
      ) : comp > 0 ? (
        // rank moved → before badge, change over the arrow, after badge —
        // the same format as Premier/FACEIT; unchanged ranks keep one badge
        delta != null && delta !== 0 && compBefore > 0 ? (
          <>
            <CompRankBadge rank={compBefore} className="h-6 w-auto opacity-60" />
            {deltaArrow}
            <CompRankBadge rank={comp} className="h-6 w-auto" />
          </>
        ) : (
          <CompRankBadge rank={comp} className="h-6 w-auto" />
        )
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

// The actual in-game Competitive skill-group badge (Silver 1 → Global Elite),
// falling back to the abbreviation plate if the asset is missing.
function CompRankBadge({ rank, className = "" }: { rank: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (rank < 1 || rank > 18) return null;
  if (broken) return <RatingBadge text={COMP_SHORT[rank - 1]} hex="#38d6ff" title={COMP_RANKS[rank - 1]} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/ranks/comp/${rank}.svg`}
      alt={COMP_RANKS[rank - 1]}
      title={COMP_RANKS[rank - 1]}
      loading="lazy"
      draggable={false}
      onError={() => setBroken(true)}
      className={`shrink-0 ${className}`}
    />
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

// Real map icon (same logo → radar → monogram fallback chain as the stats
// page) so the map column matches the rest of the site.
function MapBadge({ map }: { map: string }) {
  const [stage, setStage] = useState(0); // 0 = logo, 1 = radar, 2 = monogram
  const name = mapLabel(map);
  if (stage >= 2) {
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
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={stage === 0 ? radarImage(map).replace(/radar\.png$/, "logo.png") : radarImage(map)}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setStage((s) => s + 1)}
      className={`h-5 w-5 shrink-0 rounded-md border border-line/50 bg-panel2/70 ${stage === 0 ? "object-contain p-px" : "object-cover"}`}
    />
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
  // fits "27,853 → 27,974" as two slanted plates with the change over the
  // arrow, plus left padding so the wings never crowd the Leetify column
  delta: "sm:w-45 sm:pl-2.5",
  // fits the longest wordmark ("WINGMAN") with its dot at both breakpoints
  queue: "w-16 sm:w-21",
};

// One player's deep line for one game (ADR / KAST / HLTV-style rating /
// assists / MVPs / multi-kills), fetched from Leetify's per-game scoreboard
// the first time a row expands — the profile feed simply doesn't carry these.
interface ScoreRow {
  name: string;
  steam_id?: string;
  kills: number;
  deaths: number;
  assists: number;
  adr: number;
  rating: number;
  hs_pct: number;
  me?: boolean;
}

interface GameDeep {
  found?: boolean;
  adr?: number;
  kast_pct?: number;
  rating?: number;
  assists?: number;
  mvps?: number;
  multi_2k?: number;
  multi_3k?: number;
  multi_4k?: number;
  multi_5k?: number;
  scoreboard?: { score: number; players: ScoreRow[] }[];
}

const deepCache = new Map<string, GameDeep | null>();
const deepInflight = new Map<string, Promise<GameDeep | null>>();

function useGameDeep(steamId: string, gameId?: string): GameDeep | null | undefined {
  const k = gameId ?? "";
  const [deep, setDeep] = useState<GameDeep | null | undefined>(
    k && deepCache.has(k) ? deepCache.get(k) : undefined,
  );
  useEffect(() => {
    if (!k) {
      setDeep(null);
      return;
    }
    if (deepCache.has(k)) {
      setDeep(deepCache.get(k));
      return;
    }
    let alive = true;
    let p = deepInflight.get(k);
    if (!p) {
      p = fetch(`/api/profiles/${encodeURIComponent(steamId)}/leetify-game/${encodeURIComponent(k)}`)
        .then((r) => (r.ok ? (r.json() as Promise<GameDeep>) : null))
        .then((d) => {
          const v = d && d.found ? d : null;
          deepCache.set(k, v);
          deepInflight.delete(k);
          return v;
        })
        .catch(() => {
          deepInflight.delete(k);
          return null;
        });
      deepInflight.set(k, p);
    }
    p.then((v) => {
      if (alive) setDeep(v);
    });
    return () => {
      alive = false;
    };
  }, [k, steamId]);
  return deep;
}

// The full 10-player board for the expanded game: viewer's team first with a
// W/L chip and outcome-tinted header, players sorted by rating, the match's
// top player starred, an ADR bar under each damage number, and every name
// linking to its own StatRun profile.
function MiniScoreboard({ deep, won, tie }: { deep: GameDeep; won: boolean; tie: boolean }) {
  const teams = deep.scoreboard ?? [];
  if (teams.length !== 2) return null;
  const ratingCls = (v: number) => (v >= 1.1 ? "text-good" : v < 0.9 ? "text-bad" : "text-ink");
  const all = teams.flatMap((t) => t.players);
  const maxAdr = Math.max(1, ...all.map((p) => p.adr));
  const best = all.reduce((a, b) => (b.rating > a.rating ? b : a), all[0]);
  return (
    <div className="mt-2.5 grid gap-2 lg:grid-cols-2">
      {teams.map((t, ti) => {
        const teamWon = !tie && (ti === 0) === won;
        const outcome = tie ? "T" : teamWon ? "W" : "L";
        const outCls = tie ? "bg-mid/20 text-mid" : teamWon ? "bg-good/20 text-good" : "bg-bad/20 text-bad";
        const hair = tie ? "#e7b53c" : teamWon ? "var(--color-good)" : "var(--color-bad)";
        return (
          <div key={ti} className="relative overflow-hidden rounded-lg border border-line/60 bg-panel2/20">
            {/* outcome hairline */}
            <span aria-hidden className="absolute inset-x-0 top-0 h-px opacity-70" style={{ backgroundImage: `linear-gradient(90deg, ${hair}, transparent 70%)` }} />
            <div className="flex items-center justify-between border-b border-line/60 bg-panel/40 px-2.5 py-1.5">
              <span className="flex items-center gap-1.5">
                <span className={`grid h-4 w-4 place-items-center rounded text-[9px] font-bold ${outCls}`}>{outcome}</span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  {ti === 0 ? "Your team" : "Opponents"}
                </span>
              </span>
              <span
                className={`text-sm font-extrabold tabular-nums ${
                  tie ? "text-mid" : teamWon ? "text-good" : "text-bad"
                }`}
              >
                {t.score}
              </span>
            </div>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-[8px] uppercase tracking-wider text-faint">
                  <th className="px-2.5 py-1 text-left font-semibold">Player</th>
                  <th className="w-7 py-1 text-right font-semibold" title="Kills">K</th>
                  <th className="w-7 py-1 text-right font-semibold" title="Deaths">D</th>
                  <th className="w-7 py-1 text-right font-semibold" title="Assists">A</th>
                  <th className="w-10 py-1 text-right font-semibold" title="Average damage per round">ADR</th>
                  <th className="hidden w-9 py-1 text-right font-semibold sm:table-cell" title="Headshot %">HS%</th>
                  <th className="w-10 py-1 pr-2.5 text-right font-semibold" title="HLTV-style rating (via Leetify)">RTG</th>
                </tr>
              </thead>
              <tbody>
                {t.players.map((p, pi) => (
                  <tr
                    key={pi}
                    className={`group/srow border-t border-line/30 transition-colors hover:bg-panel/40 ${p.me ? "bg-brand/10" : ""}`}
                  >
                    <td className="relative max-w-0 truncate px-2.5 py-1.5">
                      {p.me ? <span aria-hidden className="absolute inset-y-0.5 left-0 w-0.5 rounded-r-full bg-brand/80" /> : null}
                      {p === best ? (
                        <span className="mr-1 text-[9px] text-mid" title="Match MVP — highest rating in the game">★</span>
                      ) : null}
                      {p.steam_id ? (
                        <a
                          href={`/profiles/${p.steam_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className={`hover:underline ${p.me ? "font-bold text-ink" : "font-medium text-muted group-hover/srow:text-ink"}`}
                          title={`${p.name} — open their StatRun profile`}
                        >
                          {p.name || "—"}
                        </a>
                      ) : (
                        <span className={p.me ? "font-bold text-ink" : "font-medium text-muted"}>{p.name || "—"}</span>
                      )}
                      {p.me ? <span className="ml-1 rounded bg-brand/20 px-1 text-[8px] font-bold uppercase text-brand">you</span> : null}
                    </td>
                    <td className="py-1.5 text-right font-semibold tabular-nums text-ink">{p.kills}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted">{p.deaths}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted">{p.assists}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted">
                      {p.adr.toFixed(0)}
                      <span className="mt-0.5 block h-0.5 w-full overflow-hidden rounded-full bg-line/30" aria-hidden>
                        <span className="block h-full rounded-full bg-brand/50" style={{ width: `${Math.max(4, Math.round((p.adr / maxAdr) * 100))}%` }} />
                      </span>
                    </td>
                    <td className="hidden py-1.5 text-right tabular-nums text-muted sm:table-cell">
                      {p.hs_pct > 0 ? `${p.hs_pct.toFixed(0)}%` : "—"}
                    </td>
                    <td className={`py-1.5 pr-2.5 text-right font-semibold tabular-nums ${ratingCls(p.rating)}`}>
                      {p.rating.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

// The extra tiles the deep fetch unlocks. `undefined` deep = still loading →
// pulse placeholders so the grid doesn't jump when they land.
function DeepStatTiles({ deep }: { deep: GameDeep | null | undefined }) {
  if (deep === undefined) {
    return (
      <>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-13 animate-pulse rounded-md border border-line/40 bg-panel/40" aria-hidden />
        ))}
      </>
    );
  }
  if (deep === null) return null;
  const multis = [
    deep.multi_2k ? `${deep.multi_2k}×2K` : "",
    deep.multi_3k ? `${deep.multi_3k}×3K` : "",
    deep.multi_4k ? `${deep.multi_4k}×4K` : "",
    deep.multi_5k ? `${deep.multi_5k}×ACE` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <Stat label="Rating" value={(deep.rating ?? 0).toFixed(2)} valueHex={(deep.rating ?? 0) >= 1.1 ? "var(--color-good)" : (deep.rating ?? 0) < 0.9 ? "var(--color-bad)" : undefined} />
      <Stat label="ADR" value={(deep.adr ?? 0).toFixed(0)} />
      <Stat label="KAST" value={`${(deep.kast_pct ?? 0).toFixed(0)}%`} />
      <Stat label="Assists" value={String(deep.assists ?? 0)} />
      <Stat label="MVPs" value={`★ ${deep.mvps ?? 0}`} />
      {multis ? <Stat label="Multi-kills" value={multis} /> : null}
    </>
  );
}

// Mounted only while a row is expanded, so the deep fetch happens exactly when
// the panel is first opened (then never again, thanks to the module cache).
function DeepStats({ steamId, gameId }: { steamId: string; gameId?: string }) {
  const deep = useGameDeep(steamId, gameId);
  return <DeepStatTiles deep={deep} />;
}

// Same shared fetch, rendered below the tiles: the full game scoreboard.
function DeepScoreboard({
  steamId,
  gameId,
  won,
  tie,
}: {
  steamId: string;
  gameId?: string;
  won: boolean;
  tie: boolean;
}) {
  const deep = useGameDeep(steamId, gameId);
  if (!deep) return null;
  return <MiniScoreboard deep={deep} won={won} tie={tie} />;
}

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
// Queue bucket for filtering — mirrors sourceInfo's classification.
function queueOf(m: LeetifyRecentMatch): "premier" | "faceit" | "comp" | "other" {
  if (m.rank_type === 11) return "premier";
  if (m.data_source === "faceit") return "faceit";
  if (m.rank_type === 12) return "comp";
  return "other";
}

const LIMIT_OPTIONS = [20, 50, 100, 150, 0]; // 0 = all

export function LeetifyRecentMatches({
  matches,
  steamId,
}: {
  matches: LeetifyRecentMatch[];
  steamId: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [queue, setQueue] = useState<"all" | "premier" | "faceit" | "comp" | "other">("all");
  const [limit, setLimit] = useState(0);
  if (matches.length === 0) return null;

  // queue filter first, then the count window — "last 50 Premier games"
  const byQueue = queue === "all" ? matches : matches.filter((m) => queueOf(m) === queue);
  const filtered = limit > 0 ? byQueue.slice(0, limit) : byQueue;

  const counts: Record<string, number> = { all: matches.length, premier: 0, faceit: 0, comp: 0, other: 0 };
  for (const m of matches) counts[queueOf(m)]++;
  const QUEUE_TABS: { key: typeof queue; label: string; hex?: string }[] = [
    { key: "all", label: "All" },
    { key: "premier", label: "Premier", hex: "#b8a5ff" },
    { key: "faceit", label: "FACEIT", hex: FACEIT_HEX },
    { key: "comp", label: "Comp", hex: "#38d6ff" },
    { key: "other", label: "Other" },
  ];

  return (
    <div className="mt-5">
      <div className="stat-label mb-2">Recent matches (Leetify)</div>
      <div className="overflow-hidden rounded-xl border border-line bg-panel2/20">
        {/* filters: which queue, and how far back */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-panel/20 px-3 py-2">
          <div className="flex flex-wrap items-center gap-1">
            {QUEUE_TABS.filter((t) => t.key === "all" || counts[t.key] > 0).map((t) => {
              const active = queue === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setQueue(t.key)}
                  aria-pressed={active}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                    active ? "bg-panel2 text-ink" : "text-muted hover:bg-panel/60 hover:text-ink"
                  }`}
                  style={active && t.hex ? { color: t.hex, boxShadow: `inset 0 0 0 1px ${t.hex}55` } : undefined}
                >
                  {t.label}
                  <span className={`ml-1 tabular-nums ${active ? "opacity-70" : "text-faint"}`}>{counts[t.key]}</span>
                </button>
              );
            })}
          </div>
          <div className="ml-auto flex items-center gap-1" title="How many of the most recent games to show">
            <span className="mr-0.5 text-[9px] font-semibold uppercase tracking-wider text-faint">Last</span>
            {LIMIT_OPTIONS.filter((n) => n === 0 || n < byQueue.length).map((n) => {
              const active = limit === n;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setLimit(n)}
                  aria-pressed={active}
                  className={`rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums transition ${
                    active ? "bg-panel2 text-ink" : "text-muted hover:bg-panel/60 hover:text-ink"
                  }`}
                >
                  {n === 0 ? "All" : n}
                </button>
              );
            })}
          </div>
        </div>
        <WindowSummary matches={filtered} />
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
        {filtered.map((m, i) => {
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
                  <MapBadge map={m.map_name} />
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
                    <DeepStats steamId={steamId} gameId={m.id} />
                    {after ? (
                      <Stat
                        label={after.label}
                        // before → after is the whole point: where the game
                        // started you and where it left you
                        value={
                          m.rank_type === 12 ? (
                            // the in-game badges; both when the rank moved
                            <span className="flex items-center gap-1.5">
                              {delta != null && delta !== 0 && (m.rank_before ?? 0) >= 1 ? (
                                <>
                                  <CompRankBadge rank={m.rank_before ?? 0} className="h-5 w-auto opacity-60" />
                                  <span className="text-xs text-faint">→</span>
                                </>
                              ) : null}
                              <CompRankBadge rank={m.rank ?? 0} className="h-6 w-auto" />
                              <span className="truncate text-xs">{after.value}</span>
                            </span>
                          ) : delta != null ? (
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
                          m.rank_type === 12 ? (
                            delta != null && delta !== 0 && (m.rank_before ?? 0) >= 1 ? (
                              <span className={`font-semibold ${deltaColor(delta)}`}>
                                ranked {delta > 0 ? "up" : "down"} from {COMP_RANKS[(m.rank_before ?? 1) - 1]}
                              </span>
                            ) : null
                          ) : delta != null ? (
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
                  <DeepScoreboard steamId={steamId} gameId={m.id} won={won} tie={tie} />
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
