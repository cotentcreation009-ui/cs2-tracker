import type {
  FaceitProfile,
  LeetifyProfile,
  SteamGameStats,
} from "@/lib/types";
import { mapLabel } from "@/lib/format";
import { computeMapPlan } from "@/lib/mapplan";

type Tip = { title: string; tip: string };

const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
const impactText = (n: number) =>
  n > 0.03 ? "text-good" : n < -0.03 ? "text-bad" : "text-mid";
const pctColor = (p: number) =>
  p >= 55 ? "#46d369" : p >= 45 ? "#f5b942" : "#f5694a";

const WEAPONS: Record<string, string> = {
  ak47: "AK-47",
  m4a1: "M4A4",
  m4a1_silencer: "M4A1-S",
  awp: "AWP",
  deagle: "Deagle",
  ssg08: "Scout",
  aug: "AUG",
  sg556: "SG 553",
  galilar: "Galil",
  famas: "FAMAS",
  mp9: "MP9",
  mac10: "MAC-10",
  ump45: "UMP-45",
  p90: "P90",
};
const weaponLabel = (w: string) => WEAPONS[w] ?? w.toUpperCase();

function MapRow({
  map,
  pct,
  w,
  l,
  tag,
}: {
  map: string;
  pct: number;
  w: number;
  l: number;
  tag?: "main" | "small";
}) {
  return (
    <div
      className={`grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 ${tag === "small" ? "opacity-60" : ""}`}
    >
      <span className="flex min-w-0 items-center gap-1 text-sm font-medium capitalize">
        {tag === "main" && (
          <span title="their most-played map" className="shrink-0 text-brand">
            ★
          </span>
        )}
        <span className="truncate">{mapLabel(map)}</span>
      </span>
      <div className="relative h-2 overflow-hidden rounded-full bg-panel">
        <span className="absolute left-1/2 top-0 h-full w-px bg-line2" />
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct}%`, background: pctColor(pct) }}
        />
      </div>
      <span className="w-16 text-right text-xs tabular-nums">
        <span className="font-semibold">{pct.toFixed(0)}%</span>{" "}
        <span className="text-faint">
          {w}-{l}
        </span>
        {tag === "small" && (
          <span className="block text-[9px] leading-tight text-faint">small sample</span>
        )}
      </span>
    </div>
  );
}

/**
 * CounterReport mines a player's stats into a practical game plan AGAINST them —
 * which side to attack, maps to pick/ban, threats to respect and weaknesses to
 * exploit, plus utility/weapon tells. The page's payoff: raw numbers → "here's
 * how you beat this player." All derived from real Leetify/FACEIT/Steam data.
 */
export function CounterReport({
  leetify,
  faceit,
  steamStats,
  name,
}: {
  leetify: LeetifyProfile;
  faceit?: FaceitProfile | null;
  steamStats?: SteamGameStats | null;
  name: string;
}) {
  const r = leetify.rating;
  const st = leetify.stats;
  const recent = leetify.recent_matches ?? [];
  const hs = st.accuracy_head || faceit?.hsPct || 0;

  // --- CT / T matchup ---
  const ctOpen = st.ct_opening_duel_success_percentage || 0;
  const tOpen = st.t_opening_duel_success_percentage || 0;
  const hasSides = ctOpen > 0 || tOpen > 0 || r.ct_leetify !== 0 || r.t_leetify !== 0;
  // weaker side blends rating + opening success
  const ctScore = r.ct_leetify * 100 + ctOpen;
  const tScore = r.t_leetify * 100 + tOpen;
  const weakerSide = !hasSides ? null : ctScore < tScore ? "CT" : "T";

  // --- threats to respect ---
  const threats: Tip[] = [];
  if (r.aim >= 70)
    threats.push({ title: "Sharp aim", tip: `Aim ${r.aim.toFixed(0)} — avoid long-range duels; use utility to take space.` });
  if (st.reaction_time_ms > 0 && st.reaction_time_ms < 560)
    threats.push({ title: "Fast reaction", tip: "Don't wide-swing — hold off-angles and make them come to you." });
  if (st.preaim > 0 && st.preaim < 8)
    threats.push({ title: "Tight crosshair", tip: "Pre-aims common spots — vary timings, no free first-peeks." });
  if (Math.max(ctOpen, tOpen) >= 56)
    threats.push({ title: "Wins entry duels", tip: `Up to ${Math.max(ctOpen, tOpen).toFixed(0)}% opening success — let them peek first and trade.` });
  if (r.clutch >= 0.04)
    threats.push({ title: "Strong clutcher", tip: "Close rounds fast — never leave them in a 1vX." });
  if (st.spray_accuracy >= 42 || hs >= 28)
    threats.push({ title: "Strong spray / HS", tip: "Break line of sight after first contact; don't sit in a spray duel." });
  if (st.counter_strafing_good_shots_ratio >= 78)
    threats.push({ title: "Crisp movement", tip: "Counter-strafes cleanly — won't miss re-peeks; isolate the duel." });
  if (st.flashbang_hit_foe_per_flashbang >= 0.7)
    threats.push({ title: "Effective flashes", tip: "Lands blinds on execs — turn off pop-flash spots, expect supported peeks." });
  if (r.utility >= 66)
    threats.push({ title: "Good utility", tip: "Expect lineups on execs — play off default util timings." });

  // --- weaknesses to exploit ---
  const weak: Tip[] = [];
  if (weakerSide === "T")
    weak.push({ title: "Weaker on T-side", tip: "Struggles to enter — stack CT holds and make them earn sites." });
  else if (weakerSide === "CT")
    weak.push({ title: "Weaker on CT-side", tip: "Struggles to hold — pressure sites and run defaults at them." });
  if (r.utility < 55)
    weak.push({ title: "Low utility use", tip: "Expect dry peeks — set crossfires and punish un-naded entries." });
  if (st.flashbang_hit_foe_per_flashbang > 0 && st.flashbang_hit_foe_per_flashbang < 0.45)
    weak.push({ title: "Flashes rarely blind", tip: "Hold through their pop-flashes — don't pre-emptively turn away." });
  if (st.counter_strafing_good_shots_ratio > 0 && st.counter_strafing_good_shots_ratio < 60)
    weak.push({ title: "Sprays on the move", tip: "Bait their first shots — they miss while strafing." });
  if (r.clutch <= -0.02)
    weak.push({ title: "Weak in clutches", tip: "Force 1vX situations and isolate them late-round." });
  if (Math.max(ctOpen, tOpen) > 0 && Math.max(ctOpen, tOpen) < 46)
    weak.push({ title: "Loses opening duels", tip: "Pressure early — take first contact and map control." });
  if (st.trade_kills_success_percentage > 0 && st.trade_kills_success_percentage < 45)
    weak.push({ title: "Poor refragger", tip: "Bait their entry — they won't trade their teammate's death." });
  if (r.positioning > 0 && r.positioning < 48)
    weak.push({ title: "Loose positioning", tip: "Play for picks — expect off-spots and over-extensions." });
  // cold streak
  const last10 = recent.slice(0, 10);
  const w10 = last10.filter((m) => m.outcome === "win").length;
  if (last10.length >= 6 && w10 / last10.length < 0.4)
    weak.push({ title: "On a cold streak", tip: "Losing run lately — apply early pressure and tilt them." });
  if (!weak.length)
    weak.push({ title: "No glaring weakness", tip: "Win the utility war, avoid their best map, and grind for picks." });

  // --- map plan (sample-aware; surfaces the most-played "main" — see lib/mapplan) ---
  const { pick, ban, main, hasMain, mainStrong, hasSoftMap, totalReal } =
    computeMapPlan(recent);
  const mapTag = (m: { map: string; n: number }): "main" | "small" | undefined =>
    main && m.map === main.map ? "main" : m.n < 5 ? "small" : undefined;

  // --- weapon tendencies (Steam, public profiles) ---
  const ws = steamStats?.stats;
  let weapons: { w: string; kills: number }[] = [];
  let awpShare = 0;
  if (ws) {
    const all = Object.keys(ws).filter(
      (k) => k.startsWith("total_kills_") && k !== "total_kills_headshot",
    );
    const total = all.reduce((s, k) => s + (ws[k] ?? 0), 0);
    weapons = all
      .map((k) => ({ w: k.slice("total_kills_".length), kills: ws[k] ?? 0 }))
      .filter((x) => x.kills > 0)
      .sort((a, b) => b.kills - a.kills)
      .slice(0, 3);
    const awp = ws["total_kills_awp"] ?? 0;
    awpShare = total > 0 ? awp / total : 0;
  }

  // --- one-line game plan ---
  const planBits: string[] = [];
  const softMap = pick.find((p) => p.adj < 50);
  if (softMap) planBits.push(`pick ${mapLabel(softMap.map)}`);
  else if (hasMain && main) planBits.push(`avoid their main ${mapLabel(main.map)}`);
  else if (pick[0]) planBits.push(`target ${mapLabel(pick[0].map)}`);
  if (weakerSide) planBits.push(`attack their ${weakerSide} side`);
  const topWeak = weak.find((x) => x.title !== "No glaring weakness");
  if (topWeak) planBits.push(topWeak.title.toLowerCase());
  const plan = planBits.length
    ? `Game plan: ${planBits.join(", ")}.`
    : "Game plan: out-utility them and play for picks.";

  return (
    <section className="card-2 px-5 py-5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand/15 text-brand">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <circle cx="12" cy="12" r="8" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
        </span>
        <h2 className="text-lg font-extrabold tracking-tight">Counter report</h2>
        <span className="text-xs text-faint">how to play against {name}</span>
      </div>
      <p className="mb-4 text-sm font-medium text-ink">{plan}</p>

      {/* CT / T matchup */}
      {hasSides && (
        <div className="mb-4 rounded-xl border border-line bg-panel/40 px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="stat-label">Side matchup</span>
            {weakerSide && (
              <span className="text-xs font-semibold text-good">
                ▸ attack their {weakerSide} side
              </span>
            )}
          </div>
          <div className="space-y-2">
            {[
              { label: "CT", open: ctOpen, rating: r.ct_leetify },
              { label: "T", open: tOpen, rating: r.t_leetify },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-2.5">
                <span className="w-5 text-xs font-bold">{s.label}</span>
                <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-panel">
                  <span className="absolute left-1/2 top-0 h-full w-px bg-line2" />
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${s.open}%`, background: pctColor(s.open) }}
                  />
                </div>
                <span className="w-28 text-right text-xs tabular-nums">
                  <span className="text-muted">{s.open.toFixed(0)}% entries</span>{" "}
                  <span className={impactText(s.rating)}>{signed(s.rating)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* exploit */}
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-good">
            <span className="h-2 w-2 rounded-full bg-good" />
            Exploit — their weaknesses
          </div>
          <ul className="space-y-2">
            {weak.slice(0, 5).map((x) => (
              <li key={x.title} className="rounded-lg border border-good/20 bg-good/[0.06] px-3 py-2">
                <div className="text-sm font-semibold">{x.title}</div>
                <div className="text-xs leading-relaxed text-muted">{x.tip}</div>
              </li>
            ))}
          </ul>
        </div>

        {/* respect */}
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-bad">
            <span className="h-2 w-2 rounded-full bg-bad" />
            Respect — their threats
          </div>
          {threats.length ? (
            <ul className="space-y-2">
              {threats.slice(0, 5).map((x) => (
                <li key={x.title} className="rounded-lg border border-bad/20 bg-bad/[0.06] px-3 py-2">
                  <div className="text-sm font-semibold">{x.title}</div>
                  <div className="text-xs leading-relaxed text-muted">{x.tip}</div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-lg border border-line bg-panel/40 px-3 py-2 text-xs text-muted">
              No standout strengths — nothing you have to play around.
            </div>
          )}
        </div>
      </div>

      {/* most-played "main" map — the comfort pick a raw win-rate sort hides */}
      {hasMain && main && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-brand/25 bg-brand/[0.06] px-4 py-3">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand/15 text-brand">
            ★
          </span>
          <div className="text-sm leading-relaxed">
            <span className="font-semibold capitalize">Main map — {mapLabel(main.map)}.</span>{" "}
            <span className="text-muted">
              {main.n} of {totalReal} recent games ({main.pct.toFixed(0)}%, {main.w}-{main.l}) — far
              more than any other map.{" "}
              {mainStrong
                ? "Their comfort map and a likely first-pick; banning it denies their most-practiced map."
                : "Even if it isn't their highest win-rate, it's their most-practiced map and most reliable read — think twice before picking into it."}
            </span>
          </div>
        </div>
      )}

      {/* map plan */}
      {(pick.length > 0 || ban.length > 0) && (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="stat-label mb-2 text-good">
              {hasSoftMap ? "Pick these maps" : "Their weakest maps"}
            </div>
            <div className="space-y-1.5">
              {pick.length ? (
                pick.map((m) => (
                  <MapRow key={m.map} map={m.map} pct={m.pct} w={m.w} l={m.l} tag={mapTag(m)} />
                ))
              ) : (
                <span className="text-xs text-faint">not enough data</span>
              )}
            </div>
            {!hasSoftMap && pick.length > 0 && (
              <p className="mt-1.5 text-[10px] leading-snug text-faint">
                No losing map — they win on all of these; pick their lowest only if forced.
              </p>
            )}
          </div>
          <div>
            <div className="stat-label mb-2 text-bad">Ban these maps</div>
            <div className="space-y-1.5">
              {ban.length ? (
                ban.map((m) => (
                  <MapRow key={m.map} map={m.map} pct={m.pct} w={m.w} l={m.l} tag={mapTag(m)} />
                ))
              ) : (
                <span className="text-xs text-faint">not enough data</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* weapon tendencies */}
      {weapons.length > 0 && (
        <div className="mt-4 rounded-xl border border-line bg-panel/40 px-4 py-3">
          <div className="stat-label mb-1.5">Weapon tendencies</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {weapons.map((w) => (
              <span key={w.w} className="pill bg-panel text-muted">
                {weaponLabel(w.w)}
              </span>
            ))}
            <span className="ml-1 text-xs text-muted">
              {awpShare >= 0.15
                ? "— heavy AWPer: flash/util the long angles and force close duels."
                : "— rifle-reliant: contest mid-range, deny the easy AWP picks."}
            </span>
          </div>
        </div>
      )}

      <p className="mt-4 border-t border-line pt-3 text-[11px] text-faint">
        Derived from {name}&apos;s recent Leetify/FACEIT/Steam stats — a scouting
        aid, not a guarantee. Map order is sample-adjusted (small samples pulled
        toward 50% so a lucky few games can&apos;t outrank a proven record); %s are
        over the last {recent.length} matches.
      </p>
    </section>
  );
}
