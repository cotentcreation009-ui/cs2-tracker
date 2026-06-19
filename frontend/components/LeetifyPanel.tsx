import type { LeetifyProfile } from "@/lib/types";
import { tierColor } from "@/lib/format";

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

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-3 py-2">
      <div className="stat-label">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
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

      {/* ranks */}
      {(r.faceit != null || r.wingman != null) && (
        <div className="mt-3 flex flex-wrap gap-3 text-sm text-muted">
          {r.faceit != null && r.faceit > 0 && (
            <span>
              Faceit <span className="font-medium text-ink">lvl {r.faceit}</span>
              {r.faceit_elo ? ` · ${r.faceit_elo} ELO` : ""}
            </span>
          )}
          {r.wingman != null && r.wingman > 0 && (
            <span>
              Wingman{" "}
              <span className="font-medium text-ink">rank {r.wingman}</span>
            </span>
          )}
        </div>
      )}

      {/* skill ratings (0-100) */}
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Bar label="Aim" value={p.rating.aim} />
        <Bar label="Positioning" value={p.rating.positioning} />
        <Bar label="Utility" value={p.rating.utility} />
      </div>

      {/* micro-stats */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <Mini
          label="HS accuracy"
          value={`${p.stats.accuracy_head.toFixed(1)}%`}
        />
        <Mini
          label="Reaction"
          value={`${p.stats.reaction_time_ms.toFixed(0)} ms`}
        />
        <Mini label="Preaim" value={`${p.stats.preaim.toFixed(1)}°`} />
        <Mini
          label="Spray"
          value={`${p.stats.spray_accuracy.toFixed(0)}%`}
        />
        <Mini
          label="Opening CT"
          value={`${p.stats.ct_opening_duel_success_percentage.toFixed(0)}%`}
        />
        <Mini
          label="Opening T"
          value={`${p.stats.t_opening_duel_success_percentage.toFixed(0)}%`}
        />
        <Mini
          label="Trade success"
          value={`${p.stats.trade_kills_success_percentage.toFixed(0)}%`}
        />
      </div>
    </section>
  );
}
