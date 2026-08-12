import type { Metadata } from "next";
import Link from "next/link";
import { guideBySlug } from "@/lib/guides";
import { SITE_NAME } from "@/lib/site";
import { GuideArticle } from "@/components/guide/GuideArticle";

const g = guideBySlug("crosshair-placement-and-preaim")!;

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
    q: "What is a good preaim number in degrees?",
    a: "Lower is always better, and the exact averages depend on the tool doing the measuring and the rank you play at. As a rough read: low single digits means your crosshair is usually near where enemies appear, while consistently double-digit values mean you are aiming at floors and walls and paying for it in every duel.",
  },
  {
    q: "What is a good reaction time in CS2?",
    a: "Simple human reaction to something appearing on screen is roughly a quarter of a second for most adults, and in-game time to damage sits higher than that because it also includes recognizing the enemy, adjusting your crosshair and firing. Several hundred milliseconds is normal territory. Rather than chasing a smaller raw number, shrink the adjustment part with better crosshair placement.",
  },
  {
    q: "Do aim trainers improve crosshair placement?",
    a: "Not directly. Aim trainers sharpen raw mechanics — flicks, micro-adjustments, tracking — but preaim is map knowledge plus habit, and it only improves in environments with real angles: prefire maps, deathmatch and actual matches. Use trainers as a warm-up and mechanics supplement, not as the main course.",
  },
  {
    q: "Why is my aim good in deathmatch but bad in real matches?",
    a: "Deathmatch removes consequences, so you take every fight relaxed, stationary and on your own terms. In a match, nerves, moving while shooting and peeking angles you have not cleared all widen your effective preaim and slow your time to damage. Playing deathmatch deliberately — clearing angles as if the round mattered — closes most of the gap.",
  },
];

