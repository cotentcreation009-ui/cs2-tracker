import type { LeetifyProfile } from "@/lib/types";
import { LeetifyRecentMatches } from "@/components/LeetifyRecentMatches";
import { RatingRadar } from "@/components/RatingRadar";
import { premierHex, tierColor } from "@/lib/format";

function Bar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(value, 100));
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-medium tabular-nums">{value.toFixed(0)}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand to-brand2"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Mini({
  label,
  value,
  valueClass = "",
  valueHex,
}: {
  label: string;
  value: string;
  valueClass?: string;
  valueHex?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-panel px-3 py-2">
      <div className="stat-label">{label}</div>
      <div
        className={`mt-0.5 text-sm font-semibold tabular-nums ${valueClass}`}
        style={valueHex ? { color: valueHex } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

// Leetify's clutch/opening/side ratings are small impact values centred near 0
// (positive = above average), so render them signed rather than as 0-100 bars.
function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
}
const impactColor = (n: number) =>
  n > 0.03 ? "text-good" : n < -0.03 ? "text-bad" : "text-mid";

// lowerColor: for metrics where a smaller value is better (preaim, reaction,
// utility wasted on death).
const lowerColor = (v: number, good: number, mid: number) =>
  v <= good ? "text-good" : v <= mid ? "text-mid" : "text-bad";

// Leetify redacts detailed mechanics for friends-only profiles, so they arrive
// as 0. For these percent/ms/degree/damage metrics a 0 means "no data" (a real
// player is never exactly 0), so render a dash instead of a misleading "0.0%".
function stat(
  v: number,
  fmt: (n: number) => string,
  cls: (n: number) => string,
): { value: string; valueClass: string } {
  return v > 0
    ? { value: fmt(v), valueClass: cls(v) }
    : { value: "—", valueClass: "text-faint" };
}

// The pools Leetify's app routes summarise a non-member by (types.ts `source`),
// in the words a visitor would use. "5v5" is not a platform: it is every
// five-a-side game across Premier, Competitive and FACEIT together.
const POOL_LABEL: Record<string, string> = {
  "5v5": "5v5",
  matchmaking: "matchmaking",
  matchmaking_competitive: "Competitive",
  matchmaking_wingman: "Wingman",
  "2v2": "2v2",
};

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <div className="stat-label mb-2">{title}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {children}
      </div>
    </div>
  );
}

/**
 * LeetifyPanel renders a player's live Leetify profile. Per Leetify's developer
 * guidelines, the data is fetched in real time, shown as provided, and carries
 * "Data provided by Leetify" attribution with a link back to Leetify.
 */
