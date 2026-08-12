// Guides hub — lists every article from the registry. Static/crawlable; links
// give each guide an internal path from a stable index page.
import type { Metadata } from "next";
import Link from "next/link";
import { GUIDES, formatGuideDate } from "@/lib/guides";
import { SITE_NAME } from "@/lib/site";
import { JsonLd } from "@/components/JsonLd";
import {
  graph,
  organizationSchema,
  websiteSchema,
  breadcrumbSchema,
} from "@/lib/schema";

const siteUrl = process.env.SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  title: `CS2 guides — ranks, stats & fair play — ${SITE_NAME}`,
  description: `Plain-English Counter-Strike 2 guides: FACEIT levels and ELO, Premier CS Rating, what good ADR and K/D look like, demo review, map vetoes, spotting smurfs and cheaters, and more.`,
  alternates: { canonical: "/guides" },
  openGraph: {
    title: `CS2 guides — ${SITE_NAME}`,
    description: `Plain-English guides to CS2 ranks, stats and fair play.`,
    url: "/guides",
    type: "website",
  },
};

// Section order for the hub. Tags outside this list land at the end so a new
// tag can never silently hide its guides.
const TAG_ORDER = ["Ranks", "Stats", "Improve", "Guides", "Tools"];

export default function GuidesPage() {
  const schema = graph([
    organizationSchema(siteUrl),
    websiteSchema(siteUrl),
    breadcrumbSchema(siteUrl, [
      { name: "Home", path: "/" },
      { name: "Guides", path: "/guides" },
    ]),
  ]);

  const tags = [
    ...TAG_ORDER.filter((t) => GUIDES.some((g) => g.tag === t)),
    ...[...new Set(GUIDES.map((g) => g.tag))].filter(
      (t) => !TAG_ORDER.includes(t),
    ),
  ];

  return (
    <div className="mx-auto max-w-3xl pb-20">
      <JsonLd data={schema} />

      <div className="pill mb-5 border border-brand/20 bg-brand/10 text-brand">
        <span className="h-1.5 w-1.5 rounded-full bg-brand2" />
        Guides
      </div>
      <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
        Counter-Strike 2 guides
      </h1>
      <p className="mt-4 max-w-2xl text-pretty leading-relaxed text-muted sm:text-lg">
        Plain-English explainers for the numbers you see across ranks, stats and
        fair play — written to make CS2 easier to read, not to pad a word count.
      </p>

      {tags.map((tag) => (
        <section key={tag} className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-faint">
            {tag}
          </h2>
          <div className="mt-3 space-y-4">
            {GUIDES.filter((g) => g.tag === tag).map((g) => (
              <Link
                key={g.slug}
                href={`/guides/${g.slug}`}
                className="card lift block px-5 py-5"
              >
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand">
                  {g.tag}
                  <span aria-hidden className="text-faint">
                    ·
                  </span>
                  <span className="font-normal text-faint">{g.read}</span>
                </div>
                <h3 className="mt-2 text-lg font-bold tracking-tight">
                  {g.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">
                  {g.description}
                </p>
                <p className="mt-3 text-xs text-faint">
                  Updated {formatGuideDate(g.updated)}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
