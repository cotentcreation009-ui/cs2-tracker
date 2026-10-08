import type { Metadata } from "next";
import Link from "next/link";
import { guideBySlug } from "@/lib/guides";
import { SITE_NAME } from "@/lib/site";
import { GuideArticle } from "@/components/guide/GuideArticle";

const g = guideBySlug("cs2-bans-explained")!;

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
    q: "How long is a CS2 competitive cooldown?",
    a: "Valve's ladder is 30 minutes for level 1, 2 hours for level 2, 24 hours for level 3 and 7 days for level 4. The level stays on the account for a one-week probation; another offense inside that week raises the level, and each clean week lowers it by one. Levels above 4 exist. Steam Support does not shorten or remove cooldowns.",
  },
  {
    q: "What does 'days since last ban' mean on a Steam profile?",
    a: "It is Steam's DaysSinceLastBan field: the number of days since the most recent VAC or game ban on the account, counting upward every day. A new ban resets it. It does not say which game the ban came from, and a value of 0 with no bans simply means there has never been one.",
  },
  {
    q: "Can a VAC ban be appealed?",
    a: "No. Valve states that VAC bans are permanent and non-negotiable, and Steam Support will not remove one. The only reversals on record have been rare cases where a detection was wrong and Valve lifted the whole wave. Game bans issued by Valve for Counter-Strike work the same way; FACEIT bans can be appealed through a FACEIT support ticket.",
  },
  {
    q: "Does a VAC ban on a profile mean the player cheated in CS2?",
    a: "Not on its own. Steam counts VAC bans across every VAC-secured game and does not name the game. A VAC ban on a profile proves that account was caught cheating in some VAC-secured title at some point; the age of the ban and the account's current activity tell you how much it matters now.",
  },
  {
    q: "What is a trade ban or economy ban?",
    a: "A restriction on trading and the Community Market that Steam applies for scamming, fraud or other market abuse. The API reports it as 'none', 'probation' (a temporary restriction) or 'banned'. It is separate from VAC. A VAC or game ban in CS2 has its own economic effect: items in the banned game's inventory can no longer be traded or sold.",
  },
  {
    q: "How are FACEIT bans different from Steam bans?",
    a: "FACEIT bans lock the FACEIT account, not the Steam account, and they never appear on a Steam profile. As of FACEIT's 2026 policy, cheating draws a five-year ban that grows with each evasion attempt, smurfing starts at three months, and toxicity bans run from days to a year through escalating ban levels; cooldowns for leaving matches are separate and short.",
  },
];

