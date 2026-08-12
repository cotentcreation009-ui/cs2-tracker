import type { Metadata } from "next";
import Link from "next/link";
import { guideBySlug } from "@/lib/guides";
import { SITE_NAME } from "@/lib/site";
import { GuideArticle } from "@/components/guide/GuideArticle";

const g = guideBySlug("cs2-rating-systems-compared")!;

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
    q: "Can you convert FACEIT ELO to a Premier CS Rating?",
    a: "No — they are separate ladders with different player pools and different maths, so there is no official or reliable mapping between them. Community rules of thumb exist, but they drift as both systems change. The useful move is to view the two side by side as a consistency check rather than convert one into the other.",
  },
  {
    q: "What is a good HLTV 2.0 rating?",
    a: "By design, 1.00 is an average professional performance, so anything sustained above that is good in pro context. Star players hold roughly 1.10 or higher across a season, and the best individual years in Counter-Strike history have landed around 1.2 to 1.3. The number only exists for pro matches — it is not calculated for your matchmaking games.",
  },
  {
    q: "Why is my Leetify rating positive while my Premier rating is falling?",
    a: "Because they measure different things. Leetify grades your per-match impact against the average player in your lobbies, while CS Rating only counts whether your team won. Playing well on a losing team moves the two in opposite directions — which usually means your level is fine and your recent results are the problem.",
  },
  {
    q: "Which number should I track to improve?",
    a: "Use Leetify to decide what to work on, since it breaks your game into sub-skills, and use your ladder of choice — Premier or FACEIT — to confirm the work is paying off. Judge trends over 10–20 matches rather than any single game.",
  },
];

