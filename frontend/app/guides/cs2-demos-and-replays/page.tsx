import type { Metadata } from "next";
import Link from "next/link";
import { guideBySlug } from "@/lib/guides";
import { SITE_NAME } from "@/lib/site";
import { GuideArticle } from "@/components/guide/GuideArticle";

const g = guideBySlug("cs2-demos-and-replays")!;

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
    q: "How long are CS2 matchmaking demos available to download?",
    a: "Only for a limited window — typically a matter of weeks — and only your recent matches are listed in-game. Download anything you care about promptly — a saved file is yours for good. FACEIT demos stay attached to their match rooms, where anyone with access can download them.",
  },
  {
    q: "What is a CS2 share code?",
    a: "A short identifier for one matchmaking match, in the form CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx. It does not contain the demo itself — it encodes the IDs a tool needs to fetch that match's demo from Valve, so pasting a share code into a supporting tool is enough to retrieve and analyze the game.",
  },
  {
    q: "Can I watch a demo from the enemy's point of view?",
    a: "Yes. A demo is a server-side recording of the whole match, so every player's perspective is in the file. Re-watching your deaths from the killer's view is one of the fastest ways to understand what actually went wrong.",
  },
  {
    q: "Why does an old demo no longer play?",
    a: "Demos are tied to the game build that recorded them, and big updates sometimes break playback of older files in the client. Analysis tools that parse the file directly tend to be more tolerant, so a demo the game refuses to play can often still be analyzed.",
  },
];

