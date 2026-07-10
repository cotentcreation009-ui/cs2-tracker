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

const FAQ = [
  {
    q: "What ELO is FACEIT level 10?",
    a: "Level 10 begins at 2,001 ELO and has no upper limit, so the badge alone hides a huge range — from a fresh level 10 to a pro sitting well above 3,000. That is why the exact ELO number matters more than the level once you reach the top tier.",
  },
  {
    q: "How much ELO do you gain or lose per match?",
    a: "Roughly 25 points, up on a win and down on a loss. The exact figure is adjusted by the ELO gap between the teams: beating a stronger team gains more than 25, and losing to a weaker one costs more.",
  },
  {
    q: "Is a FACEIT level the same as a Premier rank?",
    a: "No. FACEIT level and Valve's Premier CS Rating are separate ladders that do not convert cleanly. A player can be level 10 on FACEIT while still climbing in Premier, or the reverse.",
  },
];

export default function Page() {
  return (
    <GuideArticle guide={g} faq={FAQ}>
      <p>{`FACEIT is a third-party matchmaking platform for Counter-Strike 2 with its own ranking system. Instead of Valve's Premier CS Rating, FACEIT sorts players into ten levels — and those levels are driven entirely by a single hidden number: your ELO.`}</p>

      <h2>The FACEIT level table</h2>
      <p>{`Your level is simply a band of ELO. Climb past the top of your band and you rank up; drop below its floor and you rank down. Here is the full mapping for CS2:`}</p>
      <table>
        <thead>
          <tr>
            <th>Level</th>
            <th>ELO range</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Level 1</td>
            <td>100 – 500</td>
          </tr>
          <tr>
            <td>Level 2</td>
            <td>501 – 750</td>
          </tr>
          <tr>
            <td>Level 3</td>
            <td>751 – 900</td>
          </tr>
          <tr>
            <td>Level 4</td>
            <td>901 – 1,050</td>
          </tr>
          <tr>
            <td>Level 5</td>
            <td>1,051 – 1,200</td>
          </tr>
          <tr>
            <td>Level 6</td>
            <td>1,201 – 1,350</td>
          </tr>
          <tr>
            <td>Level 7</td>
            <td>1,351 – 1,530</td>
          </tr>
          <tr>
            <td>Level 8</td>
            <td>1,531 – 1,750</td>
          </tr>
          <tr>
            <td>Level 9</td>
            <td>1,751 – 2,000</td>
          </tr>
          <tr>
            <td>Level 10</td>
            <td>2,001+</td>
          </tr>
        </tbody>
      </table>
      <p>{`Level 10 has no upper cap — the strongest players sit anywhere from 2,001 to well over 3,500 ELO, which is why two "level 10" players can be worlds apart. Once you reach the top tier, the raw ELO number tells you far more than the badge.`}</p>

      <h2>How ELO is gained and lost</h2>
      <p>{`Each match moves your ELO by roughly 25 points — up on a win, down on a loss. The exact amount is adjusted by how your team's average ELO compares with the enemy's: beat a stronger team and you gain more than 25; lose to a weaker one and you drop more, while stomping a much weaker team earns less. Over time this pulls your ELO toward the level your results actually deserve.`}</p>
      <p>{`New accounts do not start from zero. Your first handful of matches act as placement games that seed an initial ELO, after which the normal win/loss maths takes over.`}</p>

      <h2>What counts as a good FACEIT level?</h2>
      <p>{`It depends who you ask, but as a rough map of the ladder:`}</p>
      <ul>
        <li>{`Levels 1–3 (100–900 ELO): newer or more casual players still building the fundamentals.`}</li>
        <li>{`Levels 4–7 (901–1,530 ELO): the broad middle — dependable mechanics and game sense, where most of the active player base sits.`}</li>
        <li>{`Levels 8–9 (1,531–2,000 ELO): strong, consistent players; level 9 is the doorstep of the top tier.`}</li>
        <li>{`Level 10 (2,001+ ELO): the top rank, running from very good players all the way up to semi-pro and pro-adjacent talent.`}</li>
      </ul>
      <p>{`Because the population is not spread evenly, the typical active FACEIT player tends to land around levels 4–6 rather than exactly in the middle.`}</p>

      <h2>FACEIT level vs Premier CS Rating</h2>
      <p>{`FACEIT level and Valve's Premier CS Rating measure skill on two separate ladders, so they do not convert cleanly. Someone can be level 10 on FACEIT while still climbing in Premier, or the other way around. Comparing the two is most useful as a consistency check: a large gap between a player's FACEIT level and their Premier rating is one of the signals worth a closer look.`}</p>

      <h2>Check any player's level and ELO</h2>
      <p>
        Want to see where you or a teammate lands? Paste any SteamID, vanity name
        or profile URL into <Link href="/">{SITE_NAME}</Link> and it shows the
        exact FACEIT level and ELO alongside Premier, Leetify and Steam data — or
        put two accounts side by side in the{" "}
        <Link href="/compare">comparison tool</Link>.
      </p>
    </GuideArticle>
  );
}
