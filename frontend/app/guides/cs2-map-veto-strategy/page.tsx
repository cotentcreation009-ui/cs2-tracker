import type { Metadata } from "next";
import Link from "next/link";
import { guideBySlug } from "@/lib/guides";
import { SITE_NAME } from "@/lib/site";
import { GuideArticle } from "@/components/guide/GuideArticle";

const g = guideBySlug("cs2-map-veto-strategy")!;

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
    q: "What map should I permaban in CS2?",
    a: "The map with your worst win rate over a meaningful sample — roughly twenty or more games — not the map you find most boring. Plenty of players ban a map they barely queue while quietly bleeding rating on one they play every day. Check your per-map numbers before deciding; the honest answer is often a surprise.",
  },
  {
    q: "Should you ban the enemy's best map or protect your own pick in a Bo3?",
    a: "Both are legitimate schools. If your pick is strong against most opponents, spend your bans denying the enemy's comfort maps; if your pick has one clear counter left in the pool, burn a ban protecting it instead. Pro teams switch between the two depending on the opponent, and so should you.",
  },
  {
    q: "How can I see the other team's map stats before a match?",
    a: `Their recent match history is public on their profiles: maps that keep appearing are comfort picks, and a map that never appears is usually a permaban. Scan the last twenty or thirty matches for each enemy name and note which maps repeat — a few minutes of scrolling before a league match is enough to predict most vetos.`,
  },
  {
    q: "Does the veto matter in solo queue if I barely get a say?",
    a: "Yes, but the lever changes. You rarely control the outcome on your own, so the best investment is a deeper map pool — being playable on five maps instead of two means the veto cannot hurt you much however it falls.",
  },
];

