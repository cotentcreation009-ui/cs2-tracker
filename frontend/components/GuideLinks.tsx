// A short "what these numbers mean" block for the bottom of a profile.
//
// It exists for readers first — a profile is a wall of ratings, K/D, ADR and
// elo, and the guides are where each of those is explained. It also fixes a
// structural problem: Search Console reported "Referring page: None detected"
// for the guides, because nothing linked to them except the guides hub and
// each other. Profiles are by far the most-crawled pages on the site, so a
// link from here is the shortest path Google has to the writing.
import Link from "next/link";
import { GUIDES, type GuideMeta } from "@/lib/guides";

// Chosen for what a profile actually shows: a rating, a K/D, an ADR, a FACEIT
// level. Resolved from the registry so a renamed slug fails the build rather
// than shipping a dead link.
const ON_A_PROFILE = [
  "what-is-a-good-adr-cs2",
  "what-is-a-good-kd-cs2",
  "cs2-rating-systems-compared",
  "faceit-levels-and-elo",
  "premier-cs-rating-explained",
  "spotting-smurfs-and-cheaters",
];

function pick(): GuideMeta[] {
  return ON_A_PROFILE.map((slug) => {
    const g = GUIDES.find((x) => x.slug === slug);
    if (!g) throw new Error(`GuideLinks: unknown guide slug "${slug}"`);
    return g;
  });
}

export function GuideLinks({ name }: { name?: string }) {
  const guides = pick();
  return (
    <section className="card px-5 py-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
        What these numbers mean
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
        {name
          ? `Every figure on ${name}'s profile is explained in plain English:`
          : "Every figure on this profile is explained in plain English:"}
      </p>
      <ul className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {guides.map((g) => (
          <li key={g.slug} className="text-sm leading-relaxed">
            <Link
              href={`/guides/${g.slug}`}
              className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
            >
              {g.shortTitle ?? g.title}
            </Link>
            <span className="text-faint"> · {g.read}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-muted">
        <Link
          href="/guides"
          className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
        >
          All {GUIDES.length} CS2 guides
        </Link>
      </p>
    </section>
  );
}