export function LeetifyPanel({ profile: p }: { profile: LeetifyProfile }) {
  const r = p.ranks || {};
  const s = p.stats;
  const recent = (p.recent_matches || []).slice(0, 10);
  const firstYear = p.first_match_date
    ? new Date(p.first_match_date).getFullYear()
    : null;
  // recent-form win rate (the second win-rate number, e.g. "63% / 77%")
  const recentPool = (p.recent_matches || []).slice(0, 30);
  const recentWr =
    recentPool.length >= 5
      ? Math.round(
          (recentPool.filter((m) => m.outcome === "win").length / recentPool.length) * 100,
        )
      : null;
  const kdTone = (v: number) =>
    v >= 1.1 ? "text-good" : v < 0.9 ? "text-bad" : "";
  const banCount = p.bans?.length ?? 0;
  // A friends-only Leetify profile: ratings show, but the detailed aim/util/
  // trading micro-stats are redacted to 0 (and the CheatMeter, which needs the
  // hidden aim/reaction data, can't be scored).
  const statsHidden =
    p.total_matches > 0 &&
    s.accuracy_head === 0 &&
    s.preaim === 0 &&
    s.reaction_time_ms === 0;
  // A profile from Leetify's app routes (types.ts `source`): the public API
  // had none, so this is the summary of the player's last total_matches games
  // in one pool. Positioning, clutch and opening are not in it, and neither
  // are ranks or a match list — those cells must not render as zeros, because
  // "Positioning 0" and "Clutch +0.00" read as measurements.
  const appPool = p.source?.startsWith("app:") ? p.source.slice(4) : null;
  const partial = appPool !== null;
  const poolLabel = appPool ? (POOL_LABEL[appPool] ?? appPool) : "";
  // The app's match history rides along when the relay knows the route; the
  // note must not claim "no match list" under a list that is right there.
  const hasList = (p.recent_matches?.length ?? 0) > 0;

  return (
    <section className="card-2 px-5 py-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded bg-brand/20 text-[11px] font-black text-brand">
            L
          </span>
          <h2 className="font-semibold">Leetify</h2>
          {p.privacy_mode && p.privacy_mode !== "public" && (
            <span className="pill bg-mid/15 text-mid">{p.privacy_mode}</span>
          )}
          {partial && (
            <span
              className="pill bg-mid/15 text-mid"
              title={`Not a Leetify member — Leetify's summary of their last ${p.total_matches} ${poolLabel} games`}
            >
              recent games only
            </span>
          )}
          {banCount > 0 ? (
            <span className="pill bg-bad/15 text-bad">
              {banCount} ban{banCount > 1 ? "s" : ""}
            </span>
          ) : (
            <span className="pill bg-good/15 text-good">No bans</span>
          )}
        </div>
        <a
          href={`https://leetify.com/app/profile/${p.steam64_id}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted transition-colors hover:text-brand"
          title="Data provided by Leetify"
        >
          Data provided by Leetify · View on Leetify ↗
        </a>
      </div>

      {/* headline */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {r.leetify != null && (
          <Mini label="Leetify rating" value={r.leetify.toFixed(2)} />
        )}
        {p.kd != null && p.kd > 0 && (
          <Mini label="K/D" value={p.kd.toFixed(2)} valueClass={kdTone(p.kd)} />
        )}
        <Mini
          label={partial ? "Games in window" : "Matches"}
          value={p.total_matches.toLocaleString("en-US")}
        />
        <Mini label="Win rate" value={`${(p.winrate * 100).toFixed(1)}%`} />
        {r.premier != null && r.premier > 0 && (
          <Mini label="Premier" value={r.premier.toLocaleString("en-US")} valueHex={premierHex(r.premier)} />
        )}
        {p.peak_premier != null && p.peak_premier > (r.premier ?? 0) && (
          <Mini label="Peak Premier" value={p.peak_premier.toLocaleString("en-US")} valueHex={premierHex(p.peak_premier)} />
        )}
      </div>

      {/* ranks + tracking-since */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        {r.faceit != null && r.faceit > 0 && (
          <span>
            Faceit <span className="font-medium text-ink">lvl {r.faceit}</span>
            {r.faceit_elo ? ` · ${r.faceit_elo} ELO` : ""}
          </span>
        )}
        {r.wingman != null && r.wingman > 0 && (
          <span>
            Wingman <span className="font-medium text-ink">rank {r.wingman}</span>
          </span>
        )}
        {firstYear && (
          <span>
            Tracked since <span className="font-medium text-ink">{firstYear}</span>
          </span>
        )}
        {p.avg_party_size != null && p.avg_party_size > 0 && (
          <span>
            Avg party{" "}
            <span className="font-medium text-ink">{p.avg_party_size.toFixed(1)}</span>
          </span>
        )}
        {recentWr != null && (
          <span>
            Recent form <span className="font-medium text-ink">{recentWr}% W</span>{" "}
            <span className="text-faint">(last {recentPool.length})</span>
          </span>
        )}
      </div>

      {statsHidden && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-mid/25 bg-mid/[0.06] px-3 py-2.5 text-xs leading-relaxed text-muted">
          <span className="mt-px shrink-0 font-bold text-mid">ⓘ</span>
          <span>
            <span className="font-semibold text-mid">Detailed stats are hidden.</span>{" "}
            This player&apos;s Leetify profile is friends-only, so Leetify withholds
            their aim/mechanics, utility and trading detail (shown as &ldquo;—&rdquo;).
            Skill ratings, ranks and results are still available. The CheatMeter also
            needs that hidden aim/reaction data, so it can&apos;t be scored for this
            account.
          </span>
        </div>
      )}

      {partial && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-mid/25 bg-mid/[0.06] px-3 py-2.5 text-xs leading-relaxed text-muted">
          <span className="mt-px shrink-0 font-bold text-mid">ⓘ</span>
          <span>
            <span className="font-semibold text-mid">Not a Leetify member.</span>{" "}
            This player never signed up for Leetify, so its public API has no
            profile for them. Shown instead is Leetify&apos;s summary of their last{" "}
            {p.total_matches} {poolLabel} games: ratings and mechanics
            {hasList ? " and the games themselves (without dates)" : ""}, but no ranks
            or positioning / clutch / opening ratings{hasList ? "" : ", and no match list"}.
          </span>
        </div>
      )}

      {/* skill profile radar + the precise 0-100 bars. An app-sourced profile
          has no positioning, clutch or opening, so no radar: three of its five
          axes would be invented. */}
      {partial ? (
        <div className="mt-5 grid gap-3">
          <Bar label="Aim" value={p.rating.aim} />
          <Bar label="Utility" value={p.rating.utility} />
        </div>
      ) : (
        <div className="mt-5 grid items-center gap-4 sm:grid-cols-[240px_1fr]">
          <RatingRadar rating={p.rating} />
          <div className="grid gap-3">
            <Bar label="Aim" value={p.rating.aim} />
            <Bar label="Positioning" value={p.rating.positioning} />
            <Bar label="Utility" value={p.rating.utility} />
          </div>
        </div>
      )}

      {/* impact ratings (centred near 0) */}
      <Group title="Leetify impact ratings">
        {!partial && (
          <>
            <Mini label="Clutch" value={signed(p.rating.clutch)} valueClass={impactColor(p.rating.clutch)} />
            <Mini label="Opening" value={signed(p.rating.opening)} valueClass={impactColor(p.rating.opening)} />
          </>
        )}
        <Mini label="CT rating" value={signed(p.rating.ct_leetify)} valueClass={impactColor(p.rating.ct_leetify)} />
        <Mini label="T rating" value={signed(p.rating.t_leetify)} valueClass={impactColor(p.rating.t_leetify)} />
      </Group>

      {/* aim & mechanics */}
      <Group title="Aim & mechanics">
        <Mini label="HS accuracy" {...stat(s.accuracy_head, (v) => `${v.toFixed(1)}%`, (v) => tierColor(v, 25, 18))} />
        <Mini label="Spotted accuracy" {...stat(s.accuracy_enemy_spotted, (v) => `${v.toFixed(0)}%`, (v) => tierColor(v, 45, 35))} />
        <Mini label="Counter-strafe" {...stat(s.counter_strafing_good_shots_ratio, (v) => `${v.toFixed(0)}%`, (v) => tierColor(v, 80, 60))} />
        <Mini label="Spray" {...stat(s.spray_accuracy, (v) => `${v.toFixed(0)}%`, (v) => tierColor(v, 45, 30))} />
        <Mini label="Preaim" {...stat(s.preaim, (v) => `${v.toFixed(1)}°`, (v) => lowerColor(v, 8, 11))} />
        <Mini label="Reaction" {...stat(s.reaction_time_ms, (v) => `${v.toFixed(0)} ms`, (v) => lowerColor(v, 550, 650))} />
      </Group>

      {/* utility */}
      <Group title="Utility">
        <Mini label="HE dmg / match" {...stat(s.he_foes_damage_avg, (v) => v.toFixed(1), (v) => tierColor(v, 6, 3))} />
        <Mini label="Blinded / flash" {...stat(s.flashbang_hit_foe_per_flashbang, (v) => v.toFixed(2), (v) => tierColor(v, 0.7, 0.4))} />
        <Mini label="Flashes → kill" {...stat(s.flashbang_leading_to_kill, (v) => `${v.toFixed(0)}%`, (v) => tierColor(v, 12, 7))} />
        <Mini label="Util lost / death" {...stat(s.utility_on_death_avg, (v) => `$${v.toFixed(0)}`, (v) => lowerColor(v, 250, 400))} />
      </Group>

      {/* opening & trading */}
      <Group title="Opening & trading">
        <Mini label="Opening CT" {...stat(s.ct_opening_duel_success_percentage, (v) => `${v.toFixed(0)}%`, (v) => tierColor(v, 55, 45))} />
        <Mini label="Opening T" {...stat(s.t_opening_duel_success_percentage, (v) => `${v.toFixed(0)}%`, (v) => tierColor(v, 55, 45))} />
        <Mini label="Trade success" {...stat(s.trade_kills_success_percentage, (v) => `${v.toFixed(0)}%`, (v) => tierColor(v, 50, 40))} />
        <Mini label="Traded on death" {...stat(s.traded_deaths_success_percentage, (v) => `${v.toFixed(0)}%`, (v) => tierColor(v, 50, 40))} />
        <Mini label="Trade chances / rd" {...stat(s.trade_kill_opportunities_per_round, (v) => v.toFixed(2), (v) => tierColor(v, 0.4, 0.25))} />
      </Group>

      {/* recent matches (Leetify) — click a row to inspect per-match stats */}
      <LeetifyRecentMatches matches={recent} steamId={p.steam64_id} />
    </section>
  );
}
