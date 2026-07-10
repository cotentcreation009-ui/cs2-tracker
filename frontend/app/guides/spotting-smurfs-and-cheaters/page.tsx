import type { Metadata } from "next";
import Link from "next/link";
import { guideBySlug } from "@/lib/guides";
import { SITE_NAME } from "@/lib/site";
import { GuideArticle } from "@/components/guide/GuideArticle";

const g = guideBySlug("spotting-smurfs-and-cheaters")!;

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
    q: "Can you prove someone is cheating from their stats?",
    a: "No. Public stats can flag anomalies worth a closer look, but genuinely elite players produce anomalous numbers too. Stats narrow it down; they never prove it. If you are confident, report the account through Valve or FACEIT and let their systems decide.",
  },
  {
    q: "What is the difference between a smurf and a cheater?",
    a: "A smurf is a skilled player on a secondary, lower-ranked account — against the spirit of matchmaking, but not cheating. A cheater uses software such as an aimbot or wallhack for an unfair edge.",
  },
  {
    q: "Does a new Steam account mean someone is smurfing?",
    a: "Not on its own — new accounts are common and perfectly innocent. It is the combination that matters: a young account performing far above the level its hours and history suggest.",
  },
];

export default function Page() {
  return (
    <GuideArticle guide={g} faq={FAQ}>
      <p>{`Almost everyone has loaded into a match and wondered whether the player topping the scoreboard is a smurf, a cheater, or simply better than the lobby. The honest answer is that you usually cannot know for certain from the outside — but there are public signals that shift the odds, and a responsible way to read them.`}</p>

      <div className="callout">
        <p>{`One principle first: none of the signals below is proof. Legitimate, elite players trip several of them, and making a new account is not a crime. Treat all of this as "worth a closer look", never as a verdict — and settle disputes by reporting through Valve or FACEIT, not by accusing or harassing anyone in chat.`}</p>
      </div>

      <h2>Smurf or cheater — not the same question</h2>
      <p>{`They are different things. A smurf is a skilled player on a secondary, usually lower-ranked account: against the spirit of matchmaking, but not cheating. A cheater is using software — an aimbot, wallhack or triggerbot — for an unfair edge. The signals overlap, so it helps to keep the two questions separate as you look.`}</p>

      <h2>Signals that suggest a smurf</h2>
      <ul>
        <li>{`A young Steam account — created recently, with few games owned and low overall playtime.`}</li>
        <li>{`Skill that outstrips the account: clean movement, utility and game sense a genuine beginner would not have.`}</li>
        <li>{`A large gap between ladders — say a high FACEIT level next to a low or unranked Premier rating, or the reverse.`}</li>
        <li>{`A near-perfect recent win rate, as a stronger player climbs out of a rank they do not belong in.`}</li>
      </ul>
      <p>{`Any one of these is ordinary — plenty of people start a fresh account. It is the combination, especially a new account performing far above its apparent level, that points to a smurf.`}</p>

      <h2>Signals worth a closer look for cheating</h2>
      <p>{`Cheating is harder to read, because the strongest tells are also things top players do. Weigh these carefully rather than counting them:`}</p>
      <ul>
        <li>{`Statistical anomalies — reaction times, pre-aim or headshot consistency that sit outside the range even strong players show.`}</li>
        <li>{`Stats that do not travel — numbers that dominate in one place but fade where anti-cheat is stricter; a record that stays unnaturally uniform everywhere can be a flag too.`}</li>
        <li>{`A history of VAC or game bans on the account, or on clearly linked accounts.`}</li>
        <li>{`A sudden, sustained jump in performance with no matching change in hours played.`}</li>
      </ul>
      <p>{`Every one of these has an innocent explanation — a genuinely elite player will post anomalous numbers as well — which is exactly why no single figure should settle it.`}</p>

      <h2>How to weigh the signals fairly</h2>
      <p>{`The safe way to read anomalies is to look for a cluster rather than a single smoking gun, and to lower your confidence, not raise it, when the data is thin. A brand-new account with no match history simply cannot support a firm read. When something genuinely looks off, the constructive response is to report the account through the official Valve or FACEIT channels and let their anti-cheat systems review it — public accusations help no one and are often wrong.`}</p>

      <h2>How {SITE_NAME} helps you check</h2>
      <p>
        {SITE_NAME} pulls these public signals into one place so you can weigh them
        properly. Its <strong>CheatMeter</strong> combines the anomalies above into
        a single suspicion score — deliberately framed as a starting point for a
        closer look, not a verdict — alongside Steam trust signals like account age
        and VAC status, and the cross-platform rank gaps that hint at a smurf.
        Pair it with our guides on{" "}
        <Link href="/guides/faceit-levels-and-elo">FACEIT levels &amp; ELO</Link>{" "}
        and <Link href="/guides/good-leetify-rating">Leetify ratings</Link> to read
        what you find in context.
      </p>
      <p>
        Paste any SteamID or profile URL into <Link href="/">{SITE_NAME}</Link> to
        see all of it for a given account.
      </p>
    </GuideArticle>
  );
}
