// Shared chrome for a guide article: breadcrumb, header, prose-styled body,
// optional FAQ, closing CTA, and the Article + BreadcrumbList (+ FAQPage)
// structured data. Static/server-rendered — the body is passed as children so
// each guide authors plain semantic HTML (<h2>/<p>/<ul>/<table>) and gets
// consistent typography from the wrapper below.
import type { ReactNode } from "react";
import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import {
  graph,
  organizationSchema,
  articleSchema,
  breadcrumbSchema,
  faqSchema,
} from "@/lib/schema";
import { formatGuideDate, type GuideMeta } from "@/lib/guides";

const siteUrl = process.env.SITE_URL || "http://localhost:3000";

// Prose typography applied to the body via descendant selectors, so guides can
// use plain semantic HTML. `[&>*+*]` spaces sibling blocks; headings/tables get
// specific overrides.
const PROSE = [
  "text-sm leading-relaxed text-muted sm:text-[15px] [&>*+*]:mt-4",
  "[&_h2]:!mt-10 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-ink",
  "[&_h3]:!mt-6 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-ink",
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1.5",
  "[&_strong]:font-semibold [&_strong]:text-ink",
  "[&_a]:text-brand [&_a]:underline [&_a]:decoration-brand/40 [&_a]:underline-offset-2 hover:[&_a]:decoration-brand",
  "[&_table]:w-full [&_table]:border-collapse [&_table]:text-sm",
  "[&_th]:py-2 [&_th]:pr-4 [&_th]:text-left [&_th]:font-semibold [&_th]:text-ink",
  "[&_td]:py-2 [&_td]:pr-4 [&_tbody_tr]:border-t [&_tbody_tr]:border-line",
  "[&_.callout]:rounded-xl [&_.callout]:border [&_.callout]:border-brand/25 [&_.callout]:bg-panel2/40 [&_.callout]:p-4 [&_.callout]:text-sm",
].join(" ");

export function GuideArticle({
  guide,
  faq,
  children,
}: {
  guide: GuideMeta;
  faq?: { q: string; a: string }[];
  children: ReactNode;
}) {
  const nodes: object[] = [
    organizationSchema(siteUrl),
    articleSchema(siteUrl, guide),
    breadcrumbSchema(siteUrl, [
      { name: "Home", path: "/" },
      { name: "Guides", path: "/guides" },
      { name: guide.shortTitle ?? guide.title, path: `/guides/${guide.slug}` },
    ]),
  ];
  if (faq?.length) nodes.push(faqSchema(siteUrl, `/guides/${guide.slug}`, faq));

  return (
    <article className="mx-auto max-w-3xl pb-20">
      <JsonLd data={graph(nodes)} />

      <nav
        aria-label="Breadcrumb"
        className="mb-5 flex flex-wrap items-center gap-1.5 text-xs text-faint"
      >
        <Link href="/" className="hover:text-muted">
          Home
        </Link>
        <span aria-hidden>/</span>
        <Link href="/guides" className="hover:text-muted">
          Guides
        </Link>
        <span aria-hidden>/</span>
        <span className="text-muted">{guide.shortTitle ?? guide.title}</span>
      </nav>

      <p className="text-xs font-semibold uppercase tracking-wider text-brand">
        {guide.tag}
      </p>
      <h1 className="mt-2 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
        {guide.title}
      </h1>
      <p className="mt-2 text-xs text-faint">
        Updated {formatGuideDate(guide.updated)} · {guide.read}
      </p>

      <div className={`mt-8 ${PROSE}`}>{children}</div>

      {faq?.length ? (
        <section className="mt-12">
          <h2 className="text-xl font-bold tracking-tight">
            Frequently asked questions
          </h2>
          <div className="mt-4 space-y-3">
            {faq.map((f) => (
              <details
                key={f.q}
                className="card px-5 py-4 [&_summary]:cursor-pointer"
              >
                <summary className="font-semibold text-ink marker:text-faint">
                  {f.q}
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      ) : null}

      <div className="mt-12 rounded-2xl border border-brand/25 bg-panel2/40 px-6 py-8 text-center">
        <h2 className="text-xl font-bold tracking-tight">Put it into practice</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          Look up any Counter-Strike 2 player and see these numbers on a real
          profile.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3 text-sm">
          <Link
            href="/"
            className="inline-flex items-center gap-1 rounded-lg bg-brand px-4 py-2 font-semibold text-bg transition-opacity hover:opacity-90"
          >
            Look up a player →
          </Link>
          <Link
            href="/guides"
            className="inline-flex items-center gap-1 rounded-lg border border-line px-4 py-2 font-semibold text-ink transition-colors hover:border-brand/40"
          >
            All guides
          </Link>
        </div>
      </div>
    </article>
  );
}
