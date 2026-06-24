import type { Metadata } from "next";
import type { PlayerProfile } from "@/lib/types";

/**
 * profileMetadata builds rich, shareable metadata for a player page: a
 * stats-aware title/description, a canonical pointing at the SteamID64 URL (so
 * /id/<vanity> and /profiles/<id> don't compete in search), and OpenGraph/Twitter
 * cards using the Steam avatar so shared links unfurl with the player's face.
 */
export function profileMetadata(p: PlayerProfile): Metadata {
  const { player, career } = p;
  const id = player.steamId64;
  const name = player.personaName || id;
  const title = `${name} — CS2 Tracker`;
  const description =
    career.matches > 0
      ? `${name}: ${career.rating} rating, ${career.kd} K/D over ${career.matches} CS2 matches — plus Leetify, FACEIT and Steam stats.`
      : `${name} — Leetify rating, FACEIT level, ranks and Steam identity on CS2 Tracker.`;
  const canonical = `/profiles/${id}`;
  const images = player.avatarUrl ? [player.avatarUrl] : undefined;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { type: "profile", title, description, url: canonical, images },
    twitter: { card: "summary", title, description, images },
  };
}
