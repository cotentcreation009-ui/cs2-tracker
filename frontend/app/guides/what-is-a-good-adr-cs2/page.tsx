import type { Metadata } from "next";
import Link from "next/link";
import { guideBySlug } from "@/lib/guides";
import { SITE_NAME } from "@/lib/site";
import { GuideArticle } from "@/components/guide/GuideArticle";

const g = guideBySlug("what-is-a-good-adr-cs2")!;

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
    q: "Is 100 ADR good in CS2?",
    a: "Yes — sustaining around 100 ADR means you dealt a full enemy's worth of health every round, which almost always makes you the best player in the lobby. A single 100+ game is a great night; a 10–20 match average near 100 is star-fragger territory at any level.",
  },
  {
    q: "Does utility damage count toward ADR?",
    a: "Yes. Damage from HE grenades, molotovs and incendiaries counts exactly like bullet damage. Flashbangs deal no meaningful damage, though, so a support player whose main contribution is flashing teammates into kills gets nothing from ADR for it.",
  },
  {
    q: "Is ADR more important than K/D?",
    a: "Neither wins alone. ADR is harder to inflate — every point of it was real damage — but it misses whether you converted fights and survived. K/D captures conversion but rises on cleanup kills of already-weakened enemies. Read the two together and let the disagreements tell the story.",
  },
  {
    q: "Why is my ADR so different from map to map?",
    a: "Usually because your role, positions and comfort change with the map, not because your aim does. A big spread across maps with a decent sample behind it is a map-pool problem — the fix is vetoing or practising the weak maps, not more aim training.",
  },
];

