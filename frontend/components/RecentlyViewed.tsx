"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PlayerHit } from "@/lib/types";
import { getRecentPlayers } from "@/lib/recent";

// Shows the visitor's own recently-viewed players (from localStorage). Renders
// nothing until there's history, so a first-time visitor never sees an empty box.
export function RecentlyViewed() {
  const [items, setItems] = useState<PlayerHit[]>([]);
  useEffect(() => setItems(getRecentPlayers()), []);
  if (items.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
        Recently viewed
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((p) => (
          <Link
            key={p.steamId64}
            href={`/profiles/${p.steamId64}`}
            className="card lift flex items-center gap-3 px-4 py-3"
          >
            {p.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.avatarUrl}
                alt=""
                className="h-9 w-9 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-panel text-sm font-bold text-faint">
                {(p.personaName || "?").slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="truncate text-sm font-medium">
              {p.personaName || p.steamId64}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
