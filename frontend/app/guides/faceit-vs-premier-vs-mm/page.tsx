import type { Metadata } from "next";
import Link from "next/link";
import { guideBySlug } from "@/lib/guides";
import { SITE_NAME } from "@/lib/site";
import { GuideArticle } from "@/components/guide/GuideArticle";

const g = guideBySlug("faceit-vs-premier-vs-mm")!;

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
// on 2026-10-08: 38,117 players with a Competitive skill group, 171 players
// with both a skill group and a Premier rating, 10,159 matches with a map.
const DATA_DATE = "8 October 2026";

// Valve's 18 Competitive skill groups, in order. Row data: players holding the
// group as their latest, share of the 38,117, then per-game averages over the
// games where that group was recorded (games, K/D, head-shot accuracy, damage
// per round, kills per game).
const GROUPS: [string, number, string, number, string, string, string, string][] = [
  ["Silver I", 3499, "9.2%", 4135, "0.97", "14.3%", "68.7", "11.9"],
  ["Silver II", 2781, "7.3%", 3360, "1.08", "15.9%", "74.3", "13.2"],
  ["Silver III", 2046, "5.4%", 2447, "1.08", "16.3%", "75.1", "13.4"],
  ["Silver IV", 2290, "6.0%", 2674, "1.09", "16.7%", "76.2", "13.7"],
  ["Silver Elite", 2509, "6.6%", 3001, "1.11", "17.5%", "77.4", "13.9"],
  ["Silver Elite Master", 2720, "7.1%", 3186, "1.13", "17.7%", "78.3", "14.2"],
  ["Gold Nova I", 2755, "7.2%", 3244, "1.16", "18.4%", "78.9", "14.3"],
  ["Gold Nova II", 2819, "7.4%", 3413, "1.18", "18.6%", "80.5", "14.7"],
  ["Gold Nova III", 2740, "7.2%", 3382, "1.16", "19.4%", "80.2", "14.4"],
  ["Gold Nova Master", 2583, "6.8%", 3210, "1.17", "19.5%", "80.2", "14.6"],
  ["Master Guardian I", 2331, "6.1%", 2917, "1.17", "20.0%", "79.9", "14.5"],
  ["Master Guardian II", 2056, "5.4%", 2645, "1.19", "20.2%", "81.7", "14.9"],
  ["Master Guardian Elite", 1800, "4.7%", 2459, "1.21", "20.8%", "82.3", "15.1"],
  ["Distinguished Master Guardian", 1366, "3.6%", 2055, "1.22", "21.2%", "83.2", "15.4"],
  ["Legendary Eagle", 1110, "2.9%", 1721, "1.25", "21.3%", "84.6", "15.5"],
  ["Legendary Eagle Master", 1402, "3.7%", 2397, "1.33", "22.2%", "85.7", "16.0"],
  ["Supreme Master First Class", 679, "1.8%", 1299, "1.36", "22.9%", "87.8", "16.3"],
  ["Global Elite", 631, "1.7%", 1774, "1.44", "24.4%", "90.6", "16.8"],
];

const FAQ = [
  {
    q: "What is the most common rank in CS2 Competitive?",
    a: "In CSRun's data (38,117 players with a recorded skill group, through 8 October 2026) Silver I is the single largest group at 9.2%, followed by Gold Nova II at 7.4%. Taken together, Gold Nova I through Gold Nova Master hold 28.6% of players. Global Elite is 1.7% and Supreme Master First Class 1.8%.",
  },
  {
    q: "What Premier rating does a Global Elite have?",
    a: "Among the 171 tracked players who hold both a Premier rating and a Competitive skill group, the median Premier rating of Global Elite accounts is 27,232 (15 players), Supreme Master First Class 26,503 (16) and Legendary Eagle Master 26,913 (22) — all in the red band. The cells are small, so expect individual players to sit thousands of points either side.",
  },
  {
    q: "Is Premier harder than Competitive matchmaking?",
    a: "They are separate ladders with separate populations, so there is no direct answer, but the cross table in this guide shows the two ladders agree in order: the higher the skill group, the higher the Premier rating that the same accounts hold. Premier also forces the Active Duty map pool, while Competitive lets players stick to Dust2 and Mirage, which together make up 42% of our tracked Competitive matches.",
  },
  {
    q: "Which maps are played most in CS2 matchmaking?",
    a: "Across 8,986 tracked Competitive matches, Dust2 (24.1%) and Mirage (18.3%) lead, then Nuke (10.3%), Inferno (9.3%) and Cache (8.5%). In the other Valve queues we track (1,173 matches), Dust2 (21.9%) and Mirage (20.1%) still lead, with Inferno third at 12.2%.",
  },
  {
    q: "Does CSRun show FACEIT levels in this comparison?",
    a: "Not in the data tables. Our match database stores Valve queue results with ranks attached, but FACEIT games are not stored with levels, so this guide covers FACEIT as a system — anti-cheat, ELO and leagues — rather than with level statistics. The ELO mechanics are in the FACEIT ELO guide, and any player's live FACEIT level and ELO appear on their CSRun profile.",
  },
];

