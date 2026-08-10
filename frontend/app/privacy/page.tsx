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
        from those services and the player&apos;s own public profiles.
      </P>
      <P>
        <strong>Caching and stored snapshots:</strong> most responses are cached
        only briefly and refreshed on demand. The one exception is the CS2
        inventory showcase: Steam strictly limits how often anyone may read
        inventories, so a successful read is stored on our server (in the United
        States, on Google Cloud) as a summary — item names, rarities, estimated
        values and totals — together with the SteamID64 and the time it was read.
        It is
        shown labelled with its age, is never served once it is more than seven
        days old, and is deleted automatically after ninety days without a
        refresh. If a player makes their inventory private, the next read
        replaces the stored summary with nothing but that fact. Only public
        inventories are ever read.
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
        <strong>This section applies to the csrun.win website only.</strong> The
        browser extension shows no advertising, and nothing the extension sends
        us is used for advertising or shared with any ad vendor.
      </P>
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

      <H>The CSRun browser extension</H>
      <P>
        CSRun also publishes a browser extension that adds statistics to
        FACEIT match rooms, FACEIT player profiles and Steam profiles. It is
        optional and separate from this website. This section describes it
        specifically.
      </P>
      <P>
        <strong>What it sends to us:</strong> when you view a page showing a
        player, the extension asks our server for that player&apos;s CheatMeter
        summary. The only thing it sends is that player&apos;s SteamID64 or
        FACEIT nickname. It never sends your Steam or FACEIT account details,
        your cookies, your session, page contents, form data, or any address you
        visit. Requests carry no identifier of you.
      </P>
      <P>
        <strong>What stays in your browser:</strong> your settings are held in
        Chrome&apos;s own extension storage and are never transmitted to us; if
        you have Chrome Sync enabled they sync through Google, not through
        CSRun. Results are held in memory for about five minutes to avoid
        repeating the same lookup and are not written to disk.
      </P>
      <P>
        <strong>What it never does:</strong> the extension does not collect
        browsing history, does not read or transmit the content of pages you
        visit, contains no analytics or tracking of any kind, shows no
        advertising, and loads no remote code — all of its logic ships inside
        the extension package. It reads FACEIT&apos;s own public endpoints from
        the page you are already on, using the session you already have; those
        requests go to FACEIT, not to us.
      </P>
      <P>
        <strong>Optional automation:</strong> the extension can accept a match
        prompt for you and dismiss promotional pop-ups. Both are off unless you
        switch them on, both act only on the page in front of you, and neither
        sends anything anywhere. Accepting matches automatically may conflict
        with FACEIT&apos;s own terms of service, so consider that before
        enabling it.
      </P>
      <P>
        CSRun&apos;s use and transfer of information received from the extension
        adheres to the{" "}
        <a
          className="text-brand hover:underline"
          href="https://developer.chrome.com/docs/webstore/program-policies/user-data-faq"
          target="_blank"
          rel="noopener noreferrer"
        >
          Chrome Web Store User Data Policy
        </a>
        , including the Limited Use requirements. Data the extension sends is
        used solely to return the statistics you asked for, is never sold, is
        never transferred to third parties except as needed to provide that
        feature, and is never used for advertising or for any purpose unrelated
        to the extension&apos;s single purpose.
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
        Third-party data is cached only briefly and refreshed on demand, apart
        from the CS2 inventory snapshots described above (served for at most
        seven days, deleted after ninety without a refresh). Logs are retained
        only as long as needed for security and operations. We use HTTPS
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
