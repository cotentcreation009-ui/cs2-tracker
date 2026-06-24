"use client";

import { useEffect } from "react";
import type { PlayerHit } from "@/lib/types";
import { pushRecentPlayer } from "@/lib/recent";

// Records a viewed player into the localStorage "recent players" list (renders
// nothing). Lets the search box / homepage offer quick re-access.
export function RecordRecent({ player }: { player: PlayerHit }) {
  useEffect(() => {
    pushRecentPlayer(player);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.steamId64]);
  return null;
}
