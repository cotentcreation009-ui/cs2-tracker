"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PlayerHit } from "@/lib/types";
import {
  clearRecentPlayers,
  getRecentPlayers,
  subscribeRecent,
} from "@/lib/recent";
import { SectionHeading } from "@/components/SectionHeading";

// Shows the visitor's own recently-viewed players, from this browser's
// localStorage and nowhere else: the server never sees the list, the server
// HTML and the first client render are both empty (no hydration mismatch),
// and a first-time visitor never sees the heading. Clear here or in the
// search box's Recent list empties both — they subscribe to the same change.
export function RecentlyViewed() {
  const [items, setItems] = useState<PlayerHit[]>([]);
  useEffect(() => {
    const read = () => setItems(getRecentPlayers());
    read();
    return subscribeRecent(read);
  }, []);
  if (items.length === 0) return null;

  return (
    <section className="mt-8" aria-labelledby="recently-viewed-heading">
      <SectionHeading
        id="recently-viewed-heading"
        eyebrow="Recently viewed"
        subline="Saved in this browser only."
        action={
          <button
            type="button"
            onClick={() => clearRecentPlayers()}
            aria-label="Clear recently viewed players"
            className="text-sm font-semibold text-brand hover:underline"
          >
            Clear
          </button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
              <span
                aria-hidden
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-panel text-sm font-bold text-faint"
              >
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
