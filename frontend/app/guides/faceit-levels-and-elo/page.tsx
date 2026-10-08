import type { Metadata } from "next";
import Link from "next/link";
import { guideBySlug } from "@/lib/guides";
import { SITE_NAME } from "@/lib/site";
import { GuideArticle } from "@/components/guide/GuideArticle";

const g = guideBySlug("faceit-levels-and-elo")!;

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

// FACEIT's published CS2 level thresholds. Width is the number of ELO points
// inside the level; "net wins" is width / 25, the typical even-lobby swing.
const LEVELS: [string, string, string, string][] = [
  ["1", "100 – 500", "401", "16"],
  ["2", "501 – 750", "250", "10"],
  ["3", "751 – 900", "150", "6"],
  ["4", "901 – 1,050", "150", "6"],
  ["5", "1,051 – 1,200", "150", "6"],
  ["6", "1,201 – 1,350", "150", "6"],
  ["7", "1,351 – 1,530", "180", "7–8"],
  ["8", "1,531 – 1,750", "220", "9"],
  ["9", "1,751 – 2,000", "250", "10"],
  ["10", "2,001 and up", "no ceiling", "—"],
];

const FAQ = [
  {
    q: "What ELO do you start with on FACEIT?",
    a: "A new CS2 account on FACEIT starts at 1,000 ELO, which is level 4 under the current thresholds (901–1,050). The first matches are calibration games with much larger swings than the usual 25 or so points, so a strong new player can be level 6 or 7 within a session and a weak one can drop to level 2 just as fast.",
  },
  {
    q: "How much ELO is a win worth?",
    a: "About 25 points in an evenly matched lobby. The swing is scaled by the gap between the two teams' average ELO: beating a team rated 150 points above yours is worth roughly 35 and losing to them costs roughly 15, while beating a team 150 below yours is worth roughly 15 and losing to them costs roughly 35. Those figures come from a textbook Elo calculation that reproduces FACEIT's even-lobby swing; FACEIT has not published its exact constants.",
  },
  {
    q: "How many wins does it take to reach level 10?",
    a: "From the 1,000 starting point you need to gain 1,001 ELO to cross 2,001. At a net 25 per win that is 40 more wins than losses — not 40 games. A player winning 55% of matches nets about 2.5 ELO per game on average, so the realistic answer is several hundred games, and it only gets slower as the lobbies get harder.",
  },
  {
    q: "Does FACEIT ELO decay if you stop playing?",
    a: "No. FACEIT does not reduce your ELO for inactivity; a player who leaves at 1,800 comes back at 1,800. Leaderboard positions are different: as of writing, the regional ladders and the Challenger badge above level 10 require recent activity to appear, so an inactive account keeps its ELO but drops off the public boards.",
  },
  {
    q: "What FACEIT level is a Global Elite or a 25,000 Premier player?",
    a: "There is no official mapping, and CSRun has no FACEIT level data to build one. Community tables commonly place level 10 alongside the red and gold Premier bands and levels 4–6 alongside blue, but treat that as folklore. The one hard anchor we have is on Valve's side: in our data, Global Elite accounts hold a median Premier rating of 27,232 (15 players), which tells you where the top of Competitive sits in Premier, not where it sits on FACEIT.",
  },
];

