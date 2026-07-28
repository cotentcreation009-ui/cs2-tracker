import type { MetadataRoute } from "next";
import { API_BASE, getLeaderboard, internalHeaders } from "@/lib/api";
import { GUIDES } from "@/lib/guides";

const siteUrl = process.env.SITE_URL || "http://localhost:3000";

// Re-generate hourly. Seeds search engines with the highest-value profile pages
// (top tracked players) plus the static routes.
export const revalidate = 3600;

// Finished pro matches are durable result pages (indexable since the detail
// page flips them out of noindex) — every completed series becomes inventory.
async function finishedProMatches(): Promise<MetadataRoute.Sitemap> {
  try {
    const res = await fetch(`${API_BASE}/api/pro-matches`, {
      headers: internalHeaders(),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const j = (await res.json()) as {
      matches?: { seriesId: string; status: string; teams?: unknown[]; fetchedAt?: string }[];
    };
    return (j.matches ?? [])
      .filter((m) => m.status === "finished" && (m.teams?.length ?? 0) === 2 && m.seriesId)
      .map((m) => ({
        url: `${siteUrl}/pro-matches/${m.seriesId}`,
        changeFrequency: "monthly" as const,
        priority: 0.6,
      }));
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const players = (await getLeaderboard(100).catch(() => [])).map((p) => ({
    url: `${siteUrl}/profiles/${p.steamId64}`,
    changeFrequency: "daily" as const,
    priority: 0.8,
  }));
  const proMatches = await finishedProMatches();

  return [
    { url: `${siteUrl}/`, changeFrequency: "daily" as const, priority: 1 },
    // The demo analyser landing — a flagship tool page, so it ranks just under
    // the homepage. (Its /demos/* sub-routes are per-visitor local views and are
    // noindex, so only this entry belongs in the sitemap.)
    { url: `${siteUrl}/demos`, changeFrequency: "weekly" as const, priority: 0.9 },
    { url: `${siteUrl}/about`, changeFrequency: "monthly" as const, priority: 0.6 },
    { url: `${siteUrl}/guides`, changeFrequency: "weekly" as const, priority: 0.6 },
    ...GUIDES.map((g) => ({
      url: `${siteUrl}/guides/${g.slug}`,
      lastModified: g.updated,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    { url: `${siteUrl}/pro-matches`, changeFrequency: "hourly" as const, priority: 0.8 },
    { url: `${siteUrl}/compare`, changeFrequency: "weekly" as const, priority: 0.5 },
    { url: `${siteUrl}/privacy`, changeFrequency: "yearly" as const, priority: 0.2 },
    { url: `${siteUrl}/terms`, changeFrequency: "yearly" as const, priority: 0.2 },
    ...players,
    ...proMatches,
  ];
}
