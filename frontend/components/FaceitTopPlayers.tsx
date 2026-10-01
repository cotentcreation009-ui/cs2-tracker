import Link from "next/link";
import { getFaceitRankings } from "@/lib/api";
import type { FaceitRankingsResponse } from "@/lib/types";
import { SectionHeading } from "@/components/SectionHeading";
import { FaceitTopPlayersTabs } from "@/components/FaceitTopPlayersTabs";
import { DEFAULT_REGION, REGIONS, asOfLabel } from "@/components/faceitTop";

// The homepage's "Top FACEIT players" strip: FACEIT's published CS2
// leaderboard, the top ten of every region, server-rendered from the
// backend's hour-long snapshot. Five Redis-served backend calls per ISR
// regeneration (each behind Next's 60 s fetch cache), zero Leetify, zero
// Steam. The region switch happens in the browser with no request at all.
//
// It replaced a "Featured players" strip of five hard-coded accounts that
// fetched each one's Leetify profile on every regeneration — 2,076 Leetify
// requests a day, 37% of the site's Leetify traffic, for a list that was
// never top of anything.
export async function FaceitTopPlayers() {
  const answers = await Promise.all(
    REGIONS.map((r) => getFaceitRankings(r.code, 10)),
  );

  // enabled:false is configuration (no FACEIT key), not an outage: there is
  // nothing to show and nothing to apologise for.
  if (answers.some((a) => a !== null && !a.enabled)) return null;

  const lists: Partial<Record<string, FaceitRankingsResponse>> = {};
  answers.forEach((a, i) => {
    if (a && a.enabled && a.players.length > 0) lists[REGIONS[i].code] = a;
  });
  const available = REGIONS.map((r) => r.code).filter((c) => lists[c]);

  const action = (
    <Link
      href="/pro-matches"
      className="text-sm font-semibold text-brand hover:underline"
    >
      All regions on the pro board →
    </Link>
  );

  // Never silently absent: a strip that could not load says so in one line.
  if (available.length === 0) {
    return (
      <section className="mt-10" aria-labelledby="faceit-top-heading">
        <SectionHeading
          id="faceit-top-heading"
          eyebrow="Top FACEIT players"
          subline="FACEIT's published CS2 leaderboard, by elo · refreshed hourly"
          action={action}
        />
        <div className="card-2 px-5 py-6 text-center text-sm text-muted">
          FACEIT&apos;s leaderboard isn&apos;t answering right now. It comes
          back on its own.
        </div>
      </section>
    );
  }

  const lead = lists[DEFAULT_REGION] ?? lists[available[0]]!;
  const stamp = asOfLabel(lead.fetchedAt, lead.stale);

  return (
    <section className="mt-10" aria-labelledby="faceit-top-heading">
      <SectionHeading
        id="faceit-top-heading"
        eyebrow="Top FACEIT players"
        subline={`FACEIT's published CS2 leaderboard, by elo · refreshed hourly${
          stamp ? ` · ${stamp}` : ""
        }`}
        action={action}
      />
      <FaceitTopPlayersTabs lists={lists} initialRegion={DEFAULT_REGION} />
    </section>
  );
}
