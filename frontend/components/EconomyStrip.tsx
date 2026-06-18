import type { Round } from "@/lib/types";

function buyClass(buy?: string): string {
  switch (buy) {
    case "full":
      return "bg-good";
    case "force":
      return "bg-mid";
    case "eco":
      return "bg-bad";
    case "pistol":
      return "bg-brand2";
    default:
      return "bg-line";
  }
}

const LEGEND: { cls: string; label: string }[] = [
  { cls: "bg-brand2", label: "pistol" },
  { cls: "bg-bad", label: "eco" },
  { cls: "bg-mid", label: "force" },
  { cls: "bg-good", label: "full" },
];

/** EconomyStrip visualises each team's per-round buy across the match. */
export function EconomyStrip({ rounds }: { rounds: Round[] }) {
  if (rounds.length === 0 || !rounds.some((r) => r.ctBuy)) return null;

  return (
    <div className="card px-4 py-3">
      <div className="stat-label mb-2">Economy</div>
      <div className="space-y-1.5">
        {(["CT", "T"] as const).map((side) => (
          <div key={side} className="flex items-center gap-2">
            <span className="w-5 text-xs font-medium text-faint">{side}</span>
            <div className="flex flex-wrap gap-1">
              {rounds.map((r) => {
                const buy = side === "CT" ? r.ctBuy : r.tBuy;
                const equip = side === "CT" ? r.ctEquipValue : r.tEquipValue;
                return (
                  <div
                    key={r.number}
                    title={`R${r.number} ${side}: ${buy ?? "?"} ($${equip})`}
                    className={`h-3 w-3 rounded-sm ${buyClass(buy)}`}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
        {LEGEND.map((l) => (
          <span key={l.label} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${l.cls}`} /> {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}
