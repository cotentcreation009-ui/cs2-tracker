import type { Metadata } from "next";
import { API_BASE, internalHeaders } from "@/lib/api";
import { SITE_NAME } from "@/lib/site";
import type { MatchState } from "@/components/pro/types";
import { MatchDetailClient } from "@/components/pro/MatchDetailClient";

// Detail = a server shell (for per-match metadata + an instant first paint) that
// hands off to a self-polling client. The initial fetch uses a short revalidate
// so generateMetadata and the page body dedupe to a single backend hit; the
// client keeps it live from there.
async function fetchMatch(id: string): Promise<MatchState | null> {
  try {
    const res = await fetch(
      `${API_BASE}/api/pro-matches/${encodeURIComponent(id)}`,
      { headers: internalHeaders(), next: { revalidate: 10 } },
    );
    if (!res.ok) return null;
    return (await res.json()) as MatchState;
  } catch {
    return null;
  }
}

function versus(m: MatchState | null): string | null {
  const a = m?.teams?.[0];
  const b = m?.teams?.[1];
  const an = a?.shortName || a?.name;
  const bn = b?.shortName || b?.name;
  return an && bn ? `${an} vs ${bn}` : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const m = await fetchMatch(id);
  const vs = versus(m);
  const tourney = m?.tournamentName ? ` — ${m.tournamentName}` : "";
  const title = vs
    ? `${vs}${tourney} — Live CS2 | ${SITE_NAME}`
    : `Pro Match — ${SITE_NAME}`;
  return {
    title,
    description: vs
      ? `Live CS2 scores for ${vs}${tourney}: series score, live round count and a round-by-round breakdown.`
      : "Live CS2 pro match — series score, live round count and round-by-round breakdown.",
    alternates: { canonical: `/pro-matches/${id}` },
    robots: { index: false },
  };
}

export default async function ProMatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const initial = await fetchMatch(id);
  return <MatchDetailClient id={id} initialData={initial} />;
}
