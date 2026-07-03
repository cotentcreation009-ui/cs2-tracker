"use client";

import { useState } from "react";
import { PremierBadge, PremierHistory, type PremierPoint } from "@/components/PremierRank";
import { FaceitBadge, FaceitDetail, faceitColor } from "@/components/FaceitRank";
import type { FaceitProfile } from "@/lib/types";

// RankRow lays out the Premier + FACEIT badges in a single row and renders the
// expanded detail (Premier history / FACEIT detail) BELOW the row — so opening
// one never pushes the other badge off to a new line. Only one detail is open at
// a time. Premier stays clickable-for-history even with no current rating.
export function RankRow({
  premier,
  premierHistory,
  faceit,
  faceitLevelFallback = 0,
  faceitEloFallback = 0,
}: {
  premier: number;
  premierHistory: PremierPoint[];
  faceit?: FaceitProfile | null;
  faceitLevelFallback?: number;
  faceitEloFallback?: number;
}) {
  const [open, setOpen] = useState<"premier" | "faceit" | null>(null);
  const toggle = (which: "premier" | "faceit") =>
    setOpen((o) => (o === which ? null : which));

  const pts = [...premierHistory]
    .filter((p) => p.rating > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const hasHist = pts.length >= 2;
  const showPremier = premier > 0 || pts.length > 0;

  const faceitLevel = faceit?.skillLevel || faceitLevelFallback;
  const faceitElo = faceit?.elo || faceitEloFallback;
  const showFaceit = faceitLevel > 0;

  if (!showPremier && !showFaceit) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {showPremier && (
          <PremierBadge
            premier={premier}
            history={pts}
            open={open === "premier"}
            onToggle={() => toggle("premier")}
          />
        )}
        {showFaceit && (
          <FaceitBadge
            faceit={faceit}
            level={faceitLevel}
            elo={faceitElo}
            open={open === "faceit"}
            onToggle={() => toggle("faceit")}
          />
        )}
      </div>

      {open === "premier" && hasHist && <PremierHistory pts={pts} current={premier} />}
      {open === "faceit" && faceit && (
        <FaceitDetail faceit={faceit} color={faceitColor(faceitLevel)} elo={faceitElo} level={faceitLevel} />
      )}
    </div>
  );
}
