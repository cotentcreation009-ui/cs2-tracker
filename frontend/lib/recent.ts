import type { PlayerHit } from "@/lib/types";

// Recently-viewed players, persisted client-side so the search box and homepage
// can offer quick re-access (turns a cold lookup tool into a sticky one).
// Browser-only by design: nothing here ever reaches the server, and a reader
// renders nothing until there is history.
const KEY = "cs2:recent-players";
const MAX = 8;
// Dispatched on window whenever the list changes, so every reader on the page
// (the search box's Recent list, the homepage strip, their Clear buttons)
// updates together instead of each holding its own stale copy.
const CHANGED_EVENT = "cs2:recent-changed";

export function getRecentPlayers(): PlayerHit[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return []; // guard against a malformed/stale value
    return parsed.filter(
      (p): p is PlayerHit => !!p && typeof p.steamId64 === "string",
    );
  } catch {
    return [];
  }
}

function notifyChanged(): void {
  try {
    window.dispatchEvent(new Event(CHANGED_EVENT));
  } catch {
    /* no event support — readers refresh on their next mount */
  }
}

export function pushRecentPlayer(p: PlayerHit): void {
  if (typeof window === "undefined" || !p.steamId64) return;
  try {
    const list = getRecentPlayers().filter((x) => x.steamId64 !== p.steamId64);
    list.unshift({
      steamId64: p.steamId64,
      personaName: p.personaName,
      avatarUrl: p.avatarUrl,
    });
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    notifyChanged();
  } catch {
    /* storage full / disabled — ignore */
  }
}

// clearRecentPlayers forgets the list — the visitor's own history, the
// visitor's own call. Fires the change event even when storage refused, so a
// reader that was showing an in-memory copy drops it too.
export function clearRecentPlayers(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* storage disabled — nothing to forget */
  }
  notifyChanged();
}

// subscribeRecent calls cb whenever this tab's list changes. Returns the
// unsubscribe, shaped for a useEffect cleanup.
export function subscribeRecent(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGED_EVENT, cb);
  return () => window.removeEventListener(CHANGED_EVENT, cb);
}