export default function Page() {
  return (
    <GuideArticle guide={g} faq={FAQ}>
      <p>{`Every match of Counter-Strike 2 you play is recorded. The demo — a .dem file the server writes as the game runs — contains every player's position, view angle and action for the entire match, and for your own games it is free to download. That makes demos the cheapest improvement tool in the game: they show you exactly why you died instead of leaving you to guess — and getting hold of them is easier than most players realize.`}</p>

      <h2>What a demo file actually is</h2>
      <p>{`A demo is not a video. It is a recording of the full match state — every position, shot, grenade and kill for all ten players — which the game re-simulates when you press play. That is why you can watch from anyone's perspective, fly around in a free camera or jump straight to round 19: the file contains the whole match, not one player's screen.`}</p>
      <p>{`Two practical consequences. First, demos are big — a full CS2 match often runs to a few hundred megabytes. Second, they are tied to the game that recorded them: after a major update, older demos sometimes refuse to play in the client, even though tools that parse the file directly can usually still read them.`}</p>

      <h2>Where to get demos, at a glance</h2>
      <table>
        <thead>
          <tr>
            <th>Source</th>
            <th>Where</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Matchmaking / Premier</td>
            <td>In-game: Watch → Your Matches</td>
            <td>{`Recent matches only; downloads to the game's replays folder`}</td>
          </tr>
          <tr>
            <td>FACEIT</td>
            <td>The match room page</td>
            <td>{`Anyone with room access can download; extract the .gz first`}</td>
          </tr>
          <tr>
            <td>Share code</td>
            <td>Copied from a match, or via Steam</td>
            <td>{`A pointer to the match — tools use it to fetch the demo`}</td>
          </tr>
        </tbody>
      </table>

      <h2>Downloading your matchmaking and Premier replays</h2>
      <p>{`Your own competitive, Premier and Wingman matches are downloadable in-game. Open the Watch section of the main menu, go to Your Matches, and each listed match has a download option. The file lands inside your game installation — under steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\replays — and once it is on disk you can start it from the same menu, or with the playdemo command in the console.`}</p>
      <p>{`The catch is the window: Valve only keeps a match available for a limited time — weeks, not months — and only your recent games are listed. If a match matters to you, grab it promptly. The local file is yours forever.`}</p>

      <h2>FACEIT demos</h2>
      <p>{`FACEIT makes this easier: every match room keeps its demo attached to the match page, and anyone who can open the room can download it. The file arrives compressed as a .gz archive, so extract it to get the .dem before playing or uploading it anywhere.`}</p>
      <p>
        {`Because you can grab any room's demo — not just your own — FACEIT demos are also the standard way to scout an opponent: pull one of their recent matches and watch how a `}
        <Link href="/guides/faceit-levels-and-elo">level 10</Link>
        {` actually plays before you have to face one.`}
      </p>

      <h2>Share codes: the machine-readable way in</h2>
      <p>{`A share code is a short identifier for one matchmaking match, in the form CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx. It does not contain the demo; it encodes the match and outcome IDs a tool needs to request that demo from Valve. You can copy the code for a recent match from the Watch section in-game, and Steam's help pages let you issue a match-history authentication code so that tools you trust can walk your match history onward from your newest share code.`}</p>
      <p>{`This is why share codes matter: paste one into a tool that supports them and it can fetch and analyze the match with no manual downloading.`}</p>

      <h2>How to actually watch a demo</h2>
      <p>{`Load a demo and you get a playback bar: pause, scrub, jump between rounds, and change speed from slow motion up to several times normal. If the panel is hidden, the demoui console command brings it up. Turn X-ray on so you can see every player through walls — for review you almost always want it.`}</p>
      <p>{`The biggest mistake is watching a demo like a movie. Watch with intent instead:`}</p>
      <ul>
        <li>{`Follow one player — usually yourself — locked to their view for a whole half, rather than chasing whoever has the action.`}</li>
        <li>{`Fast-forward the dead time. Run buy phases and rotations at high speed and drop to normal — or slower — only for the fights.`}</li>
        <li>{`Watch every one of your deaths. The ten seconds before each one answer most questions: was the fight worth taking, where was your crosshair, did you have information or just hope?`}</li>
        <li>{`Re-watch the key deaths from the killer's perspective. Seeing what they saw tells you whether you were outplayed, out-positioned or simply unlucky.`}</li>
      </ul>

      <h2>Review one theme at a time</h2>
      <p>{`A full match takes forty-plus minutes to watch honestly, which is why most players stop reviewing within a week of starting. The fix is to review a single theme per session, in 15–20 minutes, and skip everything else:`}</p>
      <table>
        <thead>
          <tr>
            <th>Theme</th>
            <th>What to watch</th>
            <th>Question to answer</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Deaths</td>
            <td>{`The last ten seconds before each of your deaths`}</td>
            <td>{`Was that fight worth taking, and on whose terms?`}</td>
          </tr>
          <tr>
            <td>Opening duels</td>
            <td>{`The first contact of each round, from your POV`}</td>
            <td>{`Do I take first fights on purpose, with support — or by accident?`}</td>
          </tr>
          <tr>
            <td>Utility</td>
            <td>{`Every grenade you threw`}</td>
            <td>{`Did each grenade buy damage, space or time — or was it a habit?`}</td>
          </tr>
          <tr>
            <td>Late rounds</td>
            <td>{`Rounds where you were last alive`}</td>
            <td>{`Did I play the clock, the information and the bomb, or hunt kills?`}</td>
          </tr>
        </tbody>
      </table>
      <p>{`One theme, a handful of rounds, a note or two — then stop. Ten focused minutes beat two glazed-over hours.`}</p>

      <h2>What automated demo analysis extracts</h2>
      <p>{`Software reads the whole file at once, so a parsed demo yields the round-context numbers a scoreboard never shows:`}</p>
      <ul>
        <li>{`Opening duels — who took the first fight of each round, and who won it.`}</li>
        <li>{`Trades — whether deaths were avenged quickly enough to matter. ${SITE_NAME}'s analyzer counts a trade when the avenging kill lands within five seconds of the original death.`}</li>
        <li>{`Clutches — 1vX situations and how they ended, including whether a defuse was realistically on.`}</li>
        <li>{`Utility usage — flash assists, enemies blinded, grenade damage, and where your utility actually landed.`}</li>
        <li>{`Crosshair placement and reaction time — how far your aim had to travel when an enemy appeared, and how long you took to fire.`}</li>
      </ul>
      <p>
        These are the same per-player fundamentals that Leetify rolls into its
        ratings — our guide to{" "}
        <Link href="/guides/good-leetify-rating">Leetify ratings</Link> explains
        how to read them — and the extreme ends of them, such as implausible
        reaction times or pre-aim locked through walls, are among the anomalies
        covered in{" "}
        <Link href="/guides/spotting-smurfs-and-cheaters">
          spotting smurfs &amp; cheaters
        </Link>
        . The same caution applies here: those numbers mark a spot worth a
        closer look, never proof on their own.
      </p>

      <h2>Analyze a demo on {SITE_NAME}</h2>
      <p>
        Drop a .dem file — or paste a direct demo link — into the{" "}
        <Link href="/demos">demo analyzer</Link> and it turns the match into a
        2D radar replay: round-by-round movement routes, kill positions tagged
        as opening kills and trades, weapon and utility breakdowns, and
        playstyle tendencies for every player in the lobby. Your analyzed
        matches stay in a library in your own browser.
      </p>
      <p>
        {`To put a demo in context, look the players up on `}
        <Link href="/">{SITE_NAME}</Link>
        {` for their ranks and recent form — and if you want demos worth stealing ideas from, the `}
        <Link href="/pro-matches">pro matches</Link>
        {` section tracks the professional scene's results and events.`}
      </p>
    </GuideArticle>
  );
}
