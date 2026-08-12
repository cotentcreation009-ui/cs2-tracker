import type { Metadata } from "next";
import Link from "next/link";
import { guideBySlug } from "@/lib/guides";
import { SITE_NAME } from "@/lib/site";
import { GuideArticle } from "@/components/guide/GuideArticle";

const g = guideBySlug("what-is-a-good-kd-cs2")!;

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
    q: "Is a 1.0 K/D good in CS2?",
    a: "It is exactly break-even: you kill as often as you die. Because every kill in a match is also someone's death, the average player in any lobby sits close to 1.0 — so holding 1.0 means you are pulling your weight in lobbies matchmaking already considers your level.",
  },
  {
    q: "What is the difference between K/D and K/R?",
    a: "K/D divides kills by deaths; K/R divides kills by rounds played. K/R is steadier because you can only die once per round, so one aggressive, space-making playstyle is not punished twice. Something roughly in the 0.6–0.7 kills-per-round range is a typical middle for solid players.",
  },
  {
    q: "Is a very high K/D suspicious?",
    a: "Over a handful of games, no — hot streaks and easy lobbies happen. A K/D far above 1.5 sustained across a large sample of evenly matched games is rarer, and on a brand-new account it is one of the signals worth a closer look. It still proves nothing on its own; plenty of legitimate players smash lobbies they have outgrown.",
  },
  {
    q: "Does K/D matter for ranking up?",
    a: "Only indirectly. Premier CS Rating and FACEIT ELO move primarily on wins and losses, not on your personal scoreboard, so a flashy K/D in defeats climbs nothing. Kills matter insofar as they win rounds — which is exactly the part of the game K/D measures least directly.",
  },
];

