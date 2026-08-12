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

const FAQ = [
  {
    q: "Is FACEIT harder than Premier?",
    a: "In practice, usually — FACEIT's opt-in population gives it a higher skill floor, so its lobbies tend to play more seriously than equivalent-looking Premier matches, especially in Europe. But both ladders reach very high levels at the top, so 'harder' describes the average lobby, not the ceiling.",
  },
  {
    q: "Do I have to install the FACEIT anti-cheat client?",
    a: "Yes. Queueing on FACEIT requires its anti-cheat client, which runs at kernel level and must be active while you play. The platform itself is free to use; the client is the non-negotiable part.",
  },
  {
    q: "Which ladder should a new CS2 player start on?",
    a: "Competitive first — its per-map ranks make it the natural place to learn the map pool with nothing at stake elsewhere. Move to Premier once you want a single number tracking your overall level, and add FACEIT when you care about stricter anti-cheat or finding a team.",
  },
  {
    q: "Do FACEIT matches affect my Premier CS Rating?",
    a: "No. FACEIT matches are played on FACEIT's own servers and only move your FACEIT ELO. Your CS Rating changes only through Premier matches on Valve's official servers, so you can grind both ladders in parallel without one touching the other.",
  },
];

export default function Page() {
  return (
    <GuideArticle guide={g} faq={FAQ}>
      <p>{`Counter-Strike 2 gives you three ranked-shaped places to play: Valve's Premier mode, the classic per-map Competitive queue, and the third-party FACEIT platform. The short version: Premier is the right default if you just want ranked CS2 with nothing to install, FACEIT is where you go once you care about stricter anti-cheat, tougher lobbies and organized team play, and regular Competitive works best as the lower-stakes ladder for learning maps and warming up. The longer version depends on your region, your tolerance for a kernel-level anti-cheat client, and what you actually want from the game.`}</p>

      <h2>The three ladders at a glance</h2>
      <p>{`Each queue is built for a different question. Premier asks how good you are at the full competitive game: a pick-and-ban phase across the active-duty map pool, MR12 matches, and a visible CS Rating number instead of a badge, recalibrated between seasons. Competitive asks how good you are at one map at a time — it hands out the classic Silver-to-Global-Elite skill groups separately for each map. FACEIT sits outside the game entirely: a free third-party platform whose ten levels are driven by ELO, with its own client, its own servers and a whole competitive ecosystem bolted on.`}</p>
      <table>
        <thead>
          <tr>
            <th>Ladder</th>
            <th>Ranking system</th>
            <th>Anti-cheat</th>
            <th>Best for</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Premier</td>
            <td>CS Rating — one visible number, seasonal</td>
            <td>VAC + VAC Live</td>
            <td>The main ranked ladder</td>
          </tr>
          <tr>
            <td>Competitive</td>
            <td>Skill groups per map, Silver I – Global Elite</td>
            <td>VAC + VAC Live</td>
            <td>Learning maps, lower-stakes ranked</td>
          </tr>
          <tr>
            <td>FACEIT</td>
            <td>Levels 1–10, driven by ELO</td>
            <td>FACEIT client (kernel-level)</td>
            <td>Serious grinding, hubs and leagues</td>
          </tr>
        </tbody>
      </table>
      <p>{`None of the three talks to the others. Your CS Rating, your per-map skill groups and your FACEIT ELO all move independently, which is why the same person can look like three different players depending on where you check.`}</p>

      <h2>Anti-cheat: the biggest practical difference</h2>
      <p>{`On Valve's servers you are protected by VAC plus VAC Live, which can cancel a match in progress when the system is confident someone is cheating, backed by Trust Factor matchmaking that tries to keep suspicious accounts away from everyone else. Valve's approach is deliberately unintrusive — nothing to install, no special driver — and historically it has leaned on detection plus delayed ban waves rather than blocking cheats in the moment.`}</p>
      <p>{`FACEIT requires its own anti-cheat client, which runs at kernel level and has to be running before you can queue. That depth of access is exactly why many players trust it — it can see classes of cheat that a less privileged system cannot — and exactly why some players refuse to install it on principle. The fair summary: FACEIT's client is widely regarded as the stricter of the two and its lobbies are broadly seen as cleaner, especially at higher ratings, but no anti-cheat catches everything, and VAC Live has narrowed the gap since CS2 launched. If cheaters are the main reason you tilt, FACEIT is the conventional answer; whether that is worth a kernel-level install is a genuinely personal call.`}</p>

      <h2>Servers: 128 tick meets subtick</h2>
      <p>{`In CS:GO the comparison was easy: Valve ran 64-tick servers, FACEIT ran 128-tick, and 128 was simply better. CS2 muddied it. Valve rebuilt the netcode around subtick updates, which timestamp every shot and input between ticks — the stated goal being that whether your bullet counts no longer depends on the server's tick rate. Official Premier and Competitive servers run at 64 tick with subtick on top; FACEIT runs its CS2 servers at 128 tick with the same subtick system underneath.`}</p>
      <p>{`How much that still matters is genuinely contested. Shot registration is subtick either way, so the old headline argument is mostly gone; where players most often report a difference is in how movement and grenades feel, and opinions there are split enough that neither side can claim a clean win. The honest conclusion: neither set of servers is broken, some players feel a difference and prefer FACEIT's, and if you cannot tell them apart in practice, tick rate should not be the thing that decides your queue.`}</p>

      <h2>Skill density and queue times</h2>
      <p>{`Because FACEIT is opt-in and skews toward dedicated players, its skill floor sits higher. A fresh FACEIT account's first lobbies routinely play like decent Premier lobbies, and mid-level FACEIT games are usually more structured — more utility, more trading, more communication — than an equivalent-looking Premier match. Regular Competitive is the softest of the three, since much of the serious population plays the other two ladders.`}</p>
      <p>{`Queue times run the other way. Premier is built into the game and has the biggest population, so matches come quickly at almost any rating and hour. FACEIT's depth is heavily regional: in Europe, its historic core, queues are deep at nearly every level, while in North America and smaller regions the pool is thinner, and high-level or late-night queues can stretch from minutes into a long wait. As of recent seasons that is the trade in one sentence — FACEIT buys you tougher, more serious lobbies, priced in queue time everywhere outside Europe.`}</p>

      <h2>Ranks do not convert</h2>
      <p>{`A FACEIT level and a Premier CS Rating are produced by different systems from different matches, and there is no official conversion between them — the community tables that claim one are rough guesses at best. A level 10 can still be climbing Premier, and a high CS Rating says nothing about where the same player would land on FACEIT.`}</p>
      <p>
        How each ladder computes its number is covered in our{" "}
        <Link href="/guides/faceit-levels-and-elo">FACEIT levels &amp; ELO</Link>{" "}
        guide. A large, persistent gap between a player&apos;s two ranks is also one
        of the classic signals worth a closer look — our guide to{" "}
        <Link href="/guides/spotting-smurfs-and-cheaters">
          spotting smurfs &amp; cheaters
        </Link>{" "}
        covers how to weigh it without jumping to conclusions.
      </p>

      <h2>What FACEIT adds: hubs, leagues and prizes</h2>
      <p>{`FACEIT's real moat is everything wrapped around the queue. Hubs are curated communities with their own ladders and rules — regional hubs, organization-run hubs, high-level invite hubs — and many pay out prizes to top finishers. Above the hubs sits organized league play: FACEIT and the historic ESEA league system now live under one roof, with a pyramid running from open divisions up to semi-professional divisions, which makes it the practical on-ramp if you want to compete as a five rather than solo-queue forever. Matches and missions can also earn FACEIT Points to spend in its rewards shop. Valve offers nothing comparable inside the client: Premier's ladder is the whole product, and the road from it toward professional play runs through open qualifiers rather than a league pyramid.`}</p>

      <h2>Pick your ladder</h2>
      <p>{`Match the queue to what you actually want from the game:`}</p>
      <ul>
        <li>{`You want ranked CS2 with nothing to install — queue Premier. It is the default ladder for a reason.`}</li>
        <li>{`You are learning a new map — queue Competitive. Per-map ranks make it the natural practice ladder, and a loss there costs you nothing anywhere else.`}</li>
        <li>{`Cheaters are what tilts you, and you accept a kernel-level client — queue FACEIT.`}</li>
        <li>{`You want a team, structured seasons or a semi-pro path — FACEIT hubs and leagues are the only real option of the three.`}</li>
        <li>{`You solo-queue outside Europe at odd hours — Premier will usually find you a match sooner.`}</li>
        <li>{`You are warming up or playing with much less experienced friends — Competitive or the unranked casual modes keep the stakes low.`}</li>
      </ul>

      <h2>Track FACEIT and Premier on one page</h2>
      <p>
        Because the ladders never talk to each other, the only way to see a
        player whole is side by side. Feed any profile into{" "}
        <Link href="/">{SITE_NAME}</Link> and it shows the account&apos;s
        FACEIT level and ELO next to its Premier CS Rating, Leetify rating and
        Steam identity — one page, all the ladders. To settle a
        &ldquo;which of us is actually better&rdquo; argument, the{" "}
        <Link href="/compare">comparison tool</Link> lines two accounts up stat
        by stat, and if you want to know what the numbers mean, start with{" "}
        <Link href="/guides/good-leetify-rating">
          what counts as a good Leetify rating
        </Link>
        .
      </p>
      <p>
        And when a match feels off — on any ladder — the{" "}
        <Link href="/demos">demo analyzer</Link> breaks the game down round by
        round.
      </p>
    </GuideArticle>
  );
}
