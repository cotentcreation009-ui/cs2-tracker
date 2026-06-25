import type { FaceitProfile } from "@/lib/types";
import { tierColor } from "@/lib/format";

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

/**
 * FaceitPanel renders a player's live FACEIT profile (CS2 skill level, elo and
 * lifetime stats). Fetched in real time and shown with attribution + a link
 * back to the player's FACEIT page.
 */
export function FaceitPanel({ profile: p }: { profile: FaceitProfile }) {
  const recent = (p.recentResults || []).slice(0, 20);
  return (
    <section className="card-2 px-5 py-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded bg-[#ff5500]/20 text-[11px] font-black text-[#ff5500]">
            F
          </span>
          <h2 className="font-semibold">FACEIT</h2>
          {p.skillLevel > 0 && (
            <span className="pill bg-[#ff5500]/15 text-[#ff5500]">
              Level {p.skillLevel}
            </span>
          )}
          {p.region && (
            <span className="pill bg-panel text-muted">{p.region}</span>
          )}
        </div>
        {p.faceitUrl && (
          <a
            href={p.faceitUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted transition-colors hover:text-brand"
            title="Data provided by FACEIT"
          >
            Data provided by FACEIT · View on FACEIT ↗
          </a>
        )}
      </div>

      {/* headline */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Mini label="Skill level" value={p.skillLevel ? String(p.skillLevel) : "—"} />
        <Mini label="ELO" value={p.elo ? p.elo.toLocaleString("en-US") : "—"} />
        <Mini label="Matches" value={p.matches.toLocaleString("en-US")} />
        <Mini
          label="Win rate"
          value={`${p.winRatePct.toFixed(0)}%`}
          valueClass={tierColor(p.winRatePct, 55, 45)}
        />
      </div>

      {/* lifetime stats */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Mini
          label="K/D"
          value={p.kdRatio.toFixed(2)}
          valueClass={tierColor(p.kdRatio, 1.1, 0.95)}
        />
        <Mini
          label="Headshot %"
          value={`${p.hsPct.toFixed(0)}%`}
          valueClass={tierColor(p.hsPct, 50, 40)}
        />
        <Mini label="Avg kills" value={p.avgKills.toFixed(1)} />
        <Mini label="Win streak" value={String(p.currentWinStreak)} />
        <Mini label="Best streak" value={String(p.longestWinStreak)} />
      </div>

      {/* recent results */}
      {recent.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="stat-label">Recent {recent.length}</span>
          <div className="flex flex-wrap gap-1">
            {recent.map((r, i) => (
              <span
                key={i}
                className={`grid h-5 w-5 place-items-center rounded text-[11px] font-bold ${
                  r === "1" ? "bg-good/20 text-good" : "bg-bad/20 text-bad"
                }`}
                title={r === "1" ? "Win" : "Loss"}
              >
                {r === "1" ? "W" : "L"}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