export default function Page() {
  return (
    <GuideArticle guide={g} faq={FAQ}>
      <p>{`Counter-Strike 2 players get graded by at least four different numbers: the Leetify rating, the HLTV 2.0 rating, Valve's Premier CS Rating and FACEIT ELO. They are often quoted as if they were interchangeable, but they measure different things on different scales, and none of them converts into another. The short version: Leetify measures your impact per match around a zero average, HLTV 2.0 benchmarks professionals against a 1.00 baseline, and CS Rating and FACEIT ELO are ladders that track wins and losses. Which one deserves your attention depends entirely on the question you are asking.`}</p>

      <h2>The four numbers at a glance</h2>
      <table>
        <thead>
          <tr>
            <th>System</th>
            <th>What it grades</th>
            <th>Scale</th>
            <th>Good looks like</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Leetify rating</td>
            <td>Impact per match, vs your own lobbies</td>
            <td>Percentage around 0, positive or negative</td>
            <td>Consistently above 0</td>
          </tr>
          <tr>
            <td>HLTV 2.0</td>
            <td>Pro match performance</td>
            <td>Centred on 1.00</td>
            <td>1.10+ sustained against top teams</td>
          </tr>
          <tr>
            <td>Premier CS Rating</td>
            <td>Wins and losses in Valve matchmaking</td>
            <td>Ladder, low thousands to 30,000+</td>
            <td>Climbing over a season</td>
          </tr>
          <tr>
            <td>FACEIT ELO</td>
            <td>Wins and losses on FACEIT</td>
            <td>Ladder, from 100 with no cap</td>
            <td>Level 10 starts at 2,001</td>
          </tr>
        </tbody>
      </table>
      <p>{`The deepest split in that table is between the first two rows and the last two. Leetify and HLTV 2.0 are performance ratings — they grade how you played. CS Rating and FACEIT ELO are ladders — they count whether you won. Everything else about the scales follows from that.`}</p>

      <h2>Leetify rating: impact, centred on zero</h2>
      <p>{`The Leetify rating is a percentage-impact number centred on zero. A rating of 0 means you contributed about as much round-winning impact as an average player in the same matches; +2 means roughly two percentage points more than that average, and −2 the same amount less. Most games land within a few points either side of zero, and only genuinely dominant or disastrous ones stretch far beyond that.`}</p>
      <p>
        {`Two properties make it the right tool for self-improvement. First, it is relative to your own level, so it stays meaningful whether you queue at 5,000 or 25,000 Premier. Second, it is a per-match measure, so a rolling average over recent games responds quickly when part of your play changes. Paired with its sub-skills — aim, utility, positioning and the rest — it can tell you what to fix, which a ladder number never can. We cover reading it in depth in the guide to `}
        <Link href="/guides/good-leetify-rating">
          what counts as a good Leetify rating
        </Link>
        .
      </p>

      <h2>HLTV 2.0: the pro benchmark</h2>
      <p>{`HLTV 2.0 is the number the professional scene runs on. It condenses a player's performance into a single figure built from kills and deaths per round, damage per round, KAST (the share of rounds with a kill, assist, survival or trade) and a round-impact component — all normalized so that 1.00 is an average professional performance. HLTV has revised the formula over the years, including a newer 3.0 iteration, but the anchor has stayed the same: 1.00 is average, above it is good, below it is poor.`}</p>
      <p>{`Context matters enormously at the top. Sustaining roughly 1.10 or higher across a season against elite opposition is star territory, and the best individual years in the game's history have landed somewhere around 1.2 to 1.3. But a 1.15 farmed against weak teams means far less than a 1.05 earned in playoffs against the best sides in the world — which is why serious pro analysis always reads the rating next to the opposition faced.`}</p>
      <p>{`One thing HLTV 2.0 is not: a matchmaking stat. It exists to compare professionals on broadcast matches, and nothing about your own games maps onto it.`}</p>

      <h2>Premier CS Rating: Valve&apos;s ladder</h2>
      <p>{`Valve's Premier CS Rating is a different animal entirely — a ladder number, not a performance grade. A set of placement matches seeds your rating, then every win adds points and every loss removes them, with the size of the swing shaped by the matchup. It says nothing about how you played: a 3-kill game in a win moves you up, and a 30-bomb in a loss moves you down.`}</p>
      <p>{`The number runs from the low thousands for new or struggling accounts to 30,000 and beyond for leaderboard players, and as of recent seasons the badge changes color in 5,000-point bands — grey at the bottom, up through blues, purple, pink and red, with gold reserved for 30,000+. Ratings also recalibrate between Premier seasons, so a mid-season number and a fresh post-reset one are not directly comparable either.`}</p>

      <h2>FACEIT ELO: the third-party ladder</h2>
      <p>
        {`FACEIT ELO is the same species as CS Rating — a ladder that moves roughly 25 points per match, up on wins and down on losses — but it lives on a separate platform with its own population and its own maths. The scale starts at 100, has no upper cap, and drives the familiar 1–10 level badges, with level 10 beginning at 2,001. The full level table and the win/loss maths are in our `}
        <Link href="/guides/faceit-levels-and-elo">
          FACEIT levels and ELO guide
        </Link>
        .
      </p>

      <h2>Why the scales don&apos;t convert</h2>
      <p>{`It is tempting to look for an exchange rate — what Premier rating equals 2,500 FACEIT ELO? — but no honest one exists, for three structural reasons.`}</p>
      <ol>
        <li>{`Performance versus ladder. Leetify and HLTV 2.0 grade how you play, per round and per match. CS Rating and FACEIT ELO count whether you win, cumulatively. A strong player on a losing streak diverges across the two kinds of number by design.`}</li>
        <li>{`Different reference populations. Leetify compares you with the players in your own matches; HLTV 2.0 compares professionals with other professionals; each ladder ranks you only within that platform's player pool. FACEIT's pool, for instance, skews more competitive than Valve matchmaking, so the "same" skill level sits at a different-looking number on each ladder.`}</li>
        <li>{`Different time horizons. A Leetify or HLTV rating exists for a single match and only stabilizes as an average, while a ladder number is the accumulated result of your whole recent history. One is a snapshot; the other is a running total.`}</li>
      </ol>
      <p>
        {`The practical consequence: treat cross-system comparisons as a consistency check, not a conversion. A player whose FACEIT ELO and Premier rating tell wildly different stories is not a maths error — it is one of the signals worth a closer look that we walk through in the guide to `}
        <Link href="/guides/spotting-smurfs-and-cheaters">
          spotting smurfs and cheaters
        </Link>
        .
      </p>

      <h2>Which number answers which question</h2>
      <p>{`Pick the instrument to match the question:`}</p>
      <ul>
        <li>{`Improving your own game: Leetify. It is the only one of the four that decomposes into fixable parts, and its zero-centred scale makes "above or below my lobby's average?" instantly readable.`}</li>
        <li>{`Knowing where you stand: Premier CS Rating or FACEIT ELO, on whichever ladder you actually queue. A ladder is the honest answer to "what level am I?", because it is earned against real opposition over many matches.`}</li>
        <li>{`Reading an opponent: cross-reference the ladders plus recent form. One number from one platform is thin evidence; the same story told by two ladders and a recent performance trend is a solid read.`}</li>
        <li>{`Following the pro scene: HLTV 2.0, always read alongside the opposition faced. No matchmaking number belongs in that conversation.`}</li>
      </ul>

      <h2>See them side by side</h2>
      <p>
        Holding these systems next to each other is exactly what {SITE_NAME} is
        built for. Run any account through the{" "}
        <Link href="/">homepage lookup</Link> and the profile shows Premier CS
        Rating, FACEIT level and ELO, and Leetify rating side by side — so an
        odd gap between ladders, or a reassuring agreement, is visible at a
        glance. To weigh two accounts against each other, the{" "}
        <Link href="/compare">comparison tool</Link> puts both sets of numbers
        in one table, and the <Link href="/pro-matches">pro matches</Link>{" "}
        section follows the scene where HLTV-style ratings live.
      </p>
    </GuideArticle>
  );
}
