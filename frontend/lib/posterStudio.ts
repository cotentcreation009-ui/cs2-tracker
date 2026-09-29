/**
 * The bridge from an inventory item to the poster studio on posters.csrun.win.
 *
 * The studio takes a craft by NAME plus its numbers — the finish, the float,
 * the paint seed, StatTrak, and the applied stickers in slot order — because
 * the inspect payload Steam hands out for someone else's inventory is keyed
 * (its first byte is a key id, not the 0x00 of a plain payload), so the
 * studio's decoder cannot read it. Everything the studio needs is already on
 * the item and its copies; nothing here calls anything.
 *
 * The weapon list mirrors the studio's catalogue (CSRun packages/skin-art
 * catalog.ts WEAPONS): every gun. Knives and gloves are not in the studio
 * yet, and the item detail says so instead of sending the customer somewhere
 * that refuses them.
 */

export const POSTER_STUDIO_URL = "https://posters.csrun.win/store/personalized-skin-art";

const POSTER_WEAPONS = new Set([
  "AK-47", "M4A4", "M4A1-S", "AUG", "SG 553", "FAMAS", "Galil AR",
  "AWP", "SSG 08", "SCAR-20", "G3SG1",
  "Desert Eagle", "USP-S", "Glock-18", "P250", "Five-SeveN", "Tec-9", "CZ75-Auto", "Dual Berettas", "P2000", "R8 Revolver", "Zeus x27",
  "P90", "MP9", "MAC-10", "MP7", "MP5-SD", "UMP-45", "PP-Bizon",
  "Nova", "XM1014", "Sawed-Off", "MAG-7", "M249", "Negev",
]);

/** "StatTrak™ AK-47 | Redline (Field-Tested)" → { weapon: "AK-47", finish: "Redline" }; null when it is not a "Weapon | Finish" name. */
export function craftNameParts(marketName: string): { weapon: string; finish: string } | null {
  const bare = marketName.replace(/^(StatTrak™|Souvenir|★)\s+/g, "").replace(/^(StatTrak™|Souvenir|★)\s+/g, "").trim();
  const bar = bare.indexOf(" | ");
  if (bar <= 0) return null;
  const weapon = bare.slice(0, bar).trim();
  const finish = bare.slice(bar + 3).replace(/\s*\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/, "").trim();
  if (!weapon || !finish) return null;
  return { weapon, finish };
}

export type PosterCandidate = {
  market_hash_name: string;
  type?: string;
  stattrak?: boolean;
  souvenir?: boolean;
  applied?: { kind: "sticker" | "charm" | "patch"; name: string }[];
};

/**
 * One copy of the item: its float and seed from Steam's asset properties, and
 * its inspect payload — the hex the game accepts, which since 2026-09-28 the
 * studio can read too (the first byte is a XOR key, not a lock). The payload
 * is what carries each sticker's SLOT and wear; the name list beside it only
 * knows which stickers are on the item, in order.
 */
export type PosterCopy = { float?: number; seed?: number; inspect?: string };

/** Why an item has no poster button, in the customer's words; null when it does have one or is not a weapon at all. */
export function posterUnavailableNote(item: PosterCandidate): string | null {
  const parts = craftNameParts(item.market_hash_name);
  if (!parts || POSTER_WEAPONS.has(parts.weapon)) return null;
  const type = (item.type ?? "").toLowerCase();
  if (item.market_hash_name.startsWith("★") || type === "knife" || type === "gloves") {
    return "Knives and gloves aren't in the poster studio yet.";
  }
  if (type === "shotgun" || type === "machinegun" || type === "machine gun" || type === "pistol" || type === "rifle" || type === "smg" || type === "sniper rifle") {
    return `The ${parts.weapon} isn't in the poster studio yet.`;
  }
  return null;
}

/**
 * The studio link for this item, carrying the copy's float and seed and the
 * stickers in the order Steam lists them (slot order). Null when the studio
 * does not have the weapon.
 */
export function posterStudioHref(item: PosterCandidate, copy?: PosterCopy | null): string | null {
  const parts = craftNameParts(item.market_hash_name);
  if (!parts || !POSTER_WEAPONS.has(parts.weapon)) return null;
  const params = new URLSearchParams();
  params.set("name", item.market_hash_name);
  if (copy?.float != null && Number.isFinite(copy.float)) params.set("float", copy.float.toFixed(6));
  if (copy?.seed != null && Number.isInteger(copy.seed)) params.set("seed", String(copy.seed));
  if (item.stattrak) params.set("stattrak", "1");
  for (const mod of item.applied ?? []) {
    if (mod.kind === "sticker" && mod.name.trim()) params.append("sticker", mod.name.trim());
  }
  // The payload wins in the studio; the fields above are its fallback.
  if (copy?.inspect && /^[0-9A-Fa-f]{12,4096}$/.test(copy.inspect)) params.set("inspect", copy.inspect.toUpperCase());
  params.set("from", "csrun-inventory");
  return `${POSTER_STUDIO_URL}?${params.toString()}`;
}