export default function Page() {
  return (
    <GuideArticle guide={g} faq={FAQ}>
      <p>{`The veto is the only part of a Counter-Strike 2 match you can win before anyone buys a pistol. Most players treat it as a loading screen: ban the map they dislike, shrug at whatever survives. Treat it instead as round zero — with two minutes of preparation and an honest read of your own numbers, you can tilt the map decision toward the thirty-round game you are most likely to win.`}</p>

      <h2>Why the veto is round zero</h2>
      <p>{`Map advantage is real. A team on a map it has drilled plays faster defaults, cleaner retakes and better utility than the same five players dropped onto a map they see twice a month. Nobody publishes an exact figure for what a map is worth in rating, but everyone serious behaves as if it is worth a lot: professional teams build entire preparation sessions around the veto alone. The same edge exists in a FACEIT queue — smaller, but real — and unlike aim, it costs nothing to collect. You just have to know three things: your own map numbers, the enemy's likely bans, and the logic of the format you are in.`}</p>

      <h2>Know your own numbers before you ban</h2>
      <p>{`For each map in the pool you care about two figures: how often you actually play it, and how often you win it. Say your recent history looks like this:`}</p>
      <table>
        <thead>
          <tr>
            <th>Map</th>
            <th>Played (recent)</th>
            <th>Win rate</th>
            <th>The honest read</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Mirage</td>
            <td>48</td>
            <td>54%</td>
            <td>Your bread and butter — protect it</td>
          </tr>
          <tr>
            <td>Inferno</td>
            <td>31</td>
            <td>49%</td>
            <td>A coin flip — fine to leave in</td>
          </tr>
          <tr>
            <td>Nuke</td>
            <td>6</td>
            <td>33%</td>
            <td>Unknown, not bad — six games is noise</td>
          </tr>
          <tr>
            <td>Ancient</td>
            <td>22</td>
            <td>36%</td>
            <td>Your real permaban</td>
          </tr>
          <tr>
            <td>Dust2</td>
            <td>15</td>
            <td>60%</td>
            <td>Small sample, but a sneaky pick</td>
          </tr>
        </tbody>
      </table>
      <p>{`Two lessons hide in a table like that. First, your permaban should be your worst-performing map over a real sample — here Ancient, at 36% across twenty-two games — and that is often not the map you would have named from feel. Players habitually ban the map they find boring, or the one they lost on last night, while donating rating on a map they queue daily. Second, a bad win rate over a handful of games means almost nothing. The Nuke line above is not evidence of weakness; it is an unknown. Below roughly twenty games, treat a map as unmeasured rather than bad.`}</p>

      <h2>Reading the enemy before the veto starts</h2>
      <p>{`The other half of the veto is that your opponents' history is just as public as yours. Pull up their recent matches and the pattern is usually obvious within thirty seconds: a map that appears over and over is a comfort pick, and a map that never appears at all is almost certainly their permaban. From those two facts you can predict most of their veto before it happens — what they will remove first, and what they are steering toward. In a queue where the "team" is five strangers, read the two or three strongest players instead: whoever carries the rating tends to drag the vote toward their own comfort maps.`}</p>

      <h2>Bo1 and Bo3 are different games</h2>
      <p>{`Most matchmaking — FACEIT queues and Premier alike — is best-of-one, and a Bo1 veto is pure denial. There is nothing to pick and nothing to protect; both sides simply ban until one map survives. So the logic is blunt: remove your own worst maps first, because the map that gets played is the one nobody hated enough to kill. That is also why Bo1 results cluster on the pool's mainstays — maps like Mirage and Inferno survive vetoes precisely because everyone tolerates them.`}</p>
      <p>{`Best-of-three, the format of leagues, tournaments and pro play, adds picks — and with them an actual decision. The common shape, though exact orders vary by platform and event, is that each side bans, each side picks a map, and a decider is left over. The strategic question is what your bans are for, and there are two schools. The denial school spends them on the enemy's best maps, reasoning that your pick is safe enough on its own. The protection school spends them on whatever most threatens your pick, reasoning that a pick you lose is worth nothing. Neither is always right: deny when your pick is strong against most opponents, protect when one clear counter to it is still sitting in the pool. Watching how professional teams handle the same choice on `}<Link href="/pro-matches">the pro circuit</Link>{` is a free education — put a series result next to the two teams' recent map records and the veto reasoning is usually legible.`}</p>

      <h2>Solo queue and five-stacks want different things</h2>
      <p>{`In solo queue you rarely control the veto at all — in Premier your preference is one voice among five, and a FACEIT match room hands the bans to a captain — so the highest-value investment is depth, not vetoing skill: a player who is genuinely playable on five maps cannot be hurt much by any veto, while a two-map player is gambling every time the lobby votes. It also changes how you should react when your ban does not go through — the map you hate is now the map you are playing, and one learned default position on it is worth more than ten minutes of tilt. In a five-stack the calculus flips. You own the whole veto, so run it like a plan: agree the team's permaban and preferred pick before queuing, and give one player the job of checking the enemy's recent maps while the rest warm up.`}</p>

      <h2>Float maps decide more vetoes than picks do</h2>
      <p>{`The active competitive pool sits at seven maps as of recent seasons, and each team realistically wants to kill two or three of them. Those bans overlap far more often than not — most lobbies hate the same maps — so the veto usually collapses to a shared pool of just two or three realistic outcomes. The maps in that overlap are the floats: the ones neither team picks and neither team hates enough to burn a ban on. In a Bo1 the surviving map is very often a float, and in a Bo3 the decider almost always is. This points at an unglamorous practice priority: extra hours on your best map are partly wasted, because good opponents ban it — while hours on the likely floats are hours on the maps you will actually be forced to play.`}</p>

      <h2>See both teams' map form during the veto</h2>
      <p>
        {`All of this is faster when the numbers are in front of you. The ${SITE_NAME} browser extension builds a panel directly into the FACEIT match room showing recent per-map form for both teams — how often each side has queued every map lately and how those games went — which is exactly the read you want while the veto is live. Before a match, you can put any two players side by side in the `}
        <Link href="/compare">comparison tool</Link>
        {` to see whose comfort maps will drive a vote, or paste any profile into `}
        <Link href="/">{SITE_NAME}</Link>
        {` for the full cross-platform picture. And since map form only matters in the context of the rating it feeds, our guide to `}
        <Link href="/guides/faceit-levels-and-elo">FACEIT levels and ELO</Link>
        {` explains what those wins and losses are actually worth.`}
      </p>
    </GuideArticle>
  );
}
