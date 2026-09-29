import { describe, expect, it } from "vitest";
import { craftNameParts, POSTER_STUDIO_URL, posterStudioHref, posterUnavailableNote } from "./posterStudio";

describe("the bridge from an inventory item to the poster studio", () => {
  it("reads weapon and finish out of a market name, whatever prefix or wear it carries", () => {
    expect(craftNameParts("AK-47 | Redline (Field-Tested)")).toEqual({ weapon: "AK-47", finish: "Redline" });
    expect(craftNameParts("StatTrak™ AK-47 | Case Hardened (Factory New)")).toEqual({ weapon: "AK-47", finish: "Case Hardened" });
    expect(craftNameParts("Souvenir AWP | Dragon Lore (Battle-Scarred)")).toEqual({ weapon: "AWP", finish: "Dragon Lore" });
    expect(craftNameParts("★ StatTrak™ Karambit | Fade (Factory New)")).toEqual({ weapon: "Karambit", finish: "Fade" });
    expect(craftNameParts("Sticker | Team Dignitas (Holo) | Cologne 2014")).toEqual({ weapon: "Sticker", finish: "Team Dignitas (Holo) | Cologne 2014" });
    expect(craftNameParts("Dreams & Nightmares Case")).toBeNull();
  });

  it("links the studio with the copy's float, seed, StatTrak and the stickers in slot order", () => {
    const href = posterStudioHref(
      {
        market_hash_name: "StatTrak™ AK-47 | Case Hardened (Factory New)",
        type: "Rifle",
        stattrak: true,
        applied: [
          { kind: "sticker", name: "Titan (Holo) | Katowice 2014" },
          { kind: "charm", name: "Die-cast AK" },
          { kind: "sticker", name: "iBUYPOWER (Holo) | Katowice 2014" },
        ],
      },
      { float: 0.008227616548538208, seed: 12, inspect: "2131f1beeabfe620392001040925112519c1bbe1fb2261b6254324292031a80749465125813b47eb" },
    );
    expect(href).not.toBeNull();
    const url = new URL(href!);
    expect(`${url.origin}${url.pathname}`).toBe(POSTER_STUDIO_URL);
    expect(url.searchParams.get("name")).toBe("StatTrak™ AK-47 | Case Hardened (Factory New)");
    expect(url.searchParams.get("float")).toBe("0.008228");
    expect(url.searchParams.get("seed")).toBe("12");
    expect(url.searchParams.get("stattrak")).toBe("1");
    expect(url.searchParams.getAll("sticker")).toEqual(["Titan (Holo) | Katowice 2014", "iBUYPOWER (Holo) | Katowice 2014"]);
    // the copy's inspect payload rides along, upper-cased, so the studio can read the slots
    expect(url.searchParams.get("inspect")).toBe("2131F1BEEABFE620392001040925112519C1BBE1FB2261B6254324292031A80749465125813B47EB");
    expect(url.searchParams.get("from")).toBe("csrun-inventory");
  });

  it("does not forward a payload that is not hex", () => {
    const url = new URL(posterStudioHref({ market_hash_name: "AWP | Asiimov (Field-Tested)", type: "Sniper Rifle" }, { inspect: "steam://nope" })!);
    expect(url.searchParams.has("inspect")).toBe(false);
  });

  it("leaves out what a copy does not know, and never sends gloves or a case", () => {
    const plain = new URL(posterStudioHref({ market_hash_name: "AWP | Asiimov (Field-Tested)", type: "Sniper Rifle" })!);
    expect(plain.searchParams.has("float")).toBe(false);
    expect(plain.searchParams.has("seed")).toBe(false);
    expect(plain.searchParams.has("stattrak")).toBe(false);
    expect(posterStudioHref({ market_hash_name: "★ Sport Gloves | Hedge Maze (Field-Tested)", type: "Gloves" })).toBeNull();
    expect(posterStudioHref({ market_hash_name: "Dreams & Nightmares Case", type: "Container" })).toBeNull();
    expect(posterStudioHref({ market_hash_name: "XM1014 | Tranquility (Field-Tested)", type: "Shotgun" })).not.toBeNull();
    expect(posterStudioHref({ market_hash_name: "Negev | Mjölnir (Factory New)", type: "Machinegun" })).not.toBeNull();
  });

  it("sends a knife to the studio by its market name, star and all", () => {
    const knife = new URL(posterStudioHref({ market_hash_name: "★ Karambit | Doppler (Factory New)", type: "Knife" }, { float: 0.0123, seed: 412 })!);
    expect(knife.searchParams.get("name")).toBe("★ Karambit | Doppler (Factory New)");
    expect(knife.searchParams.get("seed")).toBe("412");
    expect(posterStudioHref({ market_hash_name: "★ StatTrak™ M9 Bayonet | Fade (Factory New)", type: "Knife", stattrak: true })).not.toBeNull();
    expect(posterStudioHref({ market_hash_name: "★ Shadow Daggers | Slaughter (Minimal Wear)", type: "Knife" })).not.toBeNull();
    expect(posterUnavailableNote({ market_hash_name: "★ Karambit | Doppler (Factory New)", type: "Knife" })).toBeNull();
  });

  it("says why there is no button, only when the customer would expect one", () => {
    expect(posterUnavailableNote({ market_hash_name: "★ Sport Gloves | Hedge Maze (Field-Tested)", type: "Gloves" })).toBe("Gloves aren't in the poster studio yet.");
    expect(posterUnavailableNote({ market_hash_name: "★ Hand Wraps | Cobalt Skulls (Field-Tested)", type: "Gloves" })).toMatch(/Gloves/);
    expect(posterUnavailableNote({ market_hash_name: "★ Driver Gloves | Crimson Weave (Field-Tested)" })).toBe("Gloves aren't in the poster studio yet.");
    expect(posterUnavailableNote({ market_hash_name: "XM1014 | Tranquility (Field-Tested)", type: "Shotgun" })).toBeNull();
    expect(posterUnavailableNote({ market_hash_name: "Ray Gun | Prototype (Factory New)", type: "Rifle" })).toBe("The Ray Gun isn't in the poster studio yet.");
    expect(posterUnavailableNote({ market_hash_name: "AK-47 | Redline (Field-Tested)", type: "Rifle" })).toBeNull();
    expect(posterUnavailableNote({ market_hash_name: "Sticker | Crown (Foil)", type: "Sticker" })).toBeNull();
    expect(posterUnavailableNote({ market_hash_name: "Dreams & Nightmares Case", type: "Container" })).toBeNull();
  });
});
