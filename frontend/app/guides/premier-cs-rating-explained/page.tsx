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

// Every figure below traces to the read-only aggregates pulled from production
// on 2026-10-08 (935 Premier-rated players, 1,381 games with a recorded rating
// change). Update the numbers and the date together.
const DATA_DATE = "8 October 2026";

const FAQ = [
  {
    q: "What is the average CS Rating in Premier?",
    a: "Among the 935 Premier-rated players tracked by CSRun through 8 October 2026, the median rating is 16,513 — just inside the purple band. A quarter of players sit below 9,190 and a quarter above 24,712. Valve publishes no official distribution, and our sample skews toward players who get looked up, so treat the median as a reference point rather than a population figure.",
  },
  {
    q: "Is 20,000 CS Rating good?",
    a: "Yes. In our data 20,000 sits between the median (16,513) and the 75th percentile (24,712), so a 20,000 player is in roughly the top 35–40% of rated accounts we track. The pink band (20,000–24,999) holds 18.7% of the players in the sample.",
  },
  {
    q: "How many points do you gain or lose per Premier match?",
    a: "Across 1,381 games with a recorded change, the median gain was 306 points and the median loss 247. The size depends on your band: moves under 5,000 averaged around 150–165 points, moves between 5,000 and 20,000 averaged roughly 300–345, and moves above 25,000 averaged 230–240.",
  },
  {
    q: "How many games does it take to climb 5,000 CS Rating?",
    a: "With the averages in this guide, a player winning 55% of games in the 10,000–14,999 band nets about +45 points per game, so a 5,000-point band is roughly 110 games. Above 25,000 the same win rate nets about +19 per game, closer to 260 games. At a 50% win rate the expected change is near zero at every band.",
  },
  {
    q: "Do higher-rated players have a higher K/D?",
    a: "Not by much, because the lobbies get harder at the same time. Per-game K/D in our data sits between 1.00 and 1.12 from the grey band through purple, dips to 1.01 in pink, and only clearly rises in red (1.24). Preaim is the stat that improves steadily with rating, from 11.8 degrees under 5,000 to 8.9 degrees in the red band.",
  },
];