export default function Page() {
  return (
    <GuideArticle guide={g} faq={FAQ}>
      <p>{`Demo analysis has quietly settled an old argument: what separates average CS2 players from strong ones is rarely reaction speed. It is crosshair placement — where your crosshair already was in the instant before an enemy appeared. And unlike "game sense", this is measurable. Modern stat tools put three hard numbers on your aim: preaim in degrees, time to damage in milliseconds, and spray accuracy in percent. Learn to read them and you know exactly what to train.`}</p>

      <h2>The three numbers that describe your aim</h2>
      <p>{`When a tool parses a demo, it can reconstruct every duel: where each player was looking, when an enemy model became visible to them, and when the first bullet connected. From that, three core stats fall out:`}</p>
      <table>
        <thead>
          <tr>
            <th>Stat</th>
            <th>What it measures</th>
            <th>Good direction</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Preaim (crosshair placement)</td>
            <td>How far your crosshair was from the enemy, in degrees, at the moment they became visible</td>
            <td>Lower</td>
          </tr>
          <tr>
            <td>Time to damage</td>
            <td>Milliseconds from an enemy becoming visible to you first dealing damage to them</td>
            <td>Lower</td>
          </tr>
          <tr>
            <td>Spray accuracy</td>
            <td>What share of the bullets in your sprays actually hit</td>
            <td>Higher</td>
          </tr>
        </tbody>
      </table>
      <p>{`Some tools add relatives of these — counter-strafing quality, headshot percentage, accuracy on the first bullet — but preaim, time to damage and spray accuracy carry most of the signal. Together they answer, in order: was your crosshair in the right place, how quickly did you punish what you saw, and did your bullets go where you pointed?`}</p>

      <h2>Preaim: the degrees your crosshair was wrong</h2>
      <p>{`Preaim is measured as an angle. Zero degrees means your crosshair was already on the enemy when they appeared; a big number means it was parked on a wall, a floor or an empty doorway and you had to drag it the whole way. Because it is captured at the moment of visibility, preaim is really a measure of prediction — it rewards knowing where enemies stand before you ever see them. That is why it is one of the stats that tracks rank most closely: it is compressed map knowledge, not hand speed.`}</p>
      <p>{`Distance makes this brutal. A head-sized target far down a long sightline covers a tiny slice of your screen, so even a small placement error means your first shot misses and the duel becomes a scramble. Up close the same error matters less — one reason players with lazy crosshairs feel fine on cramped maps and fall apart on open ones.`}</p>

      <h2>{`Time to damage: what "fast" really means`}</h2>
      <p>{`Time to damage sounds like a reflex test, but it is mostly a placement test wearing a stopwatch. The clock starts when an enemy becomes visible and stops when you first damage them, so it bundles together raw human reaction (roughly a quarter of a second for most adults, and not very trainable), recognizing the target, moving your crosshair onto it, and firing accurately. In-game values therefore sit in the several-hundred-millisecond range for most players — noticeably slower than a pure click-test, and that is normal.`}</p>
      <p>{`The useful insight is which slice of that time you can actually shrink. Your raw reaction is close to fixed. The adjustment — dragging the crosshair from where it was to where the enemy is — is almost entirely under your control, because good preaim makes it nearly zero. One caution while reading other people's numbers: implausibly low, machine-consistent reaction stats are one of the classic anomalies flagged in our guide to `}<Link href="/guides/spotting-smurfs-and-cheaters">spotting smurfs and cheaters</Link>{` — a signal worth a look, never proof on its own, since genuinely elite players post outlier numbers too.`}</p>

      <h2>Why placement beats reflexes</h2>
      <p>{`Run the arithmetic on a rifle duel. Two players have identical, ordinary reflexes — call it a quarter of a second. Player A holds the corner at head height, crosshair resting exactly where an attacker's head will cross. Player B watches the same corner with the crosshair drifting somewhere low and central. The enemy peeks. A pays only their raw reaction plus a click. B pays the same reaction, then a long flick, and because long flicks land imprecisely, often a correction too — easily an extra tenth of a second or more. In a game where a single headshot from a rifle can end the fight, that gap decides the duel far more often than any difference in reflexes could.`}</p>
      <p>{`This is also the optimistic part. Raw reflexes are mostly fixed and respond little to training; placement is knowledge and habit, and improves at any age with deliberate practice. It is the highest-leverage aim work available to a normal player.`}</p>

      <h2>The habits that produce good numbers</h2>
      <ul>
        <li>{`Head height, always. Keep the crosshair at the height an enemy's head will actually be — and remember that height shifts on ramps, stairs and boxes. Riding head level along walls as you move is the single habit that most lowers preaim.`}</li>
        <li>{`Pre-aim common angles. Every map has a short list of default positions per area. Snap your crosshair to the next likely one before it is in view, so "reacting" becomes "clicking".`}</li>
        <li>{`Clear one angle at a time. Slice each corner gradually instead of swinging into three angles at once; your crosshair can only be right about one place, so structure your movement to face exactly one threat at a time.`}</li>
        <li>{`Hug the edges of cover with the crosshair, not the middle of walls. Enemies appear at edges — that is where the crosshair should wait.`}</li>
        <li>{`Counter-strafe before you shoot. Rifles are accurate when you are still; tapping the opposite movement key stops you almost instantly, so the first bullet actually goes where your well-placed crosshair points.`}</li>
      </ul>

      <h2>Drills that move each number</h2>
      <p>{`None of this needs a coach. It needs repetitions with intent:`}</p>
      <ol>
        <li>{`Deathmatch with purpose. Pick one map and one rifle, and grade yourself only on placement: was the crosshair at head height at the moment each fight started? Ignore the scoreboard; treat every death as information about where your crosshair was not.`}</li>
        <li>{`Prefire maps. Community workshop maps spawn bots at the common positions of a real map so you can rehearse the pre-aim path through each area until it is muscle memory. This is the most direct preaim training that exists, and it doubles as map study.`}</li>
        <li>{`Aim trainers, used right. Ten to fifteen minutes of flicks, micro-corrections and tracking is a fine warm-up and keeps raw mechanics sharp — but trainers contain no angles to pre-aim, so they cannot fix placement. Treat them as a supplement.`}</li>
        <li>{`Watch the deaths. Reviewing your own demo and asking "where was my crosshair when I died?" turns vague frustration into a specific, fixable error. Watching a pro POV with the same question is just as instructive — the crosshair almost never leaves head height — and you can follow the pro scene's schedule and results on our `}<Link href="/pro-matches">pro matches</Link>{` pages.`}</li>
      </ol>

      <h2>Reading your numbers, and what to fix first</h2>
      <p>
        To see where you stand, drop a demo into the{" "}
        <Link href="/demos">{SITE_NAME} demo analyzer</Link> for a round-by-round
        breakdown of a single match, or paste your SteamID or profile URL into{" "}
        <Link href="/">{SITE_NAME}</Link> to see aim stats in the context of your
        whole profile — and put yourself next to a teammate in the{" "}
        <Link href="/compare">comparison tool</Link> to find out whose crosshair
        is really carrying. A sensible repair order:
      </p>
      <ul>
        <li>{`High preaim error: start here, always. Prefire maps plus placement-focused deathmatch. Nothing else pays off while the crosshair starts every duel in the wrong place.`}</li>
        <li>{`Placement fine but time to damage slow: the lag is usually hesitation or shooting on the move — drill counter-strafing and commit to fights faster.`}</li>
        <li>{`First shots landing but sprays whiffing: spend time on recoil control for your main rifle, and burst at longer ranges instead of holding the trigger.`}</li>
      </ul>
      <p>
        Fix one number at a time, and judge progress over ten or twenty matches
        rather than one good evening. For deciding which weakness matters most
        overall — aim, utility or positioning — our guide to{" "}
        <Link href="/guides/good-leetify-rating">reading a Leetify rating</Link>{" "}
        covers the triage, and if you are wondering whether the numbers you are
        posting are normal for your rank, see how the ladder itself is put
        together in{" "}
        <Link href="/guides/faceit-levels-and-elo">FACEIT levels &amp; ELO</Link>.
      </p>
    </GuideArticle>
  );
}
