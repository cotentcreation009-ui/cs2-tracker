// Shared JSON-LD builders so every page emits the same Organization / WebSite
// identity (Google merges nodes by @id — keeping them identical avoids conflicts)
// and so FAQ structured data is generated from the same array a page renders.
import { CONTACT_EMAIL, SITE_NAME } from "@/lib/site";

export function organizationSchema(siteUrl: string) {
  return {
    "@type": "Organization",
    "@id": `${siteUrl}/#organization`,
    name: SITE_NAME,
    url: siteUrl,
    email: CONTACT_EMAIL,
    logo: `${siteUrl}/icon`,
    description:
      "Independent Counter-Strike 2 analytics — Leetify, FACEIT and Steam stats plus demo analysis for any player.",
  };
}

export function websiteSchema(siteUrl: string) {
  return {
    "@type": "WebSite",
    "@id": `${siteUrl}/#website`,
    name: SITE_NAME,
    url: siteUrl,
    publisher: { "@id": `${siteUrl}/#organization` },
    description:
      "Look up any CS2 player's Leetify rating, FACEIT level, ranks and Steam identity, and analyze match demos.",
  };
}

// Build a FAQPage node from the same {q,a} list a page renders. `path` scopes the
// @id per page ("/", "/about") so distinct FAQs don't collide.
export function faqSchema(
  siteUrl: string,
  path: string,
  faq: { q: string; a: string }[],
) {
  return {
    "@type": "FAQPage",
    "@id": `${siteUrl}${path}#faq`,
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

// Article node for a guide. author/publisher point at the shared Organization
// (@id-merged), so E-E-A-T signals attach to one entity.
export function articleSchema(
  siteUrl: string,
  opts: { slug: string; title: string; description: string; updated: string },
) {
  const url = `${siteUrl}/guides/${opts.slug}`;
  return {
    "@type": "Article",
    "@id": `${url}#article`,
    headline: opts.title,
    description: opts.description,
    datePublished: opts.updated,
    dateModified: opts.updated,
    inLanguage: "en",
    mainEntityOfPage: url,
    author: { "@id": `${siteUrl}/#organization` },
    publisher: { "@id": `${siteUrl}/#organization` },
  };
}

export function breadcrumbSchema(
  siteUrl: string,
  items: { name: string; path: string }[],
) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: `${siteUrl}${it.path}`,
    })),
  };
}

export function graph(nodes: object[]) {
  return { "@context": "https://schema.org", "@graph": nodes };
}
