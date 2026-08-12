import type { Metadata } from "next";
import Link from "next/link";
import { guideBySlug } from "@/lib/guides";
import { SITE_NAME } from "@/lib/site";
import { GuideArticle } from "@/components/guide/GuideArticle";

const g = guideBySlug("premier-cs-rating-explained")!;

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
    q: "How many wins do you need to get a CS Rating?",
    a: "Ten Premier wins. Losses do not advance the counter, so calibration can take well over ten matches. The matches you play along the way still shape the number you eventually receive, which is why two players can come out of placement with very different starting ratings.",
  },
  {
    q: "What is the highest CS Rating in CS2?",
    a: "There is no published cap. The gold band starts at 30,000, and the top of the world leaderboard has sat comfortably above that in recent seasons — the exact peak shifts from season to season as the ladder stretches out.",
  },
  {
    q: "Do you lose CS Rating when you lose a match?",
    a: "Yes. The size of the drop varies with how the system currently reads you — typically anywhere from a few dozen to a few hundred points. Losses tend to cost more when the system already suspects your rating is higher than your results justify, and less when you are on the way up.",
  },
  {
    q: "Is CS Rating the same as the old Global Elite ranks?",
    a: "No. The Silver-to-Global-Elite skill groups still exist in CS2, but per map in regular Competitive. Premier replaced them with the numeric CS Rating, and there is no official conversion between the two systems.",
  },
];