export default function Page() {
  return (
    <GuideArticle guide={g} faq={FAQ}>
      <p>{`CS2 gives you three ranked-shaped queues: Valve's per-map Competitive, Valve's Premier, and the third-party FACEIT platform. Most comparisons of them are opinion. This one uses ${SITE_NAME}'s own match data to show who actually plays Competitive and what they do per game, what Premier rating a Silver, Gold Nova or Global Elite account typically holds, and which maps each Valve queue really plays, then gives a queue recommendation per type of player. FACEIT is covered as a system, because our database does not store FACEIT games with levels, and we would rather say so than invent a table.`}</p>

      <h2>The three queues in one table</h2>
      <table>
        <thead>
          <tr>
            <th>Queue</th>
            <th>Rank shown</th>
            <th>Anti-cheat</th>
            <th>Maps</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Competitive</td>
            <td>18 skill groups, Silver I to Global Elite, per map</td>
            <td>VAC and VAC Live</td>
            <td>You pick the map; wider pool than Premier</td>
          </tr>
          <tr>
            <td>Premier</td>
            <td>CS Rating, one number, seasonal</td>
            <td>VAC and VAC Live</td>
            <td>Active Duty pool with pick-ban</td>
          </tr>
          <tr>
            <td>FACEIT</td>
            <td>Levels 1–10 driven by ELO</td>
            <td>FACEIT client, kernel-level</td>
            <td>Active Duty pool with veto</td>
          </tr>
        </tbody>
      </table>
      <p>{`None of the three ladders talks to the others: your skill groups, your CS Rating and your FACEIT ELO move independently. Competitive and Premier share Valve's servers and anti-cheat; FACEIT runs its own servers at 128 tick and requires its own anti-cheat client, which is the main practical reason players switch to it.`}</p>

      <h2>Who plays Competitive: the skill-group distribution</h2>
      <p>{`We recorded the latest Competitive skill group for 38,117 players in our match database. The shares below are of that tracked population, which leans toward accounts people look up on this site rather than every account that has ever queued.`}</p>
      <table>
        <thead>
          <tr>
            <th>Skill group</th>
            <th>Players</th>
            <th>Share</th>
          </tr>
        </thead>
        <tbody>
          {GROUPS.map(([name, players, share]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>{players.toLocaleString("en-US")}</td>
              <td>{share}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <em>{`${SITE_NAME} data, latest skill group for each of 38,117 players, tracked through ${DATA_DATE}.`}</em>
      </p>
      <p>{`Silver I is the largest group at 9.2%, which is less a statement about skill than about turnover: it is where new and returning accounts land, and plenty of them never climb out before they stop playing or move to Premier. From Silver II to Gold Nova Master the groups are remarkably even, each holding 5–7.5% of players, and the Gold Nova tier (Gold Nova I through Master) is the broad middle at 28.6% combined. Above Master Guardian the ladder thins quickly: Legendary Eagle 2.9%, Supreme 1.8%, Global Elite 1.7%. Legendary Eagle Master (3.7%) is noticeably bigger than the group below it, a bump that shows up consistently in our data and is probably where a lot of strong players settle once their Competitive games get rarer.`}</p>

      <h2>What each skill group does per game</h2>
      <p>{`Per-game averages across the games where the group was recorded. Head-shot accuracy is the share of hits that landed on the head; damage per round and kills are per game.`}</p>
      <table>
        <thead>
          <tr>
            <th>Skill group</th>
            <th>Games</th>
            <th>K/D</th>
            <th>HS accuracy</th>
            <th>DPR</th>
            <th>Kills</th>
          </tr>
        </thead>
        <tbody>
          {GROUPS.map(([name, , , games, kd, hs, dpr, kills]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>{games.toLocaleString("en-US")}</td>
              <td>{kd}</td>
              <td>{hs}</td>
              <td>{dpr}</td>
              <td>{kills}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <em>{`${SITE_NAME} data, 49,319 Competitive games with a recorded skill group, tracked through ${DATA_DATE}. Games average about 19.5 rounds.`}</em>
      </p>
      <p>
        {`Unlike Premier, where per-game numbers stay flat because the lobby rises with the player, the Competitive ladder shows a steady mechanical gradient. K/D climbs from 0.97 in Silver I to 1.44 in Global Elite, head-shot accuracy from 14.3% to 24.4%, damage per round from 68.7 to 90.6, and spray accuracy (not in the table) from 28.4% to 36.5%. Preaim improves from 11.6 degrees to 8.8. Part of that gradient is real skill and part is mixing: Competitive lobbies are built per map and tolerate wider rank spreads than Premier, so a Global Elite is more often playing down than a 27,000 Premier player is. A Gold Nova with a 1.16 K/D and 80 damage per round is pulling their weight; the question of what a good K/D or ADR means at your level is covered in `}
        <Link href="/guides/what-is-a-good-kd-cs2">the K/D guide</Link>
        {` and `}
        <Link href="/guides/what-is-a-good-adr-cs2">the ADR guide</Link>
        {`.`}
      </p>

      <h2>What Premier rating a skill group typically holds</h2>
      <p>{`171 tracked players hold both a Premier rating and a Competitive skill group. That is enough to show the two ladders agree in order, and not enough to publish a conversion. Where a single group had fewer than ten players we merged it with its neighbors:`}</p>
      <table>
        <thead>
          <tr>
            <th>Skill groups</th>
            <th>Players</th>
            <th>Median Premier rating</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Silver I</td>
            <td>17</td>
            <td>5,468</td>
          </tr>
          <tr>
            <td>Silver II – Silver III</td>
            <td>17</td>
            <td>10,749 (Silver II, 10 players); 11,993 (Silver III, 7)</td>
          </tr>
          <tr>
            <td>Silver IV – Gold Nova III</td>
            <td>42</td>
            <td>Group medians between 13,951 and 22,933</td>
          </tr>
          <tr>
            <td>Gold Nova Master – Legendary Eagle</td>
            <td>42</td>
            <td>Group medians between 23,494 and 26,226</td>
          </tr>
          <tr>
            <td>Legendary Eagle Master</td>
            <td>22</td>
            <td>26,913</td>
          </tr>
          <tr>
            <td>Supreme Master First Class</td>
            <td>16</td>
            <td>26,503</td>
          </tr>
          <tr>
            <td>Global Elite</td>
            <td>15</td>
            <td>27,232</td>
          </tr>
        </tbody>
      </table>
      <p>
        <em>{`${SITE_NAME} data, 171 players with both a Premier rating and a Competitive skill group, tracked through ${DATA_DATE}. Cells of 3–8 players are reported as ranges of group medians, not as figures.`}</em>
      </p>
      <p>
        {`The shape is clear even with small cells. Silver I accounts sit in the grey band of Premier; Silver II and III in blue; the Silver IV to Gold Nova III stretch spans blue to pink; and everything from Gold Nova Master upward clusters in pink and red, with the top three groups all landing at a median of 26,500–27,250. That last point matters: in our data the difference between a Legendary Eagle Master and a Global Elite is about 300 Premier points, which is one game's swing. Above Gold Nova Master the Competitive badge stops discriminating much, while Premier keeps spreading players out, which is the strongest argument for using Premier as your main ladder once you are past the Gold Nova tier. Where a given Premier rating sits overall, with percentiles, is in `}
        <Link href="/guides/premier-cs-rating-explained">
          the CS Rating distribution guide
        </Link>
        {`.`}
      </p>

      <h2>Which maps each Valve queue actually plays</h2>
      <p>{`Premier forces the Active Duty pool through pick-ban. Competitive lets you choose, and the choice is lopsided. Here is the map mix across the 10,159 Valve matchmaking games in our database, split into Competitive and the other Valve queues (Premier, casual and unranked as our match source labels them):`}</p>
      <table>
        <thead>
          <tr>
            <th>Map</th>
            <th>Competitive matches</th>
            <th>Share</th>
            <th>Other Valve queues</th>
            <th>Share</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Dust2</td>
            <td>2,168</td>
            <td>24.1%</td>
            <td>257</td>
            <td>21.9%</td>
          </tr>
          <tr>
            <td>Mirage</td>
            <td>1,645</td>
            <td>18.3%</td>
            <td>236</td>
            <td>20.1%</td>
          </tr>
          <tr>
            <td>Nuke</td>
            <td>926</td>
            <td>10.3%</td>
            <td>103</td>
            <td>8.8%</td>
          </tr>
          <tr>
            <td>Inferno</td>
            <td>837</td>
            <td>9.3%</td>
            <td>143</td>
            <td>12.2%</td>
          </tr>
          <tr>
            <td>Cache</td>
            <td>761</td>
            <td>8.5%</td>
            <td>24</td>
            <td>2.0%</td>
          </tr>
          <tr>
            <td>Anubis</td>
            <td>530</td>
            <td>5.9%</td>
            <td>82</td>
            <td>7.0%</td>
          </tr>
          <tr>
            <td>Ancient</td>
            <td>516</td>
            <td>5.7%</td>
            <td>70</td>
            <td>6.0%</td>
          </tr>
          <tr>
            <td>Vertigo</td>
            <td>402</td>
            <td>4.5%</td>
            <td>79</td>
            <td>6.7%</td>
          </tr>
          <tr>
            <td>Train</td>
            <td>335</td>
            <td>3.7%</td>
            <td>40</td>
            <td>3.4%</td>
          </tr>
          <tr>
            <td>Office</td>
            <td>335</td>
            <td>3.7%</td>
            <td>44</td>
            <td>3.8%</td>
          </tr>
          <tr>
            <td>Overpass</td>
            <td>246</td>
            <td>2.7%</td>
            <td>39</td>
            <td>3.3%</td>
          </tr>
          <tr>
            <td>All other maps</td>
            <td>285</td>
            <td>3.2%</td>
            <td>56</td>
            <td>4.8%</td>
          </tr>
        </tbody>
      </table>
      <p>
        <em>{`${SITE_NAME} data, 8,986 Competitive and 1,173 other Valve matchmaking matches, tracked through ${DATA_DATE}. "All other maps" covers Agency, Italy, Grail, Jura, Palacio, Shelter, Warden, Alpine, Fachwerk, Boulder, Golden, Stronghold, Edin, Basalt, Mills and Thera.`}</em>
      </p>
      <p>
        {`Dust2 and Mirage are 42% of all tracked Competitive games, and Cache, which is not in the Premier pool, is the fifth most played Competitive map at 8.5%. Overpass, a pro-circuit staple for years, is under 3% in both queues. The practical consequence for the queue decision: a Competitive rank is largely a Dust2-and-Mirage rank, which is fine if those are the maps you want to be good at and a trap if you want to play the full pool. Premier and FACEIT make you veto, which is its own skill; `}
        <Link href="/guides/cs2-map-veto-strategy">the map veto guide</Link>
        {` covers how to find your real permaban.`}
      </p>

      <h2>FACEIT: what it adds, without pretending we have level data</h2>
      <p>
        {`FACEIT is a free third-party platform with a kernel-level anti-cheat client that must be running to queue, 128-tick servers, a ten-level ladder driven by ELO, and the hubs and league pyramid (including the former ESEA divisions) that make it the on-ramp to organized team play. Its player pool is opt-in and skews serious, so its lobbies are widely reported to be more structured than the equivalent Premier band, especially in Europe where its queues are deepest; outside Europe, high-level and late-night queues can be slow. Those are mechanics and widely shared experience, not our data. We do not store FACEIT matches with levels attached, so there is no FACEIT row in the tables above and no FACEIT-to-Premier conversion here; community mappings between the two exist and are approximate at best. How ELO moves, what the ten thresholds are and how the levels relate to Valve's ladders is in `}
        <Link href="/guides/faceit-levels-and-elo">the FACEIT ELO guide</Link>
        {`.`}
      </p>

      <h2>Pick a queue by what you want</h2>
      <ul>
        <li>{`New to CS2, or returning after years: Competitive. Pick the map you know, play Dust2 and Mirage until the fundamentals come back, and leave the other two ladders alone; a skill group costs you nothing anywhere else.`}</li>
        <li>{`Gold Nova to Master Guardian and want one honest number: Premier. Our cross table shows the Competitive badge stops separating players around Gold Nova Master, while Premier keeps spreading them from 20,000 to 30,000.`}</li>
        <li>{`Legendary Eagle Master or above, still in Competitive: you are in the 7.2% of tracked players at LEM or higher, and your Premier equivalent is around 26,500–27,250 in our data. Premier or FACEIT will give you harder and more varied games than a Competitive queue dominated by two maps.`}</li>
        <li>{`Cheaters are what tilt you, and you accept a kernel-level client: FACEIT. That is the conventional answer and the main reason the platform exists.`}</li>
        <li>{`You want a team, seasons or a semi-pro path: FACEIT hubs and leagues are the only one of the three with that structure built in.`}</li>
        <li>{`You solo-queue in North America, Oceania or a smaller region at odd hours: Premier finds games faster. Queue FACEIT when your region's evening peak is on.`}</li>
        <li>{`You want to play Cache, Office or the community map rotation: Competitive is the only ranked queue that offers them.`}</li>
      </ul>

      <h2>See all three on one profile</h2>
      <p>
        {`Look up any account on `}
        <Link href="/">{SITE_NAME}</Link>
        {` and the profile shows the live FACEIT level and ELO next to the Premier CS Rating, Leetify rating and Steam signals, with a per-map table of wins, losses and ADR underneath so you can see which maps a Competitive rank was built on. The `}
        <Link href="/compare">comparison tool</Link>
        {` puts two accounts side by side across all of it, and the `}
        <Link href="/pro-matches">pro matches board</Link>
        {` shows the map pool the professional circuit is actually playing this week, which is the pool Premier and FACEIT will make you veto.`}
      </p>
    </GuideArticle>
  );
}
