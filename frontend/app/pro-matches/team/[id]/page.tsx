import type { Metadata } from "next";
import { ProTeamClient } from "@/components/pro/ProTeamClient";
import { API_BASE, internalHeaders } from "@/lib/api";

// Pro-team page: roster + aggregated stats + recent results. Private-ish
// deep-link (rosters churn), so noindex like the match detail pages.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const res = await fetch(`${API_BASE}/api/pro-matches/team/${encodeURIComponent(id)}`, {
      headers: internalHeaders(),
      next: { revalidate: 120 },
    });
    if (res.ok) {
      const d = (await res.json()) as { team?: { name?: string; shortName?: string } };
      const name = d.team?.name || d.team?.shortName;
      if (name) {
        return {
          title: `${name} — roster, stats & results — StatRun`,
          description: `${name}'s CS2 roster, recent player stats and series results.`,
          robots: { index: false, follow: true },
        };
      }
    }
  } catch {
    // fall through to the generic title
  }
  return { title: "Team — StatRun", robots: { index: false, follow: true } };
}

export default async function ProTeamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProTeamClient id={id} />;
}
