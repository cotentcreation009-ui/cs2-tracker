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

// Final series score "2–1", when both teams + the score are known.
function finalScore(m: MatchState | null): string | null {
  const a = m?.teams?.[0];
  const b = m?.teams?.[1];
  if (!a || !b || !m?.seriesScore) return null;
  return `${m.seriesScore[a.gridId] ?? 0}–${m.seriesScore[b.gridId] ?? 0}`;
}

// "Mirage 13:9, Nuke 8:13, Inferno 13:11" for the finished maps.
function mapLines(m: MatchState | null): string {
  const a = m?.teams?.[0];
  const b = m?.teams?.[1];
  if (!a || !b) return "";
  return (m?.maps ?? [])
    .filter((mp) => mp.finished && mp.mapName)
    .map(
      (mp) =>
        `${(mp.mapName ?? "").replace(/^de_/, "")} ${mp.scoreByTeam?.[a.gridId] ?? 0}:${mp.scoreByTeam?.[b.gridId] ?? 0}`,
    )
    .join(", ");
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
  // Finished series are durable, substantial content (final score, per-map
  // results, round breakdowns) — they index and accumulate as inventory.
  // Live/upcoming pages stay noindex: thin, volatile, near-duplicate.
  if (m?.status === "finished" && vs) {
    const score = finalScore(m);
    const maps = mapLines(m);
    const title = `${vs}${score ? ` ${score}` : ""}${tourney} — CS2 result | ${SITE_NAME}`;
    const description = `Final result: ${vs}${score ? ` ${score}` : ""}${tourney}.${maps ? ` Maps: ${maps}.` : ""} Full per-map scores and round-by-round breakdown.`;
    return {
      title,
      description,
      alternates: { canonical: `/pro-matches/${id}` },
      openGraph: { title, description, url: `/pro-matches/${id}` },
    };
  }
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
  const vs = versus(initial);
  const ld =
    initial?.status === "finished" && vs
      ? {
          "@context": "https://schema.org",
          "@type": "SportsEvent",
          name: `${vs}${initial.tournamentName ? ` — ${initial.tournamentName}` : ""}`,
          sport: "Counter-Strike 2",
          eventStatus: "https://schema.org/EventScheduled",
          ...(initial.startScheduled ? { startDate: initial.startScheduled } : {}),
          competitor: (initial.teams ?? []).map((t) => ({
            "@type": "SportsTeam",
            name: t.name,
          })),
          description: `Final score ${finalScore(initial) ?? ""}${mapLines(initial) ? ` (${mapLines(initial)})` : ""}`.trim(),
        }
      : null;
  return (
    <>
      {ld && (
        // structured data for finished (indexable) results
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      )}
      <MatchDetailClient id={id} initialData={initial} />
    </>
  );
}
