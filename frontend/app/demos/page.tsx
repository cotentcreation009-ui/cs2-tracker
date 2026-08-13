import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/site";
import Link from "next/link";
import { DemosClient } from "./DemosClient";

// Server wrapper so this page gets its OWN title/description/canonical. The UI
// itself is client-side (IndexedDB match library + upload), so it lives in
// DemosClient — a client component can't export metadata, and without this the
// page inherited the site-wide defaults, which read as duplicate content to
// Google ("Crawled – currently not indexed").
export const metadata: Metadata = {
  title: `CS2 demo analysis — 2D replay, routes & weapon stats | ${SITE_NAME}`,
  description:
    "Upload a CS2 .dem and get a 2D radar replay with round-by-round routes, kill positions, weapon and utility breakdowns, plus playstyle tendencies for every player in the match.",
  alternates: { canonical: "/demos" },
  openGraph: {
    title: `CS2 demo analysis — ${SITE_NAME}`,
    description:
      "Upload a CS2 demo and explore a 2D replay: routes, kill positions, weapons, utility and per-player tendencies.",
    url: "/demos",
    type: "website",
  },
};

export default function DemosPage() {
  return (
    <>
      <DemosClient />

      {/* Server-rendered explainer below the tool: the analyzer itself is a
          client component, so without this the page had no crawlable content
          at all — and it doubles as a genuine primer for first-time visitors. */}
      <section className="mx-auto mt-14 max-w-3xl border-t border-line pb-4 pt-10">
        <h2 className="text-2xl font-bold tracking-tight">
          What demo analysis shows you
        </h2>
        <div className="mt-4 space-y-4 text-sm leading-relaxed text-muted sm:text-[15px]">
          <p>
            A CS2 demo (.dem) is a complete recording of a match: every
            position, shot, grenade and death for all ten players, tick by
            tick. That makes it far richer than a scoreboard — the scoreboard
            tells you <em>what</em> happened, a demo shows <em>why</em>.
          </p>
          <p>
            Drop a demo here and the analyzer turns it into a 2D radar replay
            you can scrub round by round: the routes every player took, where
            each kill landed, how utility was spent, weapon-by-weapon
            breakdowns, and playstyle tendencies for everyone in the server —
            entry attempts, trades, clutch situations and opening-duel habits.
            It is the fastest way to answer questions the scoreboard can&apos;t,
            like whether a site broke because of a lost duel or a missing flash.
          </p>
          <p>
            New to demos? The guide to{" "}
            <Link
              href="/guides/cs2-demos-and-replays"
              className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
            >
              getting and watching CS2 demos
            </Link>{" "}
            covers where matchmaking, Premier and FACEIT store them and how to
            review one efficiently, and{" "}
            <Link
              href="/guides/crosshair-placement-and-preaim"
              className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
            >
              preaim, reaction time &amp; crosshair placement
            </Link>{" "}
            explains the aim numbers the analysis surfaces. To see season-long
            stats instead of a single match, look any player up from the{" "}
            <Link
              href="/"
              className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
            >
              homepage
            </Link>
            .
          </p>
        </div>
      </section>
    </>
  );
}
