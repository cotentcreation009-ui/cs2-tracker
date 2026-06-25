import type { SteamGameStats } from "@/lib/types";
import { fmt, mapLabel, tierColor } from "@/lib/format";

const WEAPON_LABELS: Record<string, string> = {
  ak47: "AK-47",
  m4a1: "M4A4",
  m4a1_silencer: "M4A1-S",
  awp: "AWP",
  deagle: "Desert Eagle",
  glock: "Glock-18",
  hkp2000: "P2000",
  usp_silencer: "USP-S",
  p250: "P250",
  fiveseven: "Five-SeveN",
  tec9: "Tec-9",
  cz75a: "CZ75-Auto",
  elite: "Dual Berettas",
  revolver: "R8 Revolver",
  galilar: "Galil AR",
  famas: "FAMAS",
  ssg08: "SSG 08",
  sg556: "SG 553",
  aug: "AUG",
  scar20: "SCAR-20",
  g3sg1: "G3SG1",
  mac10: "MAC-10",
  mp9: "MP9",
  mp7: "MP7",
  mp5sd: "MP5-SD",
  ump45: "UMP-45",
  p90: "P90",
  bizon: "PP-Bizon",
  nova: "Nova",
  xm1014: "XM1014",
  mag7: "MAG-7",
  sawedoff: "Sawed-Off",
  m249: "M249",
  negev: "Negev",
  knife: "Knife",
  hegrenade: "HE Grenade",
  taser: "Zeus x27",
};

