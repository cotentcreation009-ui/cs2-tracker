"use client";

import { useEffect, useState } from "react";
import { resolvePlayerCard } from "@/lib/liquipediaClient";

// A player's Liquipedia identity card (CC BY-SA 3.0 — attributed wherever it
// renders). Resolved lazily per nickname; the backend caches for 14 days and
// cold lookups trickle in behind Liquipedia's rate limit, so treat every
// field as an enhancement that may arrive a beat after first paint.
export interface PlayerCard {
  found?: boolean;
  name?: string;
  country?: string;
  countryCode?: string;
  role?: string;
  birthDate?: string;
  team?: string;
}

const cache = new Map<string, PlayerCard | null>();
const inflight = new Map<string, Promise<PlayerCard | null>>();

/** Validated ISO alpha-2 for a small country chip ("" when unknown). Emoji
 * flags are deliberately NOT used — Chromium on Windows has no flag glyphs
 * and degrades them to unstyled letter pairs. */
export function countryChip(cc?: string): string {
  if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return "";
  return cc.toUpperCase();
}

/** Age in whole years from an ISO date, null when unparseable. */
export function ageFrom(birthDate?: string): number | null {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
  return age > 10 && age < 60 ? age : null;
}

export function usePlayerCard(nick?: string): PlayerCard | null {
  const k = (nick ?? "").trim().toLowerCase();
  const [card, setCard] = useState<PlayerCard | null>(k ? (cache.get(k) ?? null) : null);

  useEffect(() => {
    if (!k) return;
    if (cache.has(k)) {
      setCard(cache.get(k) ?? null);
      return;
    }
    let alive = true;
    let p = inflight.get(k);
    if (!p) {
      // Backend first (Redis-cached, one Liquipedia hit per player per
      // fortnight site-wide). When it has nothing — which includes the VM's
      // datacenter IP being 429-blocked by Liquipedia, the reason photos
      // resolve in the browser — fall back to the browser-side batched
      // resolver on the visitor's own IP.
      p = fetch(`/api/pro-matches/player-card/${encodeURIComponent(nick!.trim())}`)
        .then((r) => (r.ok ? (r.json() as Promise<PlayerCard>) : null))
        .catch(() => null)
        .then(async (d) => {
          let v: PlayerCard | null = d && d.found ? d : null;
          if (!v) {
            const lp = await resolvePlayerCard(nick!.trim()).catch(() => null);
            if (lp?.found) v = lp;
          }
          cache.set(k, v);
          inflight.delete(k);
          return v;
        });
      inflight.set(k, p);
    }
    p.then((v) => {
      if (alive) setCard(v);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);

  return card;
}