export default function Page() {
  return (
    <GuideArticle guide={g} faq={FAQ}>
      <p>{`Kills divided by deaths is the first number everyone checks after a match, and the easiest one to misread. The short answer: in evenly matched Counter-Strike 2 lobbies, a K/D around 1.0 means you are holding your own, anything sustained above roughly 1.1 is genuinely good, and the further past 1.2 you sit over a real sample of games, the more you are carrying. The longer answer is that K/D flatters some playstyles, punishes others, and lies hardest over small samples — which is why it should never be read alone.`}</p>

      <h2>Why 1.0 is the break-even</h2>
      <p>{`K/D has a built-in anchor most stats lack. Every kill on your scoreboard is a death on someone else's, so across the ten players in a match, kills and deaths roughly cancel out — the average player in any given lobby sits close to 1.0 by construction. That makes 1.0 an honest break-even: you are removing enemies from rounds exactly as often as you are being removed yourself.`}</p>
      <p>
        {`The second half of the logic is matchmaking. Ranked systems — Valve's Premier CS Rating, `}
        <Link href="/guides/faceit-levels-and-elo">FACEIT ELO</Link>
        {` — exist to push you into lobbies where you are average. Win too much and you climb until you stop winning, and the same gravity acts on your K/D. So a sustained 1.15 does not mean you are 15% better than the average CS2 player in some absolute sense; it means you are consistently beating lobbies the system already believes are your level. That is what climbing looks like from the inside — and it is why your K/D tends to sag back toward 1.0 shortly after every rank-up.`}
      </p>
      <p>{`A rough map for reading a sustained K/D in your own lobbies:`}</p>
      <table>
        <thead>
          <tr>
            <th>Sustained K/D</th>
            <th>How to read it</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Below ~0.85</td>
            <td>{`Struggling at this level — or playing a support role the number cannot see`}</td>
          </tr>
          <tr>
            <td>~0.85 – 1.1</td>
            <td>{`Holding your own; where most players at a stable rank live`}</td>
          </tr>
          <tr>
            <td>~1.1 – 1.3</td>
            <td>{`Strong for the lobby; over a real sample you are likely to climb`}</td>
          </tr>
          <tr>
            <td>Above ~1.3</td>
            <td>{`Carrying — or the sample is small, or the lobbies are below your level`}</td>
          </tr>
        </tbody>
      </table>

      <h2>K/R: the steadier cousin</h2>
      <p>{`Kills per round (K/R) is the same kill output with a saner denominator. You can only die once per round, but a bad K/D punishes a death twice — it removes nothing from your kills and inflates the divisor. K/R sidesteps that: it asks how much you produce per round and ignores what your aggression costs you. Roughly 0.6 to 0.7 kills per round is a typical figure for a solid player, with dedicated fraggers pushing higher — treat those as ballpark bands, not hard cutoffs.`}</p>
      <p>{`Here is why the distinction matters. Two players, same match, same kill output:`}</p>
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Kills</th>
            <th>Deaths</th>
            <th>Rounds</th>
            <th>K/D</th>
            <th>K/R</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{`A — plays late, takes safe duels`}</td>
            <td>20</td>
            <td>14</td>
            <td>30</td>
            <td>1.43</td>
            <td>0.67</td>
          </tr>
          <tr>
            <td>{`B — entries every T round`}</td>
            <td>20</td>
            <td>24</td>
            <td>30</td>
            <td>0.83</td>
            <td>0.67</td>
          </tr>
        </tbody>
      </table>
      <p>{`Identical production per round, wildly different K/D. Which player helped more depends entirely on when those kills and deaths happened — which is the part of the story K/D never tells.`}</p>

      <h2>When K/D lies: roles and round timing</h2>
      <p>{`Not all kills are worth the same, and not all deaths cost the same. Three patterns account for most of the distortion:`}</p>
      <ul>
        <li>{`Exit frags inflate it. Kills scored after a round is already decided — picking off saving players, trading in a lost retake — count exactly like round-winning ones on the scoreboard while changing almost nothing.`}</li>
        <li>{`Baiting inflates it. Letting a teammate take the first contact and cleaning up the shooter afterwards is the single most reliable way to farm favorable duels. The baiter's K/D looks excellent; the team's rounds do not.`}</li>
        <li>{`Entry fragging deflates it. The player who takes the first duel of every T round fights the most prepared defender on the map, and even strong entry players lose a large share of those duels. Their deaths buy information and space — the two most valuable currencies in a round — and K/D records them purely as a cost.`}</li>
      </ul>
      <p>
        {`Support players and in-game leaders sit in the same blind spot. A player throwing the flashes that create your entry kills, or an IGL spending rounds thinking about the other team instead of their own crosshair, can be the most valuable player on the server at a 0.9 K/D. Scan a few scoreboards on our `}
        <Link href="/pro-matches">pro match pages</Link>
        {` and you will regularly find winning captains near the bottom of the board. This blind spot is exactly why impact-based ratings exist — `}
        <Link href="/guides/good-leetify-rating">{`Leetify's rating`}</Link>
        {` credits the flash assist and the trade that K/D silently awards to someone else.`}
      </p>

      <h2>Read it per map and per side</h2>
      <p>{`A single K/D also averages away structure you can actually use. CS2 maps are not symmetric: on most of the pool one side is easier to hold, and CT positions — especially with an AWP — generate far more favorable duels than T-side entries onto a held site. A player whose K/D is built on CT halves and one comfort map is a different player from one who posts the same number entrying on every map in the pool.`}</p>
      <p>{`So when a number looks surprising, split it before judging it: per map, then per side. A 1.3 on your best two maps alongside a 0.8 everywhere else is not a 1.1 — it is a map-pool problem wearing an average. The same split is the fastest way to read an opponent: strong overall K/D but weak T sides usually means a passive holder you can play around.`}</p>

      <h2>Small samples lie the most</h2>
      <p>{`A regulation MR12 match is at most 24 rounds, and a typical player finishes it with somewhere between 10 and 25 kills. At those volumes, two unlucky pistol rounds, one anti-eco gone wrong, or a single smurf in the enemy lobby moves your match K/D by tenths. Five games tell you almost nothing; a rolling window of 20 or more matches is where the number starts meaning something. If your K/D over that kind of sample sits above 1.1, believe it — if it spiked there over a weekend, wait.`}</p>
      <p>
        {`The same logic applies when you are judging someone else. A monster K/D over eight games on a fresh account is not evidence of anything by itself — but it is one of the `}
        <Link href="/guides/spotting-smurfs-and-cheaters">signals worth a closer look</Link>
        {` when it clusters with a young account, missing history, or a rank gap between platforms. Signals, never proof: legitimately good players post absurd short-run numbers all the time.`}
      </p>

      <h2>Cross-check with ADR and rating</h2>
      <p>
        {`Because K/D awards a kill entirely to whoever fires the last bullet, it erases the 80 damage you dealt before a teammate finished the job. ADR — average damage per round — restores that: it counts every point of damage, whoever gets the scoreboard credit. The band-by-band read of that stat is its own article — see `}
        <Link href="/guides/what-is-a-good-adr-cs2">{`what counts as a good ADR`}</Link>
        {` — but the short version is that the two numbers keep each other honest.`}
      </p>
      <p>{`The two stats together read better than either alone. High K/D with modest ADR is the classic cleanup-and-exit-frag profile: kills that arrive after the damage, and often after the round. Modest K/D with high ADR is usually the opposite — a player doing the dirty work of opening sites and softening targets without collecting the finish. Add an impact rating on top and you have a reasonable triangulation of what one number was never going to tell you.`}</p>

      <h2>See the whole picture for any player</h2>
      <p>
        {`Search any account on `}
        <Link href="/">{SITE_NAME}</Link>
        {` to see a player's stats in context — Premier, FACEIT, Leetify and Steam data on one page — or put two accounts side by side in the `}
        <Link href="/compare">comparison tool</Link>
        {` to settle whose numbers actually hold up. To see where the kills and deaths in a single match really came from, round by round, run it through the `}
        <Link href="/demos">demo analyzer</Link>
        {`.`}
      </p>
    </GuideArticle>
  );
}