function weaponLabel(w: string): string {
  return WEAPON_LABELS[w] ?? w.toUpperCase();
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

/**
 * SteamStatsPanel renders official lifetime CS2 (App 730) stats from the Steam
 * Web API: headline totals (K/D, HS%, accuracy, hours, win rate, MVPs) and a
 * per-weapon kills + accuracy table. Only present for public-profile accounts.
 */
export function SteamStatsPanel({ data }: { data: SteamGameStats }) {
  const s = data.stats;
  const n = (k: string) => s[k] ?? 0;

  const kills = n("total_kills");
  const deaths = n("total_deaths");
  const kd = deaths ? kills / deaths : kills;
  const hsPct = kills ? (n("total_kills_headshot") / kills) * 100 : 0;
  const fired = n("total_shots_fired");
  const accuracy = fired ? (n("total_shots_hit") / fired) * 100 : 0;
  const hours = n("total_time_played") / 3600;
  const rounds = n("total_rounds_played");
  const winPct = rounds ? (n("total_wins") / rounds) * 100 : 0;

  const weapons = Object.keys(s)
    .filter((k) => k.startsWith("total_kills_") && k !== "total_kills_headshot")
    .map((k) => {
      const w = k.slice("total_kills_".length);
      const shots = n(`total_shots_${w}`);
      const hits = n(`total_hits_${w}`);
      return { w, kills: s[k], acc: shots ? (hits / shots) * 100 : 0 };
    })
    .filter((x) => x.kills > 0)
    .sort((a, b) => b.kills - a.kills)
    .slice(0, 8);

  // Most-recent official match snapshot (last_match_* family).
  const lm = {
    kills: n("last_match_kills"),
    deaths: n("last_match_deaths"),
    mvps: n("last_match_mvps"),
    damage: n("last_match_damage"),
    money: n("last_match_money_spent"),
    rounds: n("last_match_rounds") || n("last_match_t_wins") + n("last_match_ct_wins"),
  };
  const lmKd = lm.deaths ? lm.kills / lm.deaths : lm.kills;
  const hasLastMatch = lm.kills > 0 || lm.deaths > 0 || lm.damage > 0;

  // Lifetime wins per map (total_wins_map_*).
  const perMapWins = Object.keys(s)
    .filter((k) => k.startsWith("total_wins_map_"))
    .map((k) => ({ map: k.slice("total_wins_map_".length), wins: s[k] }))
    .filter((m) => m.wins > 0)
    .sort((a, b) => b.wins - a.wins)
    .slice(0, 8);

  // Fun lifetime totals we already have but never showed.
  const extras = [
    { label: "Bombs planted", key: "total_planted_bombs" },
    { label: "Bombs defused", key: "total_defused_bombs" },
    { label: "Total MVPs", key: "total_mvps" },
    { label: "Dominations", key: "total_dominations" },
    { label: "Revenges", key: "total_revenges" },
    { label: "Knife kills", key: "total_kills_knife" },
    { label: "Blinded kills", key: "total_kills_enemy_blinded" },
    { label: "Hostages saved", key: "total_rescued_hostages" },
    { label: "Zoomed-AWP kills", key: "total_kills_against_zoomed_sniper" },
  ]
    .map((e) => ({ ...e, v: n(e.key) }))
    .filter((e) => e.v > 0);
  const moneyEarned = n("total_money_earned");

  if (kills === 0) return null;

  return (
    <section className="card-2 px-5 py-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded bg-ink/10 text-[11px] font-black text-ink">
          S
        </span>
        <h2 className="font-semibold">Steam · CS2 lifetime</h2>
        <span className="pill bg-panel text-faint">official Valve stats</span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        <Mini label="Kills" value={fmt(kills)} />
        <Mini
          label="K/D"
          value={kd.toFixed(2)}
          valueClass={tierColor(kd, 1.1, 0.95)}
        />
        <Mini
          label="Headshot %"
          value={`${hsPct.toFixed(0)}%`}
          valueClass={tierColor(hsPct, 50, 40)}
        />
        <Mini
          label="Accuracy"
          value={`${accuracy.toFixed(1)}%`}
          valueClass={tierColor(accuracy, 20, 14)}
        />
        <Mini label="Hours" value={fmt(Math.round(hours))} />
        <Mini
          label="Win rate"
          value={`${winPct.toFixed(0)}%`}
          valueClass={tierColor(winPct, 52, 47)}
        />
      </div>

      {weapons.length > 0 && (
        <div className="mt-4">
          <div className="stat-label mb-2">Top weapons (kills · accuracy)</div>
          <div className="card overflow-hidden">
            <div className="grid grid-cols-[1.4fr_0.8fr_0.8fr] gap-2 border-b border-line px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-faint">
              <span>Weapon</span>
              <span className="text-right">Kills</span>
              <span className="text-right">Accuracy</span>
            </div>
            <ul>
              {weapons.map((wp) => (
                <li
                  key={wp.w}
                  className="grid grid-cols-[1.4fr_0.8fr_0.8fr] items-center gap-2 border-t border-line/60 px-4 py-2 text-sm"
                >
                  <span className="truncate font-medium">
                    {weaponLabel(wp.w)}
                  </span>
                  <span className="text-right tabular-nums text-muted">
                    {fmt(wp.kills)}
                  </span>
                  <span
                    className={`text-right tabular-nums ${tierColor(wp.acc, 22, 15)}`}
                  >
                    {wp.acc.toFixed(1)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {hasLastMatch && (
        <div className="mt-4">
          <div className="stat-label mb-2">Last official match</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Mini label="Kills" value={fmt(lm.kills)} />
            <Mini label="Deaths" value={fmt(lm.deaths)} />
            <Mini
              label="K/D"
              value={lmKd.toFixed(2)}
              valueClass={tierColor(lmKd, 1.1, 0.95)}
            />
            <Mini label="MVPs" value={fmt(lm.mvps)} />
            <Mini label="Damage" value={fmt(lm.damage)} />
            {lm.money > 0 && (
              <Mini label="Money spent" value={`$${fmt(lm.money)}`} />
            )}
          </div>
        </div>
      )}

      {perMapWins.length > 0 && (
        <div className="mt-4">
          <div className="stat-label mb-2">Map wins (lifetime)</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {perMapWins.map((m) => (
              <Mini key={m.map} label={mapLabel(m.map)} value={fmt(m.wins)} />
            ))}
          </div>
        </div>
      )}

      {(extras.length > 0 || moneyEarned > 0) && (
        <div className="mt-4">
          <div className="stat-label mb-2">Lifetime extras</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {extras.map((e) => (
              <Mini key={e.key} label={e.label} value={fmt(e.v)} />
            ))}
            {moneyEarned > 0 && (
              <Mini label="Money earned" value={`$${fmt(moneyEarned)}`} />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