export default function Page() {
  return (
    <GuideArticle guide={g} faq={FAQ}>
      <p>{`ADR — average damage per round — is the most honest number on a CS2 scoreboard. As a rough guide: around 60 or below is a low-impact game, 70–80 means you pulled your weight, 80 and up is a strong performance, and a player sustaining 95+ is usually the star fragger of the lobby. The rest of this guide is the context those numbers need — because the same ADR can mean very different things depending on role, side and map.`}</p>

      <h2>What ADR actually measures</h2>
      <p>{`ADR is simply the total damage you dealt to enemies divided by the rounds you played. Everything that hurts an opponent counts: rifle and pistol damage, HE grenades, molotov and incendiary burns. Two things do not count — flashbangs, which blind but deal no meaningful damage, and any "overkill" beyond an enemy's remaining health. If someone is sitting at 20 HP, killing them adds only 20 damage to your total, no matter what you hit them with.`}</p>
      <p>{`That last rule matters more than it looks. It means ADR can never be padded by spraying into fights that were already won — every point of it was health an enemy actually lost while alive.`}</p>

      <h2>Why 100 damage equals one kill</h2>
      <p>{`Every player spawns with 100 HP, so 100 damage is exactly one enemy's worth of health. An ADR of 100 therefore reads as "one full kill of damage, every single round" — whether that came as one clean kill, or as 60 to one enemy and 40 to another. That is the stat's core virtue: it credits chip damage. Hitting an enemy for 80 before you die is invisible to your K/D, but if a teammate finishes that kill, your 80 damage did most of the work — and ADR is the only scoreboard number that says so.`}</p>

      <h2>The rough bands</h2>
      <p>{`Exact cutoffs shift with rank, platform and match length, so treat these as conventional reads rather than hard lines:`}</p>
      <table>
        <thead>
          <tr>
            <th>ADR (roughly)</th>
            <th>How to read it</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Under ~60</td>
            <td>Low impact — you rarely influenced how rounds went</td>
          </tr>
          <tr>
            <td>60 – 70</td>
            <td>Below par — some contribution, but the round wins came from elsewhere</td>
          </tr>
          <tr>
            <td>70 – 80</td>
            <td>Solid — pulling your weight in almost any lobby</td>
          </tr>
          <tr>
            <td>80 – 95</td>
            <td>{`Strong — usually top two on your team's scoreboard`}</td>
          </tr>
          <tr>
            <td>95+</td>
            <td>The star fragger — nearly a full kill of damage every round</td>
          </tr>
        </tbody>
      </table>
      <p>{`For calibration: in professional play, most players average somewhere in the 70s and 80s over a long season, and a star cracking the 90s across a whole event is having a monster tournament. Your pub-match ADR is not directly comparable — looser lobbies produce more open fights and more damage — but the shape of the ladder is the same everywhere: 80 is good, 95+ is carrying.`}</p>

      <h2>Role changes the number</h2>
      <p>{`Before judging anyone's ADR — including your own — ask what job they were doing:`}</p>
      <ul>
        <li>{`Entry fraggers run high ADR almost by definition. They take the first fight of the round, so they deal opening damage constantly — and because they also die constantly, their K/D often looks worse than their real impact.`}</li>
        <li>{`Support players are undersold by ADR. Flash assists earn zero damage, so a player who spends money and time blinding enemies for teammates can have a quiet ADR while winning their team rounds. HE and molotov damage claws some of it back.`}</li>
        <li>{`AWPers convert efficiently — a single shot on a full-HP enemy is a clean 100 damage — but they take fewer fights per round and save their rifle more often, so their ADR frequently sits below their influence on the match.`}</li>
        <li>{`Anchors and lurkers see fewer engagements by design. A site anchor who wins their site twice a half can post a modest ADR and still be the reason the half was won.`}</li>
      </ul>

      <h2>Side and map effects</h2>
      <p>{`ADR is not evenly distributed across a match. On the T side, damage arrives in bursts — an execute produces a flurry of it, while a lost round where you saved produces none, which drags the average down. On the CT side, defensive utility farms steady chip damage: a well-placed molotov or HE into a rehearsed execute adds damage round after round, even when you never win a duel. Neither pattern is better; they just mean your two halves can look very different for reasons that have nothing to do with form.`}</p>
      <p>{`Maps push the number around too. Maps whose fights happen at grenade-friendly chokepoints reward utility damage; maps dominated by long sightlines funnel damage toward whoever holds the AWP; and your own comfort matters most of all — most players have a map where their positions are second nature and one where every round feels improvised. That spread is normal. What it means practically is that a single-match ADR on one map tells you close to nothing about your level.`}</p>

      <h2>ADR vs K/D: when they disagree</h2>
      <p>{`The two stats measure different halves of a fight — damage dealt versus fights converted and survived — so their disagreements are where the information lives:`}</p>
      <table>
        <thead>
          <tr>
            <th>ADR</th>
            <th>K/D</th>
            <th>The likely story</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>High</td>
            <td>High</td>
            <td>Carrying — dealing damage and converting it into won fights</td>
          </tr>
          <tr>
            <td>High</td>
            <td>Low</td>
            <td>Taking hard fights and getting traded — classic entry pattern; healthy if teammates convert the damage, a warning sign if they do not</td>
          </tr>
          <tr>
            <td>Low</td>
            <td>High</td>
            <td>Cleanup kills and picks — finishing weakened enemies, exit frags, playing for saves; the K/D flatters</td>
          </tr>
          <tr>
            <td>Low</td>
            <td>Low</td>
            <td>A quiet game — or a support role doing work that neither stat can see</td>
          </tr>
        </tbody>
      </table>
      <p>
        {`If you only trust one, trust ADR: it cannot be inflated by 20 HP cleanups or eco-round farming the way K/D can — our guide to `}
        <Link href="/guides/what-is-a-good-kd-cs2">{`what counts as a good K/D`}</Link>
        {` covers that side of the ledger in full. But the better answer is an impact-based rating that folds damage, trades and utility into one number — that is exactly what `}
        <Link href="/guides/good-leetify-rating">{`Leetify's rating`}</Link>
        {` tries to do, and why two players with identical K/Ds can grade very differently.`}
      </p>

      <div className="callout">
        <p>{`Judge ADR over 10–20 matches, never one. A single game swings wildly with the map, your role that night and plain luck; a rolling average is what actually reflects your level. And if a stranger's ADR sits far above anything their account history suggests, that is one of the signals worth a closer look — not proof of anything.`}</p>
      </div>

      <h2>Reading your ADR on {SITE_NAME}</h2>
      <p>
        {`Pull up any account on `}
        <Link href="/">{SITE_NAME}</Link>
        {` and the profile shows a per-map table — wins and losses, win rate, ADR and rating for every map you play — plus your recent matches with each game's ADR alongside. Two reads are worth making. First, the spread: a big gap between your best and worst map's ADR with a decent number of matches behind it is a map-pool problem, and the veto is the cheapest fix in the game. Second, the trend: an ADR that drifts up over your recent matches on the maps you keep playing is real improvement, whatever any single scoreboard said.`}
      </p>
      <p>
        {`To see where the damage actually came from, drop a match into the `}
        <Link href="/demos">demo analyzer</Link>
        {` and it breaks the game down round by round — or put your profile next to a friend's in the `}
        <Link href="/compare">comparison tool</Link>
        {` and settle whose 85 ADR is doing more work. And if a suspiciously high ADR is what brought you here, read the guide on `}
        <Link href="/guides/spotting-smurfs-and-cheaters">
          {`spotting smurfs & cheaters`}
        </Link>
        {` first — outlier numbers are a starting point for a closer look, never a verdict.`}
      </p>
    </GuideArticle>
  );
}
