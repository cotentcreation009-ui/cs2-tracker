import type { FaceitProfile, LeetifyProfile } from "@/lib/types";
import { mapLabel } from "@/lib/format";

type Tip = { title: string; tip: string };

/**
 * CounterReport mines a player's stats for a practical game plan AGAINST them:
 * the threats to respect, the weaknesses to exploit, which maps to pick/ban and
 * which side to attack. This is the page's payoff — it turns raw numbers into
 * "here's how you beat this player." All derived from real Leetify/FACEIT data.
 */
export function CounterReport({
  leetify,
  faceit,
  name,
}: {
  leetify: LeetifyProfile;
  faceit?: FaceitProfile | null;
  name: string;
}) {
  const r = leetify.rating;
  const st = leetify.stats;
  const recent = leetify.recent_matches ?? [];
  const openAvg =
    ((st.ct_opening_duel_success_percentage || 0) +
      (st.t_opening_duel_success_percentage || 0)) /
    2;
  const hs = st.accuracy_head || faceit?.hsPct || 0;

  // --- threats to respect ---
  const threats: Tip[] = [];
  if (r.aim >= 70)
    threats.push({ title: "Sharp aim", tip: `Aim ${r.aim.toFixed(0)} — avoid long-range duels; use utility to take space instead of peeking.` });
  if (st.reaction_time_ms > 0 && st.reaction_time_ms < 560)
    threats.push({ title: "Fast reaction", tip: "Don't wide-swing into them — hold off-angles and make them come to you." });
  if (st.preaim > 0 && st.preaim < 8)
    threats.push({ title: "Tight crosshair", tip: "Pre-aims common angles — vary your timings and re-peek spots, no free first-peeks." });
  if (openAvg >= 55)
    threats.push({ title: "Wins entry duels", tip: `${openAvg.toFixed(0)}% opening success — let them peek first and trade, don't dry-challenge.` });
  if (r.clutch >= 0.04)
    threats.push({ title: "Strong clutcher", tip: "Close rounds out fast — never leave them in a 1vX." });
  if (st.spray_accuracy >= 42 || hs >= 28)
    threats.push({ title: "Strong spray / HS", tip: "Break line of sight after first contact; don't sit in a spray duel." });
  if (r.utility >= 66)
    threats.push({ title: "Good utility", tip: "Expect lineups and flashes on execs — play off default util timings." });

  // --- weaknesses to exploit ---
  const weak: Tip[] = [];
  if (r.utility < 55)
    weak.push({ title: "Low utility use", tip: "Expect dry peeks — set crossfires and punish un-naded entries." });
  if (r.clutch <= -0.02)
    weak.push({ title: "Weak in clutches", tip: "Force 1vX situations and isolate them late in the round." });
  if (openAvg > 0 && openAvg < 45)
    weak.push({ title: "Loses opening duels", tip: "Pressure early — take first contact and map control off the start." });
  if (r.positioning > 0 && r.positioning < 48)
    weak.push({ title: "Loose positioning", tip: "Play for picks — expect off-spots and over-extensions." });
  if (st.traded_deaths_success_percentage > 0 && st.traded_deaths_success_percentage < 45)
    weak.push({ title: "Rarely traded", tip: "Isolate them — their team is slow to trade their deaths." });

  // side weakness
  const sideGap = r.ct_leetify - r.t_leetify;
  const weakerSide = sideGap > 0.03 ? "T" : sideGap < -0.03 ? "CT" : null;
  if (weakerSide === "T")
    weak.push({ title: "Weaker on T-side", tip: "They struggle to enter — stack your CT holds and make them earn sites." });
  else if (weakerSide === "CT")
    weak.push({ title: "Weaker on CT-side", tip: "They struggle to hold — pressure sites and run defaults at them." });

  // cold streak
  const last10 = recent.slice(0, 10);
  const w10 = last10.filter((m) => m.outcome === "win").length;
  if (last10.length >= 6 && w10 / last10.length < 0.4)
    weak.push({ title: "On a cold streak", tip: "Losing run lately — apply early pressure and tilt them." });

  if (!weak.length)
    weak.push({ title: "No glaring weakness", tip: "Win the utility war, avoid their best map, and grind for picks." });

  // --- map plan ---
  const byMap = new Map<string, { n: number; w: number }>();
  for (const m of recent) {
    const k = m.map_name || "unknown";
    const e = byMap.get(k) || { n: 0, w: 0 };
    e.n += 1;
    if (m.outcome === "win") e.w += 1;
    byMap.set(k, e);
  }
  const ranked = [...byMap.entries()]
    .filter(([, e]) => e.n >= 3)
    .map(([map, e]) => ({ map, n: e.n, pct: (e.w / e.n) * 100 }));
  const pick = [...ranked].sort((a, b) => a.pct - b.pct).slice(0, 3);
  const ban = [...ranked].sort((a, b) => b.pct - a.pct).slice(0, 3);

  // --- one-line game plan ---
  const planBits: string[] = [];
  if (pick[0]) planBits.push(`pick ${mapLabel(pick[0].map)}`);
  if (weakerSide) planBits.push(`attack their ${weakerSide} side`);
  if (weak[0] && weak[0].title !== "No glaring weakness")
    planBits.push(weak[0].title.toLowerCase());
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

      <div className="grid gap-4 lg:grid-cols-2">
        {/* exploit */}
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-good">
            <span className="h-2 w-2 rounded-full bg-good" />
            Exploit — their weaknesses
          </div>
          <ul className="space-y-2">
            {weak.slice(0, 5).map((x) => (
              <li
                key={x.title}
                className="rounded-lg border border-good/20 bg-good/[0.06] px-3 py-2"
              >
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
                <li
                  key={x.title}
                  className="rounded-lg border border-bad/20 bg-bad/[0.06] px-3 py-2"
                >
                  <div className="text-sm font-semibold">{x.title}</div>
                  <div className="text-xs leading-relaxed text-muted">{x.tip}</div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-lg border border-line bg-panel/40 px-3 py-2 text-xs text-muted">
              No standout strengths — no single area you have to play around.
            </div>
          )}
        </div>
      </div>

      {/* map plan */}
      {(pick.length > 0 || ban.length > 0) && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="stat-label mb-1.5 text-good">Pick these maps</div>
            <div className="flex flex-wrap gap-1.5">
              {pick.length ? (
                pick.map((m) => (
                  <span key={m.map} className="pill bg-good/12 capitalize text-good">
                    {mapLabel(m.map)} {m.pct.toFixed(0)}%
                  </span>
                ))
              ) : (
                <span className="text-xs text-faint">not enough data</span>
              )}
            </div>
          </div>
          <div>
            <div className="stat-label mb-1.5 text-bad">Ban these maps</div>
            <div className="flex flex-wrap gap-1.5">
              {ban.length ? (
                ban.map((m) => (
                  <span key={m.map} className="pill bg-bad/12 capitalize text-bad">
                    {mapLabel(m.map)} {m.pct.toFixed(0)}%
                  </span>
                ))
              ) : (
                <span className="text-xs text-faint">not enough data</span>
              )}
            </div>
          </div>
        </div>
      )}

      <p className="mt-4 border-t border-line pt-3 text-[11px] text-faint">
        Derived from {name}&apos;s recent Leetify/FACEIT stats — a scouting aid,
        not a guarantee. Map %s are over the last {recent.length} matches.
      </p>
    </section>
  );
}
