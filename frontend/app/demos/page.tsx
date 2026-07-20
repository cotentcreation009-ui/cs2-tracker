import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/site";
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
  return <DemosClient />;
}
