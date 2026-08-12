import type { Metadata } from "next";
import Link from "next/link";
import { guideBySlug } from "@/lib/guides";
import { SITE_NAME } from "@/lib/site";
import { GuideArticle } from "@/components/guide/GuideArticle";

const g = guideBySlug("steam-profile-visibility-for-stats")!;

export const metadata: Metadata = {
  title: `${g.title} — ${SITE_NAME}`,
  description: g.description,
  alternates: { canonical: `/guides/${g.slug}` },
  openGraph: {
    title: g.title,
    description: g.description,
    url: `/guides/${g.slug}`,
    type: "article",
  },
};

const FAQ = [
  {
    q: "Why does a tracker say my profile is private when I can see everything on it?",
    a: "Because you are looking at your own profile while signed in — Steam always shows you your own data, whatever your privacy settings say. To see what a tracker sees, open your profile in a private browsing window while logged out. If half of it disappears, that is what the outside world gets.",
  },
  {
    q: "Do I have to make my inventory public for my CS2 stats to show?",
    a: "No. Inventory has its own switch, separate from Game details. Stats, playtime and hours come from Game details; the inventory setting only matters for features that read your skins and estimate their value. Keeping the inventory private while game details are public is a common and sensible combination.",
  },
  {
    q: "How long after going public until stat sites can see me?",
    a: "Steam applies the change almost immediately, but trackers cache what they last saw, so the old private state can linger on their side. Re-run the lookup after a few minutes — if a site still shows you as private, its cached copy simply has not expired yet.",
  },
  {
    q: "Does signing in through Steam give a site my private data?",
    a: "No. Steam sign-in only proves which account is yours — it hands the site your SteamID, not your password and not your private data. Services that need your match history, such as Leetify, ask you separately for match share codes or an auth token that you explicitly grant and can revoke.",
  },
];

