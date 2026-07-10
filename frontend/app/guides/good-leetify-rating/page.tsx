import type { Metadata } from "next";
import Link from "next/link";
import { guideBySlug } from "@/lib/guides";
import { SITE_NAME } from "@/lib/site";
import { GuideArticle } from "@/components/guide/GuideArticle";

const g = guideBySlug("good-leetify-rating")!;

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
    q: "Is a higher Leetify rating always better?",
    a: "Yes — higher is better. But the rating is measured against the average player at your skill level, so a 'good' number for a level 5 looks different from a good number in top-tier lobbies. Judge it relative to your own rank.",
  },
  {
    q: "What is the difference between the Leetify Rating and the sub-skills?",
    a: "The Leetify Rating is your overall impact in one number. The sub-skills — aim, utility, positioning, opening duels, trading, clutches — show where that impact comes from, and are the most useful part for improving.",
  },
  {
    q: "Why is my Leetify rating different from my K/D?",
    a: "Because it measures impact, not raw frags. Trading a dead teammate, flashing someone into a kill, or saving a rifle all move your rating even though they never show up as extra kills in your K/D.",
  },
];

export default function Page() {
  return (
    <GuideArticle guide={g} faq={FAQ}>
      <p>{`Leetify grades Counter-Strike 2 performance far beyond the in-game scoreboard. Its headline number, the Leetify Rating, tries to answer one question: how much did you actually help your team win, compared with a typical player in the same matches?`}</p>

      <h2>What the Leetify Rating measures</h2>
      <p>{`The Leetify Rating rolls dozens of per-round contributions — trades, opening duels, utility damage, saves, clutches and more — into a single estimate of your overall impact. It is a relative measure: it compares you against the average player at your level, so "good" always means good for the company you are keeping, not an absolute score. Higher is better.`}</p>
      <p>{`Because it is impact-based, the rating rewards the quiet, winning plays a scoreboard misses: flashing a teammate into a free kill, trading a dead entry fragger, holding an angle that never gets tested. Two players with identical kills and deaths can end up with very different ratings.`}</p>

      <h2>The sub-skills: where your rating comes from</h2>
      <p>{`Under the headline number, Leetify breaks your game into sub-skills. Reading them together tells you far more than the single figure:`}</p>
      <ul>
        <li>{`Aim — how cleanly and quickly you win the duels you take: accuracy, reaction time, spray control and headshot quality.`}</li>
        <li>{`Utility — the value you squeeze from grenades: flash assists, HE and molotov damage, and how much enemy time your smokes cost.`}</li>
        <li>{`Positioning — whether you tend to be in the right place, winning fights on good terms and avoiding bad ones.`}</li>
        <li>{`Opening duels — how often you take the first fight of a round, and how often you win it.`}</li>
        <li>{`Trading and clutches — how reliably you trade dead teammates and close out uneven rounds.`}</li>
      </ul>

      <h2>So what is a &ldquo;good&rdquo; Leetify rating?</h2>
      <p>{`There is no universal pass mark, because the rating is always measured against your own skill level. A useful way to read it:`}</p>
      <ul>
        <li>{`Consistently above the average for your rank, across recent matches, is the real marker of a strong, well-rounded player.`}</li>
        <li>{`Sitting around the middle means you are pulling your weight for your level — perfectly healthy.`}</li>
        <li>{`Below-average stretches happen on bad days; a long run below the line is the signal that something — usually one sub-skill — is dragging you down.`}</li>
      </ul>
      <p>{`The most useful move is not to chase the headline number but to find your weakest sub-skill and fix that. A player with sharp aim and poor utility often climbs faster by throwing better smokes than by grinding another aim map.`}</p>

      <div className="callout">
        <p>{`Watch the trend, not a single match. One unlucky round or one smurf lobby will swing a single game; a rolling average over 10–20 matches is what actually reflects your level.`}</p>
      </div>

      <h2>Read your own numbers</h2>
      <p>
        Paste any SteamID, vanity name or profile URL into{" "}
        <Link href="/">{SITE_NAME}</Link> to see a player&apos;s Leetify rating and
        every sub-skill in one place — next to their FACEIT level, Premier rating
        and Steam identity. To study a single match in depth, the{" "}
        <Link href="/demos">demo analyzer</Link> breaks a game down round by round.
      </p>
    </GuideArticle>
  );
}