export default function Page() {
  return (
    <GuideArticle guide={g} faq={FAQ}>
      <p>{`"Banned" in a CS2 lobby can mean four different things: a VAC ban, a game ban, a matchmaking cooldown, or a FACEIT ban. They come from different systems, last different lengths of time and show up in different places. This is a working reference for all four: the exact cooldown ladder Valve uses, the ban fields Steam exposes through its API and how ${SITE_NAME} displays them, how bans and ban waves look on a profile over time, FACEIT's ban categories and the durations it has published, what a trade or economy ban is, what can and cannot be appealed, and how to read a profile that carries a ban without jumping to a conclusion.`}</p>

      <h2>The four at a glance</h2>
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Issued by</th>
            <th>Lasts</th>
            <th>Visible on Steam?</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>VAC ban</td>
            <td>Valve Anti-Cheat, automatically</td>
            <td>Permanent</td>
            <td>{`Yes — "VAC ban on record"`}</td>
          </tr>
          <tr>
            <td>Game ban</td>
            <td>{`The game's developer (Valve for CS2), via Steam`}</td>
            <td>Permanent for cheating</td>
            <td>{`Yes — "game ban on record"`}</td>
          </tr>
          <tr>
            <td>Competitive cooldown</td>
            <td>CS2 itself, automatically</td>
            <td>30 minutes to 7 days, escalating</td>
            <td>No</td>
          </tr>
          <tr>
            <td>FACEIT ban</td>
            <td>The FACEIT platform</td>
            <td>Days to permanent, by offense</td>
            <td>No</td>
          </tr>
        </tbody>
      </table>

      <h2>The competitive cooldown ladder</h2>
      <p>{`Cooldowns are the thing most often miscalled a ban. CS2 issues them automatically for abandoning a match, being inactive long enough to be kicked, excessive team damage or team kills, kicking teammates too often, and being kicked too often yourself. The duration depends on the account's current cooldown level, and Valve publishes the ladder:`}</p>
      <table>
        <thead>
          <tr>
            <th>Cooldown level</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Level 1</td>
            <td>30 minutes</td>
          </tr>
          <tr>
            <td>Level 2</td>
            <td>2 hours</td>
          </tr>
          <tr>
            <td>Level 3</td>
            <td>24 hours</td>
          </tr>
          <tr>
            <td>Level 4</td>
            <td>7 days</td>
          </tr>
        </tbody>
      </table>
      <p>
        <em>{`Valve's published Counter-Strike competitive cooldown levels, as of writing.`}</em>
      </p>
      <p>{`The escalation rules are the part players get wrong. When a cooldown is issued, the account's cooldown level stays on it for a one-week probationary period; any further cooldown inside that week raises the level by one, so a second abandon within a week of the first is a two-hour cooldown, not another 30 minutes. Each full week without a new cooldown lowers the level by one. Valve states that levels can exceed 4, and that cooldowns are non-negotiable: Steam Support does not shorten or remove them. Team-damage incidents usually produce a warning before a cooldown; abandons and kicks do not.`}</p>
      <p>{`A cooldown is a penalty for behavior, not a verdict about cheating. It expires on its own and leaves no mark on the Steam profile. A teammate who says they were "banned for a week" almost always means a level-4 cooldown.`}</p>

      <h2>VAC bans</h2>
      <p>{`Valve Anti-Cheat runs on every VAC-secured server, which includes all official CS2 matchmaking. It looks for known cheat software, and a positive detection produces a ban that is permanent, tied to the account, and public. Detection and punishment are deliberately separated in time: VAC bans often land in waves days or weeks after the session where the cheat was observed, so that cheat developers cannot tell which version was caught.`}</p>
      <p>{`A VAC ban locks the account out of VAC-secured servers for the banned game, and items in that game's inventory can no longer be traded or sold on the Community Market. Two further rules matter when you read a profile. The ban is for a game, and a VAC ban in any VAC-secured title shows on the profile in exactly the same words; the profile does not name the game. And under Steam Family Sharing, a VAC ban earned on a shared library is applied to the library owner's account as well, so the owner of the games is banned along with the person who was playing them.`}</p>

      <h2>Game bans</h2>
      <p>{`A game ban reads almost identically on a profile ("1 game ban on record") but arrives by a different route: the game's developer issues it through Steam rather than VAC detecting it client-side. For Counter-Strike the developer is Valve, so in practice a game ban on a CS2 account is Valve's server-side detection or review reaching the same conclusion VAC would have. In CS:GO many game bans came from Overwatch, the community demo-review system, whose cheating verdicts were permanent and whose griefing verdicts were temporary. Either way, a cheating game ban does not expire, and it carries the same inventory consequences as a VAC ban.`}</p>

      <h2>What Steam exposes through its API</h2>
      <p>{`Everything a stat site knows about Steam-side bans comes from one Web API call, GetPlayerBans, which returns the following per account:`}</p>
      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>VACBanned</td>
            <td>Whether the account has at least one VAC ban</td>
          </tr>
          <tr>
            <td>NumberOfVACBans</td>
            <td>How many VAC bans, across every VAC-secured game</td>
          </tr>
          <tr>
            <td>NumberOfGameBans</td>
            <td>How many developer-issued game bans</td>
          </tr>
          <tr>
            <td>DaysSinceLastBan</td>
            <td>Days since the most recent VAC or game ban; 0 when there has never been one</td>
          </tr>
          <tr>
            <td>EconomyBan</td>
            <td>{`"none", "probation" or "banned" — the trade and market restriction status`}</td>
          </tr>
          <tr>
            <td>CommunityBanned</td>
            <td>Whether the account is banned from Steam Community features</td>
          </tr>
        </tbody>
      </table>
      <p>{`Notice what is absent: the game each ban came from, the date beyond the days-since counter, and the reason. Cooldowns and FACEIT bans are not in this data at all, and a game ban for griefing cannot be told from one for cheating.`}</p>
      <p>
        {`${SITE_NAME} reads GetPlayerBans for every profile it builds and shows the VAC and game ban counts with the days since the last ban on the profile card, next to account age, playtime, FACEIT level and Premier rating. The same fields feed the CheatMeter as one input among several: a VAC ban less than a year old pins the meter's floor in its highest band, an older VAC ban keeps it above the midpoint, and game bans do the same a notch lower. That weighting is deliberate; a fresh VAC ban on an account that is actively queuing CS2 is a different situation from a decade-old one, and the meter is meant to say so rather than to treat every red banner alike. Treat the score the way this whole guide treats bans: a signal worth a closer look, never proof.`}
      </p>

      <h2>How bans and ban waves look on a profile over time</h2>
      <p>{`A Steam profile with a ban shows a line such as "1 VAC ban on record | 42 day(s) since last ban". The counter is the only clock, and it moves in one direction: up by one every day until another ban lands, at which point it resets and the count of bans increases. Reading it over time tells you a few things that a single glance does not.`}</p>
      <ul>
        <li>{`A wave is a cluster. Because VAC bans are issued in batches, accounts caught in the same wave carry identical days-since values. If three players from a suspicious lobby all show "17 days since last ban", they were almost certainly caught together.`}</li>
        <li>{`Multiple bans mean multiple games or multiple waves. NumberOfVACBans above 1 on a single account means it was caught more than once, typically in different VAC-secured titles, since one game cannot ban an account twice.`}</li>
        <li>{`The counter keeps climbing after the player stops. A CS2 account with a two-year-old VAC ban and a few hours played since is a dead account, not a current threat; the counter outlives the activity.`}</li>
        <li>{`A clean profile is a snapshot. Bans attach to accounts, not people, and an active cheater's current account is clean right up until the wave that catches it. Zero bans is weak evidence either way.`}</li>
      </ul>

      <h2>FACEIT bans: categories and published durations</h2>
      <p>{`FACEIT runs its own ladder with its own anti-cheat client and its own rulebook, and its bans lock the FACEIT account rather than the Steam account underneath it. Nothing about them appears on Steam. FACEIT revised its banning policy with the launch of its 2026 Season 9, and the durations it announced are, as of writing:`}</p>
      <table>
        <thead>
          <tr>
            <th>Offense</th>
            <th>First ban</th>
            <th>Escalation</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Cheating</td>
            <td>5 years</td>
            <td>+2 years per ban-evasion attempt, up to permanent</td>
          </tr>
          <tr>
            <td>Smurfing</td>
            <td>3 months</td>
            <td>1 year, then permanent</td>
          </tr>
          <tr>
            <td>Stream sniping</td>
            <td>6 months</td>
            <td>Up to permanent</td>
          </tr>
          <tr>
            <td>Abuse and harassment</td>
            <td>At least 3 days</td>
            <td>Ban levels of 1 week, 1 month and 1 year</td>
          </tr>
          <tr>
            <td>Toxicity and griefing</td>
            <td>At least 7 days</td>
            <td>Faster escalation for repeat offenses, up to permanent</td>
          </tr>
        </tbody>
      </table>
      <p>
        <em>{`FACEIT's announced Season 9 banning policy (August 2026), as reported at the time; check FACEIT's own policy page for the current version.`}</em>
      </p>
      <p>
        {`Two details round that out. Leaving or failing to join a FACEIT match draws a queue cooldown measured in hours, which is separate from the ban levels above and works like Valve's cooldowns. And FACEIT states that trash talk is permitted so long as it does not become abuse; the three-day floor is for the latter. A Steam VAC ban does not automatically ban a FACEIT account, but FACEIT reads Steam's ban status and applies its own rules to accounts that carry one. If you are evaluating a FACEIT profile, the level and ELO history usually say more than ban-hunting does; `}
        <Link href="/guides/faceit-levels-and-elo">the FACEIT ELO guide</Link>
        {` covers how to read them.`}
      </p>

      <h2>Trade, market and community bans</h2>
      <p>{`Steam's EconomyBan field is a restriction on trading and the Community Market that Steam applies for scamming, fraud, chargebacks and similar market abuse. "probation" is a temporary restriction, "banned" is a permanent one, and neither has anything to do with cheating in a game. A community ban (CommunityBanned) is a separate restriction on Steam Community features, usually for abusive behavior on the platform.`}</p>
      <p>{`The confusion comes from the fact that VAC and game bans also have an economic effect: items in the banned game's inventory are locked from trading and the market. So a CS2 account with a VAC ban will show EconomyBan "none" and still be unable to move its skins. The two systems are independent; only the consequence overlaps.`}</p>

      <h2>What can and cannot be appealed</h2>
      <ul>
        <li>{`VAC bans: not appealable. Valve describes them as permanent and non-negotiable, and Steam Support does not review or remove them. The only reversals on record were rare detection errors that Valve lifted for everyone affected.`}</li>
        <li>{`Game bans: issued by the developer, and only the developer can lift one. For CS2 that developer is Valve, which treats cheating game bans like VAC bans.`}</li>
        <li>{`Competitive cooldowns: not negotiable; they expire on their own according to the ladder above.`}</li>
        <li>{`Economy and community bans: handled by Steam Support rather than any anti-cheat system; permanent trade bans are rarely lifted, but they are the one Steam-side category where a support ticket is the right channel.`}</li>
        <li>{`FACEIT bans: appealable through a FACEIT support ticket, and the platform does review them against its evidence; cheating bans are the hardest to overturn.`}</li>
      </ul>

      <h2>Reading a profile with a ban honestly</h2>
      <p>{`Steam gives you three facts: how many VAC bans, how many game bans, and how many days since the latest one. Everything else is inference, so be precise about what you can conclude.`}</p>
      <ul>
        <li>{`The ban does not name its game. A VAC ban on a profile proves the account was caught cheating in some VAC-secured title, once. If the account has thousands of CS2 hours and nothing else, CS2 is the likely source; if it has a library of twenty VAC-secured games, it is not.`}</li>
        <li>{`Age changes everything. A ban from 40 days ago on an account grinding Premier today is a live red flag. A ban from eight years ago on an otherwise normal account is a scar.`}</li>
        <li>{`A banned account cannot play the ranked queues it was banned from, so the account you are looking at in your lobby is, by definition, not the banned one. The accounts that deserve scrutiny are the fresh, low-hour ones performing far above their apparent level.`}</li>
        <li>{`Cooldowns and FACEIT bans are invisible on Steam, and a clean Steam profile says nothing about either.`}</li>
      </ul>
      <p>
        {`Because VAC and game bans are permanent and tied to the account, the standard response is to abandon the account and start another; CS2's base game is free, so the real cost of evasion is a new Prime purchase and a re-climb. That is why the live question is never the profile wearing the banner, it is the one that is clean and should not be. `}
        <Link href="/guides/spotting-smurfs-and-cheaters">
          The smurfs and cheaters guide
        </Link>
        {` walks through those signals, and how a large gap between an account's ladders is one of them, with `}
        <Link href="/guides/cs2-rating-systems-compared">
          the rating systems comparison
        </Link>
        {` explaining why the ladders disagree in the first place.`}
      </p>

      <h2>Check ban status on any profile</h2>
      <p>
        {`Look up any account on `}
        <Link href="/">{SITE_NAME}</Link>
        {` and the profile card shows VAC and game ban counts with the days since the last ban, next to account age, playtime, FACEIT level and Premier rating. Put a suspicious account beside a normal one in the `}
        <Link href="/compare">comparison tool</Link>
        {` to see how it stacks up, and if you genuinely believe someone is cheating, report them through the game or through FACEIT and let the anti-cheat systems make the call.`}
      </p>
    </GuideArticle>
  );
}
