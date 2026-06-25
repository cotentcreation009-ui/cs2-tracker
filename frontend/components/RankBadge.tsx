import type { FaceitProfile, LeetifyProfile } from "@/lib/types";

// Official CS2 Premier rating colour bands, matched to Valve's in-game emblem
// (grey → light-blue → blue → purple → magenta → red → gold).
function premierColor(r: number): string {
  if (r >= 30000) return "#f4c84a"; // gold
  if (r >= 25000) return "#e94b4b"; // red
  if (r >= 20000) return "#d24dd0"; // magenta / pink
  if (r >= 15000) return "#8b5ce6"; // purple
  if (r >= 10000) return "#4664e6"; // blue
  if (r >= 5000) return "#56a7d8"; // light blue
  return "#aab6c4"; // grey
}
function premierTier(r: number): string {
  if (r >= 30000) return "Gold";
  if (r >= 25000) return "Red";
  if (r >= 20000) return "Pink";
  if (r >= 15000) return "Purple";
  if (r >= 10000) return "Blue";
  if (r >= 5000) return "Sky";
  return "Grey";
}
// Official FACEIT skill-level colours (1 grey · 2–4 green · 5–7 yellow · 8–9
// orange · 10 red), matched to the in-app level emblems.
function faceitColor(lvl: number): string {
  if (lvl >= 10) return "#e8332e"; // red
  if (lvl >= 8) return "#ff7a18"; // orange
  if (lvl >= 5) return "#ffc220"; // yellow
  if (lvl >= 2) return "#36cf4a"; // green
  return "#dfe5ec"; // grey / white
}

function Badge({
  label,
  tile,
  tileColor,
  tileText,
  children,
}: {
  label: string;
  tile: string;
  tileColor?: string;
  tileText?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-line bg-panel px-3.5 py-2">
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-black"
        style={{
          background: tileColor ? `${tileColor}26` : "var(--color-panel2)",
          color: tileText ?? tileColor ?? "var(--color-muted)",
        }}
      >
        {tile}
      </span>
      <div className="min-w-0">
        <div className="stat-label">{label}</div>
        <div className="flex items-center gap-1.5">{children}</div>
      </div>
    </div>
  );
}

/**
 * RankStrip surfaces every rank we know for a player as a row of scannable
 * badges — Premier with its colour-tier, FACEIT level (colour-coded) + ELO,
 * Leetify rating and Wingman. Renders nothing if no ranks are known.
 */
export function RankStrip({
  leetify,
  faceit,
}: {
  leetify?: LeetifyProfile | null;
  faceit?: FaceitProfile | null;
}) {
  const r = leetify?.ranks;
  const badges: React.ReactNode[] = [];

  const premier = r?.premier ?? 0;
  if (premier > 0) {
    const color = premierColor(premier);
    badges.push(
      <div
        key="premier"
        title={`Premier · ${premierTier(premier)} tier`}
        className="flex items-center gap-2.5 overflow-hidden rounded-xl border px-3 py-2"
        style={{
          borderColor: `${color}59`,
          background: `linear-gradient(100deg, ${color}2e, ${color}0a 72%)`,
        }}
      >
        {/* official Premier emblem: slanted parallel bars in the tier colour */}
        <span className="flex h-9 items-center gap-[3px]" aria-hidden>
          <span
            className="h-9 w-1 -skew-x-12 rounded-[2px]"
            style={{ background: color }}
          />
          <span
            className="h-9 w-[7px] -skew-x-12 rounded-[2px]"
            style={{ background: color }}
          />
          <span
            className="h-9 w-[3px] -skew-x-12 rounded-[2px]"
            style={{ background: color, opacity: 0.5 }}
          />
        </span>
        <div className="min-w-0">
          <div className="stat-label">Premier</div>
          <div
            className="text-base font-bold tabular-nums"
            style={{ color }}
          >
            {premier.toLocaleString("en-US")}
          </div>
        </div>
      </div>,
    );
  }

  const faceitLevel = faceit?.skillLevel || r?.faceit || 0;
  if (faceitLevel > 0) {
    const elo = faceit?.elo || r?.faceit_elo || 0;
    const fcolor = faceitColor(faceitLevel);
    badges.push(
      <div
        key="faceit"
        title={`FACEIT level ${faceitLevel}`}
        className="flex items-center gap-2.5 rounded-xl border border-line bg-panel px-3.5 py-2"
      >
        {/* official FACEIT emblem: dark disc + level-coloured ring + number */}
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-black"
          style={{
            background: "#0a0f1c",
            border: `2px solid ${fcolor}`,
            color: fcolor,
            boxShadow: `0 0 8px -2px ${fcolor}80`,
          }}
        >
          {faceitLevel}
        </span>
        <div className="min-w-0">
          <div className="stat-label">FACEIT</div>
          <div className="flex items-center gap-1.5">
            {elo > 0 ? (
              <>
                <span className="text-base font-bold tabular-nums">
                  {elo.toLocaleString("en-US")}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-faint">
                  ELO
                </span>
              </>
            ) : (
              <span className="text-base font-bold tabular-nums">
                Lvl {faceitLevel}
              </span>
            )}
          </div>
        </div>
      </div>,
    );
  }

  if (r?.leetify != null && r.leetify > 0) {
    badges.push(
      <Badge key="leetify" label="Leetify" tile="L" tileColor="#5b9dff">
        <span className="text-base font-bold tabular-nums text-brand2">
          {r.leetify.toFixed(2)}
        </span>
      </Badge>,
    );
  }

  if (r?.wingman != null && r.wingman > 0) {
    badges.push(
      <Badge key="wingman" label="Wingman" tile="W">
        <span className="text-base font-bold tabular-nums">#{r.wingman}</span>
      </Badge>,
    );
  }

  if (badges.length === 0) return null;
  return <div className="flex flex-wrap gap-2">{badges}</div>;
}
