import type { Round } from "@/lib/types";

/** RoundTimeline shows a compact strip of round outcomes (CT vs T wins). */
export function RoundTimeline({ rounds }: { rounds: Round[] }) {
  if (rounds.length === 0) return null;
  return (
    <div className="card px-4 py-3">
      <div className="stat-label mb-2">Round timeline</div>
      <div className="flex flex-wrap gap-1">
        {rounds.map((r) => {
          const ct = r.winnerSide === "CT";
          const econ =
            r.ctBuy && r.tBuy ? ` · CT ${r.ctBuy} · T ${r.tBuy}` : "";
          return (
            <div
              key={r.number}
              title={`Round ${r.number}: ${r.winnerSide} (${r.endReason})${econ}`}
              className={`grid h-6 w-6 place-items-center rounded text-[10px] font-semibold tabular-nums ${
                ct ? "bg-brand/20 text-brand" : "bg-mid/20 text-mid"
              }`}
            >
              {r.number}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand/60" /> CT win
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-mid/60" /> T win
        </span>
      </div>
    </div>
  );
}
