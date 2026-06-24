import type { FaceitProfile, LeetifyProfile } from "@/lib/types";

// CS2 Premier rating color bands (grey → blue → purple → pink → red → gold).
function premierColor(r: number): string {
  if (r >= 30000) return "#ffd24a";
  if (r >= 25000) return "#ff5b5b";
  if (r >= 20000) return "#ff5bd0";
  if (r >= 15000) return "#8a5bff";
  if (r >= 10000) return "#3b6ff0";
  if (r >= 5000) return "#5b9dff";
  return "#99a4b3";
}

function Chip({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5">
      <span className="stat-label">{label}</span>
      <span
        className="text-sm font-bold tabular-nums"
        style={color ? { color } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * RankStrip surfaces every rank we know for a player as a row of scannable
 * badges (Premier with its color tier, FACEIT level+ELO, Leetify rating,
 * Wingman) — the first thing CS2 players look for. Renders nothing if no ranks.
 */
export function RankStrip({
  leetify,
  faceit,
}: {
  leetify?: LeetifyProfile | null;
  faceit?: FaceitProfile | null;
}) {
  const r = leetify?.ranks;
  const chips: { key: string; label: string; value: string; color?: string }[] =
    [];

  const premier = r?.premier ?? 0;
  if (premier > 0) {
    chips.push({
      key: "premier",
      label: "Premier",
      value: premier.toLocaleString("en-US"),
      color: premierColor(premier),
    });
  }

  const faceitLevel = faceit?.skillLevel || r?.faceit || 0;
  if (faceitLevel > 0) {
    const elo = faceit?.elo || r?.faceit_elo || 0;
    chips.push({
      key: "faceit",
      label: "FACEIT",
      value: `Lvl ${faceitLevel}${elo ? ` · ${elo}` : ""}`,
      color: "#ff5500",
    });
  }

  if (r?.leetify != null && r.leetify > 0) {
    chips.push({
      key: "leetify",
      label: "Leetify",
      value: r.leetify.toFixed(2),
      color: "#5b9dff",
    });
  }

  if (r?.wingman != null && r.wingman > 0) {
    chips.push({ key: "wingman", label: "Wingman", value: `#${r.wingman}` });
  }

  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <Chip key={c.key} label={c.label} value={c.value} color={c.color} />
      ))}
    </div>
  );
}