export default function Page() {
  return (
    <GuideArticle guide={g} faq={FAQ}>
      <p>{`If a stat site says your CS2 profile is private, the cause is almost always one Steam setting: Game details. Steam splits privacy into several independent switches, and the one that gates playtime and game stats ships locked-down on many accounts — plenty of players have never touched it. Set Game details to Public and most trackers, ${SITE_NAME} included, can read you within minutes. Here is which switch does what, how to flip it, and what you actually give up.`}</p>

      <h2>Steam privacy is several switches, not one</h2>
      <p>{`Steam does not have a single public/private toggle. On the Privacy Settings page each area of your account gets its own three-way choice — Private, Friends Only, or Public — and they matter very differently to a stat site:`}</p>
      <table>
        <thead>
          <tr>
            <th>Setting</th>
            <th>What it controls</th>
            <th>If it is not Public</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>My profile</td>
            <td>{`The master switch: your profile page, name history, level, badges`}</td>
            <td>{`Everything is hidden — the settings below never even come into play`}</td>
          </tr>
          <tr>
            <td>Game details</td>
            <td>{`Your list of games, hours played, achievements, in-game stats`}</td>
            <td>{`Trackers cannot see CS2 hours or performance data — the usual culprit`}</td>
          </tr>
          <tr>
            <td>Inventory</td>
            <td>{`Your items, cases and skins`}</td>
            <td>{`Inventory-value features stay blank; stats are unaffected`}</td>
          </tr>
          <tr>
            <td>Friends list</td>
            <td>{`Who you are friends with`}</td>
            <td>{`Nothing stat-related — safe to keep private forever`}</td>
          </tr>
        </tbody>
      </table>
      <p>{`There is one more trap: under Game details sits a separate checkbox, "Always keep my total playtime private even if users can see my game details." Tick that and your library shows but your hours do not — which is why a tracker can list your games yet still show no CS2 playtime.`}</p>

      <h2>What a stat site can and cannot read</h2>
      <p>{`Third-party trackers never log in to your account. They read Steam's public Web API, which returns exactly what a logged-out stranger browsing your profile would see — nothing more. Your privacy settings are the whole story: no legitimate site can reach past them, and none of them need your password.`}</p>
      <p>{`A small amount of data stays visible regardless. VAC and game-ban status is exposed even for fully private profiles, which is why ban checkers work on anyone. Most everything else — hours, game list, achievements, per-game stats, inventory — follows your switches. And note that Valve's Premier rating never comes from the Steam profile API at all; sites surface it through match data platforms, which is a separate pipeline again.`}</p>

      <h2>FACEIT and Leetify have their own privacy, not Steam's</h2>
      <p>
        {`A private Steam profile does not hide your FACEIT career. FACEIT is a separate platform with its own accounts and its own public API, so if you play there, your level, ELO and match history are visible through FACEIT no matter what Steam says — our guide to `}
        <Link href="/guides/faceit-levels-and-elo">FACEIT levels &amp; ELO</Link>
        {` covers what those numbers mean. The reverse holds for `}
        <Link href="/guides/good-leetify-rating">Leetify ratings</Link>
        {`: Leetify only has data for players who signed up and connected their matches, so no Steam setting can make a Leetify profile appear for an account that never used it.`}
      </p>
      <p>{`Practical upshot: on a tracker, one account can show a full FACEIT record next to an empty Steam column, or rich Steam hours next to no Leetify data. Each column reflects a different platform's privacy, not a bug.`}</p>

      <h2>Make your Game details public — step by step</h2>
      <ol>
        <li>{`Open Steam (the client or steamcommunity.com in a browser) and sign in.`}</li>
        <li>{`Click your username in the top bar and choose Profile, then hit Edit Profile.`}</li>
        <li>{`Open Privacy Settings in the left-hand menu.`}</li>
        <li>{`Set My profile to Public. This is the master switch — nothing else applies until it is public.`}</li>
        <li>{`Set Game details to Public.`}</li>
        <li>{`Untick "Always keep my total playtime private" just below it, or your hours stay hidden anyway.`}</li>
        <li>{`Leave Inventory and Friends list on whatever you prefer — neither blocks stats.`}</li>
      </ol>
      <p>{`Changes save as you click; there is no confirm button to hunt for. Steam applies them near-instantly, but a tracker that already cached your profile as private may need a fresh lookup before it notices.`}</p>

      <h2>{`What "this profile is private" really means on a tracker`}</h2>
      <p>{`It means one thing: the site asked Steam for your data and got nothing back. It is not a ban, not an error on the site, and not something a tracker can work around — a blank response is all Steam gives anyone about a private profile. It also is not always the whole profile: a public profile with private game details produces the same effect for stats, which trips people up because the profile page itself looks perfectly visible.`}</p>

      <h2>The honest trade-off</h2>
      <p>{`Going public is not free, and staying private is a perfectly legitimate choice. A public Game details setting lets anyone — not just stat sites — see your hours and your full library. A public inventory lets strangers estimate what your skins are worth, which is exactly the information trading scammers use to pick targets. If any of that bothers you, keep it private: you simply will not be trackable, and the sites will show blanks instead of stats. Nothing worse happens.`}</p>
      <p>{`For most players who want their stats visible, the sensible middle is: profile and Game details public, playtime checkbox unticked, inventory and friends list private. That gives trackers everything they need and keeps the scam-relevant data out of sight.`}</p>

      <h2>How {SITE_NAME} handles private profiles</h2>
      <p>
        {`${SITE_NAME} shows what is public and marks the rest as unavailable rather than guessing. A private Steam profile can still display a full FACEIT column, and ban status still resolves; missing data is presented as missing, never filled in. That caution carries into the CheatMeter: thin data means less certainty, so a private profile is treated as unknown — one of the reasons our guide to `}
        <Link href="/guides/spotting-smurfs-and-cheaters">
          spotting smurfs &amp; cheaters
        </Link>
        {` insists that signals are only ever "worth a closer look", never a verdict. How we source data — and how to get your profile removed from ${SITE_NAME} if you would rather not appear at all — is covered on the `}
        <Link href="/about">about page</Link>.
      </p>
      <p>
        Once your game details are public, paste your SteamID, vanity name or
        profile URL into <Link href="/">{SITE_NAME}</Link> to confirm everything
        resolves — or line your account up against a friend in the{" "}
        <Link href="/compare">comparison tool</Link>.
      </p>
    </GuideArticle>
  );
}
