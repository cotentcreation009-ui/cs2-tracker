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
  {
    slug: "premier-cs-rating-explained",
    title: "CS2 Premier CS Rating explained",
    shortTitle: "Premier CS Rating",
    description:
      "How Valve's Premier mode and CS Rating work in CS2: the ten calibration wins, how the rating moves, the full color-band table, leaderboards, seasonal resets, and what counts as a good rating.",
    updated: "2026-08-12",
    tag: "Ranks",
    read: "5 min read",
  },
  {
    slug: "cs2-rating-systems-compared",
    title: "Leetify rating, HLTV 2.0 & CS Rating compared",
    shortTitle: "CS2 rating systems compared",
    description:
      "How the Leetify rating, HLTV 2.0, Valve's Premier CS Rating and FACEIT ELO differ: what each measures, its scale, why the numbers don't convert, and which to trust for which question.",
    updated: "2026-08-12",
    tag: "Stats",
    read: "6 min read",
  },
  {
    slug: "what-is-a-good-adr-cs2",
    title: "What's a good ADR in CS2?",
    shortTitle: "Good ADR in CS2",
    description:
      "What ADR measures in CS2, why 100 damage equals one kill, the rough bands from 60 to 95+, how role, side and map shift the number, and what it means when ADR and K/D disagree.",
    updated: "2026-08-12",
    tag: "Stats",
    read: "8 min read",
  },
  {
    slug: "what-is-a-good-kd-cs2",
    title: "What's a good K/D in CS2 — and when it lies",
    shortTitle: "Good K/D in CS2",
    description:
      "Why a 1.0 K/D is break-even in CS2, when the number flatters baiters and punishes entry fraggers, why kills per round is steadier, and which stats to cross-check it against.",
    updated: "2026-08-12",
    tag: "Stats",
    read: "8 min read",
  },
  {
    slug: "cs2-bans-explained",
    title: "VAC bans, game bans & FACEIT bans: what each one means",
    shortTitle: "CS2 bans explained",
    description:
      "The four kinds of CS2 \"ban\" — permanent VAC and game bans, temporary matchmaking cooldowns, and platform-level FACEIT bans — what each shows on a Steam profile, and how to read a lobby-mate's ban fairly.",
    updated: "2026-08-12",
    tag: "Guides",
    read: "7 min read",
  },
  {
    slug: "crosshair-placement-and-preaim",
    title: "Preaim, reaction time & crosshair placement — the numbers behind aim",
    shortTitle: "Crosshair placement & preaim",
    description:
      "What preaim degrees, time to damage and spray accuracy actually measure in CS2, why crosshair placement beats raw reflexes, the habits and drills that move each number, and what to fix first.",
    updated: "2026-08-12",
    tag: "Improve",
    read: "8 min read",
  },
  {
    slug: "cs2-map-veto-strategy",
    title: "How to win the map veto in CS2",
    shortTitle: "Winning the map veto",
    description:
      "Why the map veto is the first round of a CS2 match: finding your real permaban, reading the enemy's likely picks, Bo1 vs Bo3 ban logic, float maps, and checking both teams' map form live.",
    updated: "2026-08-12",
    tag: "Improve",
    read: "7 min read",
  },
  {
    slug: "faceit-vs-premier-vs-mm",
    title: "FACEIT vs Premier vs regular matchmaking: where should you queue?",
    shortTitle: "FACEIT vs Premier vs MM",
    description:
      "How CS2's three ladders compare — FACEIT, Premier and regular competitive matchmaking — on anti-cheat, servers, skill level, queue times and prizes, plus a quick decision list for picking where to queue.",
    updated: "2026-08-12",
    tag: "Guides",
    read: "7 min read",
  },
  {
    slug: "cs2-demos-and-replays",
    title: "CS2 demos: how to get them, watch them, and what they reveal",
    shortTitle: "CS2 demos & replays",
    description:
      "Where to download your CS2 demos — matchmaking, Premier and FACEIT — what share codes are, how to watch a replay well, and what automated demo analysis pulls out of a match.",
    updated: "2026-08-12",
    tag: "Tools",
    read: "7 min read",
  },
  {
    slug: "steam-profile-visibility-for-stats",
    title: "Why stat sites can't see your CS2 stats (and how to fix it)",
    shortTitle: "Steam privacy & stat sites",
    description:
      "Which Steam privacy settings hide your CS2 stats from trackers — profile, Game details and the playtime checkbox — how to make them public step by step, and what going public actually trades away.",
    updated: "2026-08-12",
    tag: "Tools",
    read: "6 min read",
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