export default function Page() {
  return (
    <GuideArticle guide={g} faq={FAQ}>
      <p>{`Premier is Counter-Strike 2's flagship ranked mode, and CS Rating is the number it ranks you with. Instead of the old badge-style skill groups, Premier shows a figure that runs from the low thousands to beyond 30,000, colored by band — closer to a visible ELO than a rank icon. Here is how the rating is earned, how it moves, and what a good number actually looks like.`}</p>

      <h2>What Premier mode actually is</h2>
      <p>{`Premier is the structured competitive queue inside CS2. Matches are first to 13 rounds, and a 12–12 tie is settled in overtime rather than left as a draw. Games are played on the Active Duty map pool — the same seven maps the professional circuit uses — and before each match the two teams take turns knocking maps out of the pool in a short pick-ban phase, so nobody gets forced onto a map they refuse to play.`}</p>
      <p>{`Premier requires Prime status, and it sits on its own ladder. The per-map skill groups (Silver through Global Elite) still live in regular Competitive; Premier replaces them with a single account-wide number, your CS Rating.`}</p>

      <h2>The ten calibration wins</h2>
      <p>{`A fresh account starts with no visible rating: you must win ten Premier matches before your CS Rating is displayed. The counter only advances on wins, so a rough stretch of losses can drag calibration well past ten games. Every match you play still feeds the system's estimate of where you belong, which is why two players can finish their tenth win with very different starting numbers.`}</p>
      <p>{`Expect the figure to stay volatile just after placement. The system is still narrowing down its estimate, so your first rated wins and losses move you much further than they will fifty matches later.`}</p>

      <h2>How CS Rating moves on a win or a loss</h2>
      <p>{`Valve has never published the formula, so treat any exact per-match figure you see quoted as a community estimate. The broad shape is well established, though: a win adds points, a loss subtracts them, and the size of the move varies a lot — anywhere from a few dozen points to several hundred in a single match. Swings are largest while the system is uncertain about you, meaning early matches or the weeks right after a seasonal reset, and they settle down as your rating stabilizes.`}</p>
      <p>{`The adjustment is not symmetric either. If your results say you are better than your current number, wins pay generously and losses cost little; once you sit where the system thinks you belong, gains and losses roughly even out. The scoreline also appears to factor in — a 13–2 stomp and a 13–11 scrape are not treated identically.`}</p>

      <h2>The color bands</h2>
      <p>{`Your rating is displayed inside a colored band. The colors are purely cosmetic, but the whole community uses them as shorthand:`}</p>
      <table>
        <thead>
          <tr>
            <th>Band</th>
            <th>CS Rating range</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Grey</td>
            <td>Under 5,000</td>
          </tr>
          <tr>
            <td>Light blue</td>
            <td>5,000 – 9,999</td>
          </tr>
          <tr>
            <td>Blue</td>
            <td>10,000 – 14,999</td>
          </tr>
          <tr>
            <td>Purple</td>
            <td>15,000 – 19,999</td>
          </tr>
          <tr>
            <td>Pink</td>
            <td>20,000 – 24,999</td>
          </tr>
          <tr>
            <td>Red</td>
            <td>25,000 – 29,999</td>
          </tr>
          <tr>
            <td>Gold</td>
            <td>30,000+</td>
          </tr>
        </tbody>
      </table>
      <p>{`The bands carry no gameplay or reward differences — a 14,900 player and a 15,100 player queue in exactly the same pool. But because the color is what teammates and opponents see at a glance, the band boundaries are where all the rating anxiety lives.`}</p>

      <h2>What counts as a good CS Rating?</h2>
      <p>{`Valve does not publish distribution data, so any precise percentile you read online is a third-party estimate rather than an official figure. As a rough map of the ladder:`}</p>
      <ul>
        <li>{`Grey (under 5,000): newer players, or accounts still finding their level after calibration.`}</li>
        <li>{`Light blue and blue (5,000–14,999): the broad middle of the active player base — dependable fundamentals, nothing to apologize for.`}</li>
        <li>{`Purple (15,000–19,999): clearly strong, comfortably above the typical Premier player.`}</li>
        <li>{`Pink (20,000–24,999): very strong — a small minority of the ladder.`}</li>
        <li>{`Red (25,000–29,999): the doorstep of the elite.`}</li>
        <li>{`Gold (30,000+): leaderboard territory, running up to semi-pro and professional players.`}</li>
      </ul>
      <p>{`Anything purple or above is a rating most players never reach. If you are climbing out of blue, you are already ahead of a large share of the people who queue Premier at all.`}</p>

      <h2>Regional and world leaderboards</h2>
      <p>{`Premier feeds public leaderboards: a world list and per-region lists of the highest-rated players, visible in the game and on Valve's website. Staying listed requires recent activity, so the boards reflect who is actually playing rather than peak numbers from months ago. In practice the gold band and leaderboard territory overlap heavily — by the time you pass 30,000 you are competing for a named spot in your region.`}</p>

      <h2>Seasonal resets</h2>
      <p>{`Premier runs in seasons. When one ends, ratings are reset or recalibrated for the next, and you play a fresh set of calibration matches before your new number appears. How heavy the reset is — how much your old rating seeds the new one, and how long recalibration takes — has not been the same every time, so treat the details as changeable. Two practical takeaways hold regardless: expect a volatile number in a season's first weeks, and do not panic if you come back lower than where you left off. The ladder compresses at a reset and stretches back out as everyone recalibrates.`}</p>

      <h2>Premier vs FACEIT</h2>
      <p>
        Premier and FACEIT are separate ladders that do not convert cleanly.
        FACEIT is a third-party platform with its own ELO and ten-level system,
        its own client-side anti-cheat, and a player pool that skews toward the
        serious end; Premier is built into the game and covers everyone from
        casual to elite. The level table and the ELO maths live in our guide to{" "}
        <Link href="/guides/faceit-levels-and-elo">FACEIT levels &amp; ELO</Link>
        , and a large, unexplained gap between an account&apos;s two ladders is
        one of the tells we weigh up in{" "}
        <Link href="/guides/spotting-smurfs-and-cheaters">
          spotting smurfs &amp; cheaters
        </Link>
        .
      </p>

      <h2>See any player&apos;s Premier rating</h2>
      <p>
        Drop a Steam profile link — or a bare SteamID — into{" "}
        <Link href="/">{SITE_NAME}</Link> and it shows the account&apos;s Premier
        CS Rating with its color band, next to their FACEIT level,{" "}
        <Link href="/guides/good-leetify-rating">Leetify rating</Link> and Steam
        profile signals — one page instead of four tabs. To settle a who-is-higher
        argument, put two accounts side by side in the{" "}
        <Link href="/compare">comparison tool</Link>, or drop a Premier match
        into the <Link href="/demos">demo analyzer</Link> to see the game behind
        the rating change, round by round.
      </p>
    </GuideArticle>
  );
}
