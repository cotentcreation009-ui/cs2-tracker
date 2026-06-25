// Privacy Policy. Template tailored to this app (aggregates public third-party
// player data; runs ads). Have a lawyer review before relying on it; edit the
// contact/entity details in lib/site.ts.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { CONTACT_EMAIL, LEGAL_LAST_UPDATED, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: `Privacy Policy — ${SITE_NAME}`,
  description: `How ${SITE_NAME} handles data, cookies and advertising.`,
  alternates: { canonical: "/privacy" },
};

function H({ children }: { children: ReactNode }) {
  return <h2 className="mt-8 text-lg font-semibold text-ink">{children}</h2>;
}
function P({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-sm leading-relaxed text-muted">{children}</p>;
}

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl pb-16">
      <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-xs text-faint">Last updated: {LEGAL_LAST_UPDATED}</p>

      <P>
        {SITE_NAME} (&quot;we&quot;, &quot;us&quot;) is a Counter-Strike 2 stats
        site that aggregates publicly available information about players from
        third-party sources and displays it in one place. This policy explains
        what we show, what we collect from visitors, and the choices you have.
      </P>

      <H>Player information we display</H>
      <P>
        For a given account we show data fetched live from third-party providers
        and public APIs — e.g. Steam persona name, avatar, country, account age,
        CS2 friend code and ban/VAC status, plus Leetify and FACEIT statistics
        (ratings, ranks, match history). We do not create this data; it originates
        from those services and the player&apos;s own public profiles. We cache
        responses briefly to reduce load on those providers.
      </P>

      <H>Information we collect from visitors</H>
      <P>
        <strong>Server logs:</strong> like most sites, our servers and our CDN
        (Cloudflare) process technical data such as IP address, user agent and
        requested URLs for security, abuse prevention and rate-limiting.
        <br />
        <strong>Local storage:</strong> we store a small &quot;recently
        viewed&quot; list and your cookie choice in your browser&apos;s local
        storage. This stays on your device and is not sent to us.
        <br />
        <strong>Advertising/analytics cookies:</strong> only set after you opt in
        (see below).
      </P>

      <H>Cookies &amp; your choices</H>
      <P>
        We distinguish <em>strictly necessary</em> storage (needed for the site to
        function) from <em>advertising/analytics</em> cookies. When you first
        visit, a banner lets you <strong>Accept all</strong> or choose{" "}
        <strong>Necessary only</strong>; advertising/analytics cookies are not
        loaded unless you accept. You can change your choice any time via the{" "}
        <em>Cookie settings</em> link in the footer.
      </P>

      <H>Advertising</H>
      <P>
        We may display ads served by third-party vendors (for example Google
        AdSense). With your consent, these vendors may use cookies/identifiers to
        show and measure ads, including personalized ads. You can review Google&apos;s
        practices at{" "}
        <a
          className="text-brand hover:underline"
          href="https://policies.google.com/technologies/partner-sites"
          target="_blank"
          rel="noopener noreferrer"
        >
          policies.google.com/technologies/partner-sites
        </a>{" "}
        and opt out of personalized advertising at{" "}
        <a
          className="text-brand hover:underline"
          href="https://optout.aboutads.info"
          target="_blank"
          rel="noopener noreferrer"
        >
          optout.aboutads.info
        </a>{" "}
        and{" "}
        <a
          className="text-brand hover:underline"
          href="https://www.youronlinechoices.eu"
          target="_blank"
          rel="noopener noreferrer"
        >
          youronlinechoices.eu
        </a>
        .
      </P>

      <H>Third-party data sources</H>
      <P>
        Player data and stats come from Steam, Leetify and FACEIT. Their handling
        of your data is governed by their own policies — Steam (
        <a
          className="text-brand hover:underline"
          href="https://store.steampowered.com/privacy_agreement/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Valve privacy policy
        </a>
        ), Leetify and FACEIT. We are not responsible for their practices.
      </P>

      <H>Your rights &amp; legal bases</H>
      <P>
        Depending on where you live (e.g. the EEA/UK under GDPR, or California
        under CCPA/CPRA) you may have rights to access, correct, object to, or
        request deletion of personal data, and to withdraw consent. Our lawful
        basis for processing public player data is our legitimate interest in
        providing a stats service; for advertising/analytics cookies it is your
        consent. To exercise any right, contact us below.
      </P>

      <H>Removing your player profile</H>
      <P>
        If you are a player and want your data removed from {SITE_NAME}, email us
        at{" "}
        <a className="text-brand hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>{" "}
        with your SteamID or profile link. We will remove your cached data and can
        suppress your profile from the site. (Note that the underlying data still
        exists at Steam/Leetify/FACEIT; you may also adjust your privacy settings
        there.)
      </P>

      <H>Data retention &amp; security</H>
      <P>
        Third-party data is cached only briefly and refreshed on demand. Logs are
        retained only as long as needed for security and operations. We use HTTPS
        everywhere and reasonable measures to protect data, though no method is
        100% secure.
      </P>

      <H>Children</H>
      <P>
        {SITE_NAME} is not directed to children under 13 (or the minimum age in
        your country) and we do not knowingly collect their data.
      </P>

      <H>Changes</H>
      <P>
        We may update this policy; we&apos;ll revise the &quot;Last updated&quot;
        date above. Material changes will be made prominent where appropriate.
      </P>

      <H>Contact</H>
      <P>
        Questions or requests:{" "}
        <a className="text-brand hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>
        . See also our{" "}
        <Link href="/terms" className="text-brand hover:underline">
          Terms of Service
        </Link>
        .
      </P>
    </article>
  );
}
