import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, SITE_NAME } from "@/lib/site";
import { JsonLd } from "@/components/JsonLd";
import { graph, organizationSchema, breadcrumbSchema } from "@/lib/schema";

const siteUrl = process.env.SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  title: `Contact — ${SITE_NAME}`,
  description: `How to reach the people behind ${SITE_NAME}: bug reports, data corrections, profile removal requests, press and partnership enquiries.`,
  alternates: { canonical: "/contact" },
  openGraph: {
    title: `Contact — ${SITE_NAME}`,
    description: `How to reach the people behind ${SITE_NAME}.`,
    url: "/contact",
    type: "website",
  },
};

const MailLink = () => (
  <a
    className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
    href={`mailto:${CONTACT_EMAIL}`}
  >
    {CONTACT_EMAIL}
  </a>
);

export default function Page() {
  return (
    <article className="mx-auto max-w-3xl pb-20">
      <JsonLd
        data={graph([
          organizationSchema(siteUrl),
          breadcrumbSchema(siteUrl, [
            { name: "Home", path: "/" },
            { name: "Contact", path: "/contact" },
          ]),
        ])}
      />

      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Contact</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted sm:text-[15px]">
        {SITE_NAME} is run by a real person, and every message below lands with
        one. The fastest way to reach us for anything is email:{" "}
        <MailLink />.
      </p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted sm:text-[15px]">
        <section>
          <h2 className="text-lg font-bold text-ink">
            Corrections &amp; removal requests
          </h2>
          <p className="mt-2">
            If your profile shows something wrong, or you want your profile off{" "}
            {SITE_NAME} entirely, email us the SteamID or profile link. Removal
            requests are honored: we suppress the profile and clear its cached
            data. Details on what we store and for how long are in the{" "}
            <Link
              href="/privacy"
              className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
            >
              privacy policy
            </Link>
            .
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-ink">Bugs &amp; feedback</h2>
          <p className="mt-2">
            Broken page, a stat that looks off, a feature you wish existed —
            send it over. Include the profile or match link you were looking at
            and what you expected to see; that usually turns a vague report into
            a same-day fix.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-ink">
            The browser extension
          </h2>
          <p className="mt-2">
            Questions about the {SITE_NAME} browser extension — what it reads,
            what it stores, or something it renders on FACEIT or Steam — are
            covered in the extension section of the{" "}
            <Link
              href="/privacy"
              className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
            >
              privacy policy
            </Link>
            , and anything it doesn&apos;t answer is welcome by email.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-ink">
            Press &amp; partnerships
          </h2>
          <p className="mt-2">
            For anything commercial, editorial or licensing-related, use the
            same address with a clear subject line. Background on what{" "}
            {SITE_NAME} is and how it sources its data is on the{" "}
            <Link
              href="/about"
              className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
            >
              about page
            </Link>
            .
          </p>
        </section>
      </div>
    </article>
  );
}
