import type { Metadata } from "next";
import type { PlayerProfile } from "@/lib/types";

/**
 * profileMetadata builds rich, shareable metadata for a player page: a
 * stats-aware title/description, a canonical pointing at the SteamID64 URL (so
 * /id/<vanity> and /profiles/<id> don't compete in search), and OpenGraph/Twitter
 * cards using the Steam avatar so shared links unfurl with the player's face.
 *
 * NOINDEX, FOLLOW (2026-10-08): a profile is one of thousands of near-identical,
 * largely numeric pages, which is exactly what Google's "low value content"
 * verdict on the AdSense review is about. Keeping them out of the index leaves
 * the guides, the tools and the policy pages as the site search engines judge;
 * the pages themselves, their sharing cards and the site's own search are
 * untouched, and links on them are still followed.
 */
export function profileMetadata(p: PlayerProfile): Metadata {
  const { player, career } = p;
  const id = player.steamId64;
  const name = player.personaName || id;
  const title = `${name} — CSRun`;
  const description =
    career.matches > 0
      ? `${name}: ${career.rating} rating, ${career.kd} K/D over ${career.matches} CS2 matches — plus Leetify, FACEIT and Steam stats.`
      : `${name} — Leetify rating, FACEIT level, ranks and Steam identity on CSRun.`;
  const canonical = `/profiles/${id}`;
  const images = player.avatarUrl ? [player.avatarUrl] : undefined;
  return {
    title,
    description,
    robots: { index: false, follow: true },
    alternates: { canonical },
    openGraph: { type: "profile", title, description, url: canonical, images },
    twitter: { card: "summary", title, description, images },
  };
}
