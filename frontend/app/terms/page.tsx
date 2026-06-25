// Terms of Service. Template tailored to this app; have a lawyer review and set
// the governing-law / contact details in lib/site.ts before relying on it.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  CONTACT_EMAIL,
  GOVERNING_LAW,
  LEGAL_LAST_UPDATED,
  SITE_NAME,
} from "@/lib/site";

export const metadata: Metadata = {
  title: `Terms of Service — ${SITE_NAME}`,
  description: `The terms for using ${SITE_NAME}.`,
  alternates: { canonical: "/terms" },
};

function H({ children }: { children: ReactNode }) {
  return <h2 className="mt-8 text-lg font-semibold text-ink">{children}</h2>;
}
function P({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-sm leading-relaxed text-muted">{children}</p>;
}

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-3xl pb-16">
      <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-xs text-faint">Last updated: {LEGAL_LAST_UPDATED}</p>

      <P>
        By accessing {SITE_NAME} (the &quot;Service&quot;) you agree to these
        Terms. If you don&apos;t agree, please don&apos;t use the Service.
      </P>

      <H>The service</H>
      <P>
        {SITE_NAME} aggregates and displays publicly available Counter-Strike 2
        player statistics and identity information from third-party sources. It is
        provided free of charge and supported by advertising.
      </P>

      <H>Not affiliated with Valve, Steam, Leetify or FACEIT</H>
      <P>
        {SITE_NAME} is an independent project. It is <strong>not affiliated with,
        endorsed by, or sponsored by</strong> Valve Corporation, Steam,
        Counter-Strike, Leetify, or FACEIT. All trademarks, game content and data
        belong to their respective owners. Data is shown for informational
        purposes under the providers&apos; public availability.
      </P>

      <H>Acceptable use</H>
      <P>
        You agree not to: use the Service for any unlawful purpose; scrape,
        crawl, or bulk-download data through automated means; attempt to disrupt,
        overload, or bypass the Service&apos;s rate limits or security; or resell
        or redistribute the data in violation of the source providers&apos; terms.
      </P>

      <H>Accuracy &amp; availability — &quot;as is&quot;</H>
      <P>
        Statistics come from third parties and may be incomplete, delayed, cached,
        or inaccurate. The Service is provided <strong>&quot;as is&quot; and
        &quot;as available&quot;</strong> without warranties of any kind, express
        or implied, including accuracy, fitness for a particular purpose, or
        uninterrupted availability.
      </P>

      <H>Intellectual property</H>
      <P>
        The {SITE_NAME} source code is open-source under its repository license.
        Player data, game assets and trademarks are the property of their
        respective owners and are not ours to license.
      </P>

      <H>Player data removal &amp; takedowns</H>
      <P>
        If you are a player who wants your profile removed, or you believe content
        infringes your rights, email{" "}
        <a className="text-brand hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>{" "}
        with the SteamID/profile link or a description of the issue, and we will
        act on valid requests. See the{" "}
        <Link href="/privacy" className="text-brand hover:underline">
          Privacy Policy
        </Link>{" "}
        for data-removal details.
      </P>

      <H>Limitation of liability</H>
      <P>
        To the maximum extent permitted by law, {SITE_NAME} and its operators are
        not liable for any indirect, incidental, or consequential damages, or for
        any decision made in reliance on data shown on the Service. Your sole
        remedy for dissatisfaction is to stop using the Service.
      </P>

      <H>Indemnification</H>
      <P>
        You agree to indemnify and hold harmless the operators of {SITE_NAME} from
        claims arising out of your misuse of the Service or violation of these
        Terms.
      </P>

      <H>Governing law</H>
      <P>
        These Terms are governed by the laws of {GOVERNING_LAW}, without regard to
        conflict-of-law rules.
      </P>

      <H>Changes</H>
      <P>
        We may update these Terms; continued use after changes means you accept
        them. We&apos;ll revise the &quot;Last updated&quot; date above.
      </P>

      <H>Contact</H>
      <P>
        <a className="text-brand hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>
      </P>
    </article>
  );
}
