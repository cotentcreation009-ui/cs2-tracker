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
    title: "FACEIT ELO math: the ten level thresholds and how a win or loss is priced",
    shortTitle: "FACEIT ELO math",
    description:
      "FACEIT's ten CS2 level thresholds with the ELO width of each, how a win or a loss is priced against the other team's average with worked examples, calibration on a new account, why level 10 has no ceiling, how levels relate to Premier and Competitive, and FACEIT's inactivity rules.",
    updated: "2026-10-08",
    tag: "Ranks",
    read: "9 min read",
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
    title: "Where does your CS Rating sit? Premier rating percentiles from 935 tracked players",
    shortTitle: "CS Rating percentiles",
    description:
      "Premier CS Rating percentiles and color-band shares from 935 players tracked by CSRun, what players in each band do per game (K/D, damage per round, preaim), how many points a win or loss moves you by band, and what that arithmetic means for climbing.",
    updated: "2026-10-08",
    tag: "Ranks",
    read: "9 min read",
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
    title: "CS2 bans reference: the cooldown ladder, Steam's ban fields, FACEIT ban durations and appeals",
    shortTitle: "CS2 bans reference",
    description:
      "A working reference for every CS2 ban: Valve's exact competitive cooldown ladder and escalation rules, the GetPlayerBans fields Steam exposes and how CSRun shows them, how ban waves look on a profile over time, FACEIT's ban categories and published durations, trade and economy bans, what can be appealed, and how to read a banned profile fairly.",
    updated: "2026-10-08",
    tag: "Guides",
    read: "10 min read",
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
    title: "Which CS2 queue should you play? Competitive, Premier and FACEIT, with the data",
    shortTitle: "Which queue to play",
    description:
      "The Competitive skill-group distribution across 38,117 players tracked by CSRun and what each group does per game, the Premier rating that Silver, Gold Nova and Global Elite accounts typically hold, the maps each Valve queue actually plays, what FACEIT adds, and a queue recommendation per type of player.",
    updated: "2026-10-08",
    tag: "Guides",
    read: "10 min read",
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
