import type { LeetifyProfile } from "@/lib/types";

function Chip({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "good" | "bad" | "brand" | "mid";
}) {
  const cls = {
    good: "bg-good/15 text-good",
    bad: "bg-bad/15 text-bad",
    brand: "bg-brand/15 text-brand",
    mid: "bg-mid/15 text-mid",
  }[tone];
  return <span className={`pill ${cls}`}>{children}</span>;
}

/**
 * PlayerSummary turns a Leetify profile into a one-glance verdict: the player's
 * standout strength, weakest area, a playstyle/role tag, and recent-form
 * sentiment — so a visitor gets "is this player good, and at what?" instantly
 * instead of parsing ~25 scattered numbers. Pure arithmetic over data on hand.
 */
export function PlayerSummary({ leetify: p }: { leetify: LeetifyProfile }) {
  const dims = [
    { k: "aim", v: p.rating.aim },
    { k: "positioning", v: p.rating.positioning },
    { k: "utility", v: p.rating.utility },
  ];
  const best = dims.reduce((a, b) => (b.v > a.v ? b : a));
  const worst = dims.reduce((a, b) => (b.v < a.v ? b : a));

  const r = p.rating;
  let role = "";
  if (r.opening > 0.04) role = "Entry fragger";
  else if (r.clutch > 0.04) role = "Clutcher";
  else if (p.rating.utility >= 62) role = "Support";
  else if (p.rating.aim >= 75) role = "Rifler";

  const winPct = p.winrate * 100;

  return (
    <section className="card px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand/15 text-sm font-black text-brand">
          ✦
        </span>
        <span className="stat-label mr-1">Summary</span>
        {best.v >= 55 && (
          <Chip tone="good">
            Strong {best.k} {best.v.toFixed(0)}
          </Chip>
        )}
        {worst.v < best.v - 8 && (
          <Chip tone="bad">
            Weak {worst.k} {worst.v.toFixed(0)}
          </Chip>
        )}
        {role && <Chip tone="brand">{role}</Chip>}
        {winPct >= 55 ? (
          <Chip tone="good">Winning ({winPct.toFixed(0)}%)</Chip>
        ) : winPct > 0 && winPct < 45 ? (
          <Chip tone="bad">Losing ({winPct.toFixed(0)}%)</Chip>
        ) : null}
      </div>
    </section>
  );
}
