// Normalize whatever a user types/pastes into a resolvable identifier: a bare
// SteamID64 or vanity passes through, and a pasted steamcommunity.com profile URL
// is stripped to its id/vanity segment. Mirrors SearchBar's URL handling so the
// Compare "Add a player" field accepts the same inputs the main search bar does.
export function normalizeSteamInput(raw: string): string {
  const t = raw.trim();
  const m = t.match(/steamcommunity\.com\/(?:id|profiles)\/([^/?#]+)/i);
  return m ? m[1] : t;
}
