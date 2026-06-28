// Economy classification for one round's buy, from the player's equipment value
// (the in-game worth of their guns + armor + utility + kit at freeze-time end —
// see ReplayPlayerStat.equip). Coarse but honest. Rounds 1 & 13 are the two
// half-start pistol rounds, where everyone is on the same forced economy.

export type BuyKey = "pistol" | "eco" | "semi" | "force" | "full";

export interface BuyClass {
  key: BuyKey;
  label: string;
  hint: string; // tooltip — what the bucket means
  color: string; // tailwind text-color class for the label
}

const PISTOL_ROUNDS = new Set([1, 13]);

// classifyBuy buckets an equipment value into a readable buy type. Thresholds
// reflect CS2 prices: kevlar+helmet ~$1000, SMG ~$1200, rifle ~$2700–3100,
// a full kit (rifle + armor + nades + defuse) ~$4000+.
export function classifyBuy(equip: number, roundNum: number): BuyClass {
  if (PISTOL_ROUNDS.has(roundNum)) {
    return { key: "pistol", label: "Pistol round", hint: "Half-start — everyone on pistol-round money", color: "text-brand2" };
  }
  if (equip < 1000) {
    return { key: "eco", label: "Eco", hint: "Saving — pistol / minimal kit (under $1,000)", color: "text-faint" };
  }
  if (equip < 2500) {
    return { key: "semi", label: "Semi-buy", hint: "Partial buy — armor + pistol or SMG ($1,000–2,500)", color: "text-mid" };
  }
  if (equip < 4000) {
    return { key: "force", label: "Force buy", hint: "Forced — spending limited money on an incomplete kit ($2,500–4,000)", color: "text-mid" };
  }
  return { key: "full", label: "Full buy", hint: "Rifle + armor + utility ($4,000+)", color: "text-good" };
}

// Display order (strongest → weakest) for buy-mix summaries.
export const BUY_KEYS: BuyKey[] = ["full", "force", "semi", "eco", "pistol"];
