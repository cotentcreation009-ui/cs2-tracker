// Registry of guide articles — the single source of truth for the /guides hub,
// each guide's metadata, breadcrumbs, sitemap entries and structured data. Each
// guide's body lives in its own app/guides/<slug>/page.tsx.
export type GuideMeta = {
  slug: string;
  title: string;
  // Shorter label for breadcrumbs / hub cards where the full title is long.
  shortTitle?: string;
  description: string;
  // ISO date (YYYY-MM-DD) — used for display and Article date{Published,Modified}.
  updated: string;
  tag: string;
  read: string;
};

export const GUIDES: GuideMeta[] = [
  {
    slug: "faceit-levels-and-elo",
    title: "FACEIT levels & ELO explained",
    shortTitle: "FACEIT levels & ELO",
    description:
      "How FACEIT levels and ELO work in CS2: the full 1–10 level table, how ELO is gained and lost, what counts as a good level, and how to check any player's level and ELO.",
    updated: "2026-07-10",
    tag: "Ranks",
    read: "5 min read",
  },
  {
    slug: "good-leetify-rating",
    title: "What's a good Leetify rating?",
    shortTitle: "Good Leetify rating",
    description:
      "What Leetify Rating measures, how the aim, utility and positioning sub-ratings work, what counts as a good rating for your skill level, and how to read your own numbers.",
    updated: "2026-07-10",
    tag: "Stats",
    read: "6 min read",
  },
  {
    slug: "spotting-smurfs-and-cheaters",
    title: "How to spot smurfs & cheaters in CS2",
    shortTitle: "Spotting smurfs & cheaters",
    description:
      "The public signals that hint at a smurf or a cheater in Counter-Strike 2 — account age, VAC status, cross-platform rank gaps and stat anomalies — and how to weigh them without jumping to conclusions.",
    updated: "2026-07-10",
    tag: "Guides",
    read: "7 min read",
  },
];

export function guideBySlug(slug: string): GuideMeta | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Deterministic date formatter (no locale/timezone dependence, safe in static
// generation): "2026-07-10" -> "July 10, 2026".
export function formatGuideDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[(m || 1) - 1]} ${d}, ${y}`;
}
