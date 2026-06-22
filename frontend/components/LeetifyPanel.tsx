import type { LeetifyProfile } from "@/lib/types";
import { mapLabel, tierColor, timeAgo } from "@/lib/format";

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
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-panel px-3 py-2">
      <div className="stat-label">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold tabular-nums ${valueClass}`}>
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

const sourceLabel: Record<string, string> = {
  matchmaking: "MM",
  premier: "Premier",
  faceit: "FACEIT",
  wingman: "Wingman",
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
  const banCount = p.bans?.length ?? 0;

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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {r.leetify != null && (
          <Mini label="Leetify rating" value={r.leetify.toFixed(2)} />
        )}
        <Mini label="Matches" value={p.total_matches.toLocaleString("en-US")} />
        <Mini label="Win rate" value={`${(p.winrate * 100).toFixed(1)}%`} />
        {r.premier != null && r.premier > 0 && (
          <Mini label="Premier" value={r.premier.toLocaleString("en-US")} />
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
      </div>

      {/* skill ratings (0-100) */}
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Bar label="Aim" value={p.rating.aim} />
        <Bar label="Positioning" value={p.rating.positioning} />
        <Bar label="Utility" value={p.rating.utility} />
      </div>

      {/* impact ratings (centred near 0) */}
      <Group title="Leetify impact ratings">
        <Mini label="Clutch" value={signed(p.rating.clutch)} valueClass={impactColor(p.rating.clutch)} />
        <Mini label="Opening" value={signed(p.rating.opening)} valueClass={impactColor(p.rating.opening)} />
        <Mini label="CT rating" value={signed(p.rating.ct_leetify)} valueClass={impactColor(p.rating.ct_leetify)} />
        <Mini label="T rating" value={signed(p.rating.t_leetify)} valueClass={impactColor(p.rating.t_leetify)} />
      </Group>

      {/* aim & mechanics */}
      <Group title="Aim & mechanics">
        <Mini label="HS accuracy" value={`${s.accuracy_head.toFixed(1)}%`} />
        <Mini label="Spotted accuracy" value={`${s.accuracy_enemy_spotted.toFixed(0)}%`} />
        <Mini label="Counter-strafe" value={`${s.counter_strafing_good_shots_ratio.toFixed(0)}%`} />
        <Mini label="Spray" value={`${s.spray_accuracy.toFixed(0)}%`} />
        <Mini label="Preaim" value={`${s.preaim.toFixed(1)}°`} />
        <Mini label="Reaction" value={`${s.reaction_time_ms.toFixed(0)} ms`} />
      </Group>

      {/* utility */}
      <Group title="Utility">
        <Mini label="HE dmg / match" value={s.he_foes_damage_avg.toFixed(1)} />
        <Mini label="Blinded / flash" value={s.flashbang_hit_foe_per_flashbang.toFixed(2)} />
        <Mini label="Flashes → kill" value={`${s.flashbang_leading_to_kill.toFixed(0)}%`} />
        <Mini label="Util lost / death" value={`$${s.utility_on_death_avg.toFixed(0)}`} />
      </Group>

      {/* opening & trading */}
      <Group title="Opening & trading">
        <Mini label="Opening CT" value={`${s.ct_opening_duel_success_percentage.toFixed(0)}%`} />
        <Mini label="Opening T" value={`${s.t_opening_duel_success_percentage.toFixed(0)}%`} />
        <Mini label="Trade success" value={`${s.trade_kills_success_percentage.toFixed(0)}%`} />
        <Mini label="Traded on death" value={`${s.traded_deaths_success_percentage.toFixed(0)}%`} />
        <Mini label="Trade chances / rd" value={s.trade_kill_opportunities_per_round.toFixed(2)} />
      </Group>

      {/* recent matches (Leetify) */}
      {recent.length > 0 && (
        <div className="mt-5">
          <div className="stat-label mb-2">Recent matches (Leetify)</div>
          <div className="overflow-hidden rounded-lg border border-line">
            {recent.map((m, i) => {
              const won = m.outcome === "win";
              const tie = m.outcome === "tie";
              return (
                <div
                  key={m.id || i}
                  className={`flex items-center gap-3 px-3 py-2 text-sm ${
                    i % 2 ? "bg-panel/40" : ""
                  }`}
                >
                  <span
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded text-[11px] font-bold ${
                      tie
                        ? "bg-mid/20 text-mid"
                        : won
                          ? "bg-good/20 text-good"
                          : "bg-bad/20 text-bad"
                    }`}
                  >
                    {tie ? "T" : won ? "W" : "L"}
                  </span>
                  <span className="w-20 shrink-0 font-medium">
                    {mapLabel(m.map_name)}
                  </span>
                  <span className="w-14 shrink-0 tabular-nums text-muted">
                    {m.score?.length === 2 ? `${m.score[0]}–${m.score[1]}` : ""}
                  </span>
                  <span
                    className={`w-12 shrink-0 tabular-nums ${impactColor(m.leetify_rating)}`}
                  >
                    {signed(m.leetify_rating)}
                  </span>
                  <span className="hidden shrink-0 text-xs text-faint sm:inline">
                    {sourceLabel[m.data_source] || m.data_source}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-faint">
                    {timeAgo(m.finished_at)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
