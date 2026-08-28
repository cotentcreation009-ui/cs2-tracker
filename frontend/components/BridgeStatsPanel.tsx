import type { BridgeMatchRow } from "@/lib/api";
import type { BridgeAggregate } from "@/lib/suspicion";
import { tierColor, kdColor } from "@/lib/format";

// The "Leetify stats" panel for a player Leetify will not serve a profile for.
//
// A registered player's panel shows their full skill breakdown; this one shows
// what the match reports carry — the aim telemetry — over however many matches
// the bridge holds. The sample size leads, because seven matches and seven
// hundred deserve different weight, and pretending otherwise is how a stats
// page turns into a rumour mill.
export function BridgeStatsPanel({
  aggregate,
  rows,
}: {
  aggregate: BridgeAggregate;
  rows: BridgeMatchRow[];
}) {
  const a = aggregate;
  const dates = rows
    .map((r) => r.finishedAt)
    .filter((d): d is string => !!d)
    .sort();
  const span =
    dates.length > 1
      ? `${dates[0].slice(0, 10)} – ${dates[dates.length - 1].slice(0, 10)}`
      : dates[0]?.slice(0, 10);

  const cells: { label: string; value: string; cls?: string; sub?: string }[] = [];
  if (a.preaim) {
    cells.push({
      label: "Crosshair placement",
      value: `${a.preaim.toFixed(1)}°`,
      sub: "lower = closer to target when duels start",
    });
  }
  if (a.reactionTimeMs) {
    cells.push({
      label: "Reaction time",
      value: `${a.reactionTimeMs.toFixed(0)} ms`,
      sub: "time to damage in duels",
    });
  }
  if (a.accuracyHead) {
    cells.push({
      label: "HS accuracy",
      value: `${a.accuracyHead.toFixed(0)}%`,
      cls: tierColor(a.accuracyHead, 28, 18),
      sub: "share of hits on the head",
    });
  }
  if (a.sprayAccuracy) {
    cells.push({
      label: "Spray accuracy",
      value: `${a.sprayAccuracy.toFixed(0)}%`,
      cls: tierColor(a.sprayAccuracy, 42, 30),
    });
  }
  if (a.kdRatio) {
    cells.push({ label: "K/D", value: a.kdRatio.toFixed(2), cls: kdColor(a.kdRatio) });
  }
  if (a.dpr) {
    cells.push({ label: "ADR", value: a.dpr.toFixed(0), cls: tierColor(a.dpr, 80, 65) });
  }
  if (a.leetifyRating) {
    cells.push({
      label: "Leetify rating",
      value: a.leetifyRating.toFixed(2),
      sub: "avg per match, ×100 scale",
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="stat-label mb-1">Aim &amp; duels</div>
        <p className="text-xs text-muted">
          Averaged over <span className="font-semibold text-ink">{a.matches}</span>{" "}
          tracked {a.matches === 1 ? "match" : "matches"}
          {span ? <> · {span}</> : null} — not a career total. New matches are
          picked up automatically.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {cells.map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-line/50 bg-panel/40 px-3.5 py-2.5"
          >
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-faint">
              {c.label}
            </p>
            <p className={`mt-1 text-xl font-extrabold tabular-nums leading-tight ${c.cls ?? "text-ink"}`}>
              {c.value}
            </p>
            {c.sub ? <p className="mt-0.5 text-[10px] text-faint">{c.sub}</p> : null}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-faint">
        <a
          href="https://leetify.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-[#F84982] underline decoration-dotted underline-offset-2"
        >
          Data Provided by Leetify
        </a>
      </p>
    </div>
  );
}