export default function Page() {
  return (
    <GuideArticle guide={g} faq={FAQ}>
      <p>{`Valve shows you a CS Rating but never tells you where it sits. This guide answers that with ${SITE_NAME}'s own data: the ratings of 935 Premier-rated players we track, the per-game numbers behind each color band, and how far a single win or loss actually moves the figure. The headline: the median tracked player sits at 16,513, a quarter of players are above 24,712, and one in ten is above 27,003. Everything else is below, with the sample size and date next to every table.`}</p>

      <h2>A one-paragraph refresher on how the rating works</h2>
      <p>
        {`Premier is CS2's ranked queue with a map pick-ban phase and first-to-13 rounds; CS Rating is the number it ranks you with. You get a visible rating after ten Premier wins, the number moves up on a win and down on a loss by an amount Valve does not publish, and the badge changes color every 5,000 points: grey under 5,000, light blue, blue, purple, pink and red in 5,000-point steps, then gold at 30,000 and above. Ratings recalibrate between seasons. How CS Rating differs from FACEIT ELO, the Leetify rating and HLTV 2.0 is a separate question, covered in `}
        <Link href="/guides/cs2-rating-systems-compared">
          the rating systems comparison
        </Link>
        {`. This guide is only about where a rating sits and what moves it.`}
      </p>

      <h2>Where the ratings sit: percentiles</h2>
      <p>{`We took the most recent Premier rating recorded for each of the 935 players in our match database who have one, and sorted them. The percentiles:`}</p>
      <table>
        <thead>
          <tr>
            <th>Percentile</th>
            <th>CS Rating</th>
            <th>Band</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>10th</td>
            <td>3,689</td>
            <td>Grey</td>
          </tr>
          <tr>
            <td>25th</td>
            <td>9,190</td>
            <td>Light blue</td>
          </tr>
          <tr>
            <td>50th (median)</td>
            <td>16,513</td>
            <td>Purple</td>
          </tr>
          <tr>
            <td>75th</td>
            <td>24,712</td>
            <td>Pink</td>
          </tr>
          <tr>
            <td>90th</td>
            <td>27,003</td>
            <td>Red</td>
          </tr>
          <tr>
            <td>99th</td>
            <td>30,325</td>
            <td>Gold</td>
          </tr>
          <tr>
            <td>Highest tracked</td>
            <td>32,091</td>
            <td>Gold</td>
          </tr>
        </tbody>
      </table>
      <p>
        <em>{`${SITE_NAME} data, latest rating for each of 935 Premier-rated players, tracked through ${DATA_DATE}.`}</em>
      </p>
      <p>{`Two things stand out. The spread is enormous: the gap between the 10th and 90th percentiles is more than 23,000 points, so "I am 15,000" and "I am 25,000" describe very different players even though both are mid-table on the color scale. And the top compresses hard: the 90th percentile is 27,003 but the 99th is only 30,325, meaning the entire red band and the start of gold hold the top tenth of players in a window of about 3,300 points.`}</p>

      <h2>Share of players in each color band</h2>
      <table>
        <thead>
          <tr>
            <th>Band</th>
            <th>CS Rating</th>
            <th>Players</th>
            <th>Share</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Grey</td>
            <td>0 – 4,999</td>
            <td>136</td>
            <td>14.5%</td>
          </tr>
          <tr>
            <td>Light blue</td>
            <td>5,000 – 9,999</td>
            <td>119</td>
            <td>12.7%</td>
          </tr>
          <tr>
            <td>Blue</td>
            <td>10,000 – 14,999</td>
            <td>157</td>
            <td>16.8%</td>
          </tr>
          <tr>
            <td>Purple</td>
            <td>15,000 – 19,999</td>
            <td>133</td>
            <td>14.2%</td>
          </tr>
          <tr>
            <td>Pink</td>
            <td>20,000 – 24,999</td>
            <td>175</td>
            <td>18.7%</td>
          </tr>
          <tr>
            <td>Red</td>
            <td>25,000 – 29,999</td>
            <td>202</td>
            <td>21.6%</td>
          </tr>
          <tr>
            <td>Gold</td>
            <td>30,000+</td>
            <td>13</td>
            <td>1.4%</td>
          </tr>
        </tbody>
      </table>
      <p>
        <em>{`${SITE_NAME} data, 935 Premier-rated players, tracked through ${DATA_DATE}.`}</em>
      </p>
      <p>{`Red is the single most common band in our sample, which is not what the color scale suggests and needs an honest caveat. Our database holds players whose matches were pulled in because someone looked them up, compared them, or analyzed a game they were in. That skews toward active, engaged accounts and toward the kind of player people are curious about, so the top bands are over-represented relative to everyone who has ever queued Premier. The percentiles above are the shape of the tracked population, not Valve's. Valve does not publish a distribution, and nobody outside Valve has one.`}</p>
      <p>{`Read the table as a ladder of company rather than a census: if you are in blue, roughly a quarter of the players you will meet on this site are below you and the rest are above; if you are in red, you are in the top third of tracked accounts and the top 10% starts at about 27,000.`}</p>

      <h2>What players in each band actually do per game</h2>
      <p>{`For games where we know the player's rating at the end of the match, we averaged the per-game numbers by band. These are per-game figures from Leetify-sourced matches, so K/D is kills divided by deaths in that game, DPR is damage per round, preaim is the average angle in degrees between the crosshair and the enemy at the moment the enemy becomes visible (lower is better), and the Leetify rating is the per-game impact figure centered on zero.`}</p>
      <table>
        <thead>
          <tr>
            <th>Band</th>
            <th>Games</th>
            <th>K/D</th>
            <th>DPR</th>
            <th>Preaim (deg)</th>
            <th>Leetify rating</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Grey (0 – 4,999)</td>
            <td>160</td>
            <td>1.00</td>
            <td>75.6</td>
            <td>11.8</td>
            <td>−0.42</td>
          </tr>
          <tr>
            <td>Light blue</td>
            <td>168</td>
            <td>1.10</td>
            <td>74.6</td>
            <td>11.0</td>
            <td>−0.18</td>
          </tr>
          <tr>
            <td>Blue</td>
            <td>206</td>
            <td>1.12</td>
            <td>80.9</td>
            <td>9.4</td>
            <td>+0.32</td>
          </tr>
          <tr>
            <td>Purple</td>
            <td>180</td>
            <td>1.11</td>
            <td>76.6</td>
            <td>9.9</td>
            <td>−0.05</td>
          </tr>
          <tr>
            <td>Pink</td>
            <td>239</td>
            <td>1.01</td>
            <td>71.7</td>
            <td>9.0</td>
            <td>−0.76</td>
          </tr>
          <tr>
            <td>Red</td>
            <td>429</td>
            <td>1.24</td>
            <td>78.2</td>
            <td>8.9</td>
            <td>+0.54</td>
          </tr>
          <tr>
            <td>Gold (30,000+)*</td>
            <td>20</td>
            <td>2.64</td>
            <td>72.3</td>
            <td>5.9</td>
            <td>+4.49</td>
          </tr>
        </tbody>
      </table>
      <p>
        <em>{`${SITE_NAME} data, 1,402 Premier games with a known end-of-game rating, tracked through ${DATA_DATE}. *The gold row is 20 games from 13 players and should be read as an anecdote, not an average. Head-shot accuracy was exported rounded to the nearest ten percent (about 10% of hits in grey, about 20% in every band from light blue to red), so it is omitted from the table.`}</em>
      </p>
      <p>{`The surprise for most readers is how flat the fragging numbers are. K/D barely moves from grey (1.00) to purple (1.11), damage per round hovers between 72 and 81 in every band, and pink is actually the weakest band on both. That is not because pink players are worse than blue players; it is because Premier matches you against your own band, so a pink player's 1.01 is earned against pink opponents while a blue player's 1.12 is earned against blue ones. Per-game stats measure you relative to your lobby, and the lobby rises with you.`}</p>
      <p>
        {`The number that does climb cleanly with rating is preaim: 11.8 degrees in grey, 11.0 in light blue, around 9 to 10 through blue and purple, 9.0 in pink and 8.9 in red. Crosshair placement is the mechanical skill the ladder sorts on most reliably, which matches what we see elsewhere; `}
        <Link href="/guides/crosshair-placement-and-preaim">
          the preaim and crosshair placement guide
        </Link>
        {` explains what the degrees mean and how to move them. The red band also posts the best K/D (1.24) and Leetify rating (+0.54) outside the tiny gold sample, which is consistent with red lobbies containing a wider mix of rating than the band label suggests: the 90th percentile sits inside red, so a red lobby can pair a 25,000 player with a 29,000 one.`}
      </p>

      <h2>How far one game moves your rating</h2>
      <p>{`Across 1,381 tracked games where the rating changed, 707 were gains and 674 were losses. The median gain was 306 points and the median loss 247; the averages are closer together at 265 and 261, because a few small-gain games pull the average down while the typical win pays about 300. Broken down by band:`}</p>
      <table>
        <thead>
          <tr>
            <th>Band</th>
            <th>Games</th>
            <th>Average gain</th>
            <th>Average loss</th>
            <th>Games that gained</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Grey (0 – 4,999)</td>
            <td>155</td>
            <td>+163</td>
            <td>−147</td>
            <td>51.0%</td>
          </tr>
          <tr>
            <td>Light blue</td>
            <td>167</td>
            <td>+319</td>
            <td>−346</td>
            <td>53.9%</td>
          </tr>
          <tr>
            <td>Blue</td>
            <td>210</td>
            <td>+313</td>
            <td>−282</td>
            <td>51.9%</td>
          </tr>
          <tr>
            <td>Purple</td>
            <td>171</td>
            <td>+306</td>
            <td>−307</td>
            <td>50.3%</td>
          </tr>
          <tr>
            <td>Pink</td>
            <td>229</td>
            <td>+301</td>
            <td>−265</td>
            <td>46.3%</td>
          </tr>
          <tr>
            <td>Red</td>
            <td>431</td>
            <td>+230</td>
            <td>−239</td>
            <td>51.5%</td>
          </tr>
          <tr>
            <td>Gold (30,000+)*</td>
            <td>18</td>
            <td>+164</td>
            <td>−204</td>
            <td>83.3%</td>
          </tr>
        </tbody>
      </table>
      <p>
        <em>{`${SITE_NAME} data, 1,381 Premier games with a recorded rating change, tracked through ${DATA_DATE}. *18 games; the 83% gain share is noise, not a property of the gold band.`}</em>
      </p>
      <p>{`Three patterns are worth knowing before you queue. First, the ladder is cheapest to move in the middle: from light blue through pink a typical game is worth about 300 points either way, while under 5,000 the moves are half that size (about 150–165) and above 25,000 they shrink to about 230–240. Second, gains and losses are close to symmetric in every band. Light blue is the one place losses (346) outweigh gains (319), and pink is the one place gains (301) clearly outweigh losses (265). Third, the share of games that gained sits within a few points of 50% in every band with a real sample, which is what a matchmaker that balances lobbies should produce. Pink's 46.3% is the lowest, and together with pink's weak per-game stats it suggests the 20,000–24,999 band is where a lot of tracked players are stalling.`}</p>

      <h2>What that implies about climbing</h2>
      <p>{`Because the per-game moves are nearly symmetric and the gain share is near 50%, the expected change per game is close to zero unless you win more than half your games. The arithmetic from the table above, for a player winning 55% of games:`}</p>
      <ul>
        <li>{`Blue (10,000–14,999): 0.55 × 313 − 0.45 × 282 = about +45 points per game, so roughly 110 games to cross a 5,000-point band.`}</li>
        <li>{`Pink (20,000–24,999): 0.55 × 301 − 0.45 × 265 = about +46 per game, also roughly 110 games per band.`}</li>
        <li>{`Red (25,000–29,999): 0.55 × 230 − 0.45 × 239 = about +19 per game, closer to 260 games per band.`}</li>
      </ul>
      <p>{`Those are illustrations built from averages, not a formula, and the real swings in a single week are far noisier: a ten-game run of losses in blue is a 2,800-point hole on the medians. But the shape is reliable. A rating moves on win rate, win rate in Premier is close to 50% by design, and the lever you control is the few percentage points above 50% that better crosshair placement, utility and decision-making buy you. The climb from 25,000 upward is slow for everyone, because the points per game drop at the same time as the opponents get harder.`}</p>
      <p>{`The flip side is reassurance: a rating that falls 1,000 points over a bad evening is three or four typical losses, not a verdict. Judge the trend over 20 or more games.`}</p>

      <h2>See where any player sits</h2>
      <p>
        {`Paste a Steam profile link or SteamID into `}
        <Link href="/">{SITE_NAME}</Link>
        {` and the profile shows the account's current CS Rating with its band and, when we have it, the rating history behind it, next to the FACEIT level, `}
        <Link href="/guides/good-leetify-rating">Leetify rating</Link>
        {` and Steam signals. To settle a who-is-higher argument, put two accounts into the `}
        <Link href="/compare">comparison tool</Link>
        {`. If you want to know how CS Rating compares with FACEIT ELO rather than where it sits, that is `}
        <Link href="/guides/cs2-rating-systems-compared">
          the rating systems comparison
        </Link>
        {`; and the matchmaking-side skill groups that many players still hold alongside a Premier rating are covered, with our cross table, in `}
        <Link href="/guides/faceit-vs-premier-vs-mm">
          the queue comparison
        </Link>
        {`.`}
      </p>
    </GuideArticle>
  );
}