export default function Page() {
  return (
    <GuideArticle guide={g} faq={FAQ}>
      <p>{`FACEIT ranks CS2 players with one number, ELO, and shows it as a level from 1 to 10. The level is just a label for a band of ELO, so everything about climbing comes down to how the number moves. This guide covers the ten thresholds, the arithmetic behind a win or a loss with worked examples, what calibration does to a new account, why level 10 has no ceiling, what each level looks like in practice, how the levels relate to Valve's Premier and Competitive ladders, and FACEIT's rules on inactivity. It contains no FACEIT statistics of our own, because ${SITE_NAME}'s match database does not store FACEIT games with levels; where a figure is a community approximation rather than a published rule, it says so.`}</p>

      <h2>The ten level thresholds</h2>
      <p>{`FACEIT's CS2 levels are fixed ELO bands. Cross the top of your band and the badge changes immediately; fall below the floor and it drops just as fast, with no grace period. The table adds two columns FACEIT does not show: how wide each level is in ELO, and how many net wins (wins minus losses) it takes to cross it at the typical even-lobby swing of 25 points.`}</p>
      <table>
        <thead>
          <tr>
            <th>Level</th>
            <th>ELO</th>
            <th>Width</th>
            <th>Net wins to cross</th>
          </tr>
        </thead>
        <tbody>
          {LEVELS.map(([lvl, range, width, wins]) => (
            <tr key={lvl}>
              <td>Level {lvl}</td>
              <td>{range}</td>
              <td>{width}</td>
              <td>{wins}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <em>{`Thresholds as published by FACEIT for CS2; width and net-wins columns are arithmetic on those thresholds at a 25-point swing.`}</em>
      </p>
      <p>{`Two things the table makes obvious. Levels 3 through 6 are only 150 ELO wide, so six net wins moves you a whole level and a bad weekend can cost one; this is why mid-level badges flicker so much. And the ladder widens toward the top: level 8 is 220 wide, level 9 is 250, and level 10 is open-ended, so a level 9 player grinding toward 2,001 needs ten net wins while a level 5 needs six.`}</p>

      <h2>How a win or a loss is priced</h2>
      <p>{`FACEIT uses an Elo-style system: the two teams' average ELO sets how likely each side is to win, and the points exchanged after the match depend on that likelihood. Beat a team the system expected you to beat and you gain little; beat one it expected to win and you gain a lot. The same asymmetry applies to losses. In an even lobby the swing is about 25 points each way.`}</p>
      <p>{`FACEIT has not published its exact constants. But a standard Elo calculation with a K-factor of 50 reproduces the 25-point even swing, and it gives a good feel for how the number scales with the gap between teams. The expected score is 1 ÷ (1 + 10^((their average − your average) ÷ 400)); a win pays K × (1 − expected) and a loss costs K × expected. Worked through:`}</p>
      <table>
        <thead>
          <tr>
            <th>Your team avg</th>
            <th>Their team avg</th>
            <th>Your win chance</th>
            <th>Win pays</th>
            <th>Loss costs</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1,400</td>
            <td>1,400</td>
            <td>50%</td>
            <td>+25</td>
            <td>−25</td>
          </tr>
          <tr>
            <td>1,400</td>
            <td>1,550</td>
            <td>30%</td>
            <td>+35</td>
            <td>−15</td>
          </tr>
          <tr>
            <td>1,550</td>
            <td>1,400</td>
            <td>70%</td>
            <td>+15</td>
            <td>−35</td>
          </tr>
          <tr>
            <td>1,400</td>
            <td>1,800</td>
            <td>9%</td>
            <td>+45</td>
            <td>−5</td>
          </tr>
        </tbody>
      </table>
      <p>
        <em>{`Illustrative figures from a textbook Elo formula with K = 50, rounded. FACEIT's real curve may differ in the constants; the shape — bigger gains against stronger lobbies, bigger losses against weaker ones — is the published behavior.`}</em>
      </p>
      <p>{`The last row is why playing with much higher-rated friends feels so different from solo queue: your team's average rises, so every loss costs you more and every win pays less, and the reverse is true for the friend who is carrying you. A 400-point gap is also far wider than FACEIT's matchmaker normally allows in a standard queue; it is there to show the limit of the curve, not a lobby you should expect.`}</p>
      <p>{`Note what the formula does not contain: your personal score. ELO moves on the match result only. A 30-kill loss and a 3-kill loss cost the same, which is the whole difference between a ladder number and a performance rating. If you want a number that reacts to how you played rather than whether your team won, that is what the Leetify rating is for, and the two are compared in the rating systems guide linked below.`}</p>

      <h2>New accounts and calibration</h2>
      <p>{`A new CS2 account on FACEIT starts at 1,000 ELO, which is level 4. The first matches are calibration games in which the swings are much larger than 25 points, so the system can move a player to roughly the right band quickly. FACEIT has described the length of this period in different ways over time, so do not count on an exact number of games; the practical signs are the same either way: swings of well over 25 per match for the first stretch, then a settling to the normal curve.`}</p>
      <p>{`Calibration is also why a brand-new account that is obviously too good for level 4 is a common complaint. A strong player who has just made an account will spend a few matches at levels 4 to 6 on the way up, and from the other side of the server that looks exactly like a smurf. It usually is not: the difference is whether the account keeps climbing or keeps re-appearing at level 4.`}</p>

      <h2>Level 10 and beyond</h2>
      <p>{`Level 10 starts at 2,001 and has no ceiling. The badge is the same at 2,050 and at 3,500, and the second player is in a different sport from the first. That is why, past level 10, the ELO number and the regional leaderboard position matter and the badge does not. As of writing, FACEIT also shows a Challenger badge for the top of each regional leaderboard above level 10, which is a position rather than an ELO threshold and needs recent activity to hold.`}</p>
      <p>{`Climbing inside level 10 is slow for structural reasons: lobbies are drawn from a thin pool, so matches are more often uneven and the Elo curve pays little for beating lower-rated opponents; a 2,800 player beating a 2,500 lobby collects something closer to the 15-point row of the table than the 25-point one.`}</p>

      <h2>What each level looks like, as the community describes it</h2>
      <p>{`FACEIT publishes thresholds, not descriptions. The characterizations below are the ones you will find repeated across community guides, threads and coaching sites; they are approximations, not measurements, and ${SITE_NAME} has no FACEIT level data to confirm them.`}</p>
      <ul>
        <li>{`Levels 1–3 (100–900): players who dropped below the 1,000 starting point. Mechanics and game sense are still forming; many are new to FACEIT rather than new to CS2.`}</li>
        <li>{`Levels 4–6 (901–1,350): the starting band and the broad middle. Decent aim, inconsistent utility, communication that varies lobby to lobby.`}</li>
        <li>{`Levels 7–8 (1,351–1,750): consistently competent. Set utility on the main maps, trades and retakes that mostly work, and this is where many players stall for a long time.`}</li>
        <li>{`Level 9 (1,751–2,000): the doorstep of the top tier; strong individual players, often with team experience.`}</li>
        <li>{`Level 10 (2,001+): from very good to professional. The low 2,000s are strong pub players; 3,000 and above is the territory of semi-pros and pros.`}</li>
      </ul>
      <p>{`One pattern in that list is reliable even if the adjectives are not: the ladder is widest in the middle and thinnest at both ends, and most active accounts sit between levels 4 and 7 rather than evenly across the ten.`}</p>

      <h2>How FACEIT levels relate to Premier and Competitive</h2>
      <p>
        {`There is no official conversion between a FACEIT level and a Premier CS Rating or a Competitive skill group, because the three are separate ladders with separate player pools and separate maths. Community tables that line level 10 up with the red and gold Premier bands and levels 4–6 with blue are approximations based on people reporting their own numbers; ${SITE_NAME} cannot check them, because our database has Valve queue results with ranks attached but no FACEIT games with levels.`}
      </p>
      <p>
        {`What we can anchor is the Valve side. Among 171 tracked players who hold both a Premier rating and a Competitive skill group, Global Elite accounts hold a median Premier rating of 27,232, Supreme Master First Class 26,503 and Legendary Eagle Master 26,913 (15, 16 and 22 players respectively, so treat the figures as roughly 26,500–27,250 rather than precise), while Silver I accounts sit at a median of 5,468. If a FACEIT level 10 is anything like a Global Elite, as the community mappings claim, the Premier figure to expect is in the red band; if the account you are looking at is level 10 and 12,000 Premier, one of the three numbers is stale or the player barely queues one of the ladders. The full cross table and the Competitive distribution behind it are in `}
        <Link href="/guides/faceit-vs-premier-vs-mm">the queue comparison</Link>
        {`, the Premier percentiles are in `}
        <Link href="/guides/premier-cs-rating-explained">
          the CS Rating distribution guide
        </Link>
        {`, and the reason a ladder number and a performance rating can disagree is in `}
        <Link href="/guides/cs2-rating-systems-compared">
          the rating systems comparison
        </Link>
        {`.`}
      </p>

      <h2>Inactivity and resets</h2>
      <p>{`FACEIT ELO does not decay. Stop playing at 1,800 and you return at 1,800, whatever the ladder did around you in the meantime; FACEIT has stated this directly, and it has not run seasonal ELO resets for CS2 the way Valve recalibrates Premier between seasons. The only thing inactivity costs is visibility: leaderboard positions and the Challenger badge require recent matches, so an idle account keeps its ELO and loses its place on the boards. Separately, an account that stays away long enough will find its first games back feel like a mild recalibration, not because the system changed the number but because the player did.`}</p>

      <h2>Check any player&apos;s level and ELO</h2>
      <p>
        {`Paste a Steam profile link, a SteamID or a FACEIT nickname into `}
        <Link href="/">{SITE_NAME}</Link>
        {` and the profile shows the account's live FACEIT level and exact ELO alongside its Premier rating, `}
        <Link href="/guides/good-leetify-rating">Leetify rating</Link>
        {` and Steam signals, so a level that does not match the other numbers stands out. The `}
        <Link href="/compare">comparison tool</Link>
        {` lines two accounts up to settle who is further along, and if a suspiciously good level-4 account is what brought you here, the signals worth weighing are in `}
        <Link href="/guides/spotting-smurfs-and-cheaters">
          the smurfs and cheaters guide
        </Link>
        {`.`}
      </p>
    </GuideArticle>
  );
}
