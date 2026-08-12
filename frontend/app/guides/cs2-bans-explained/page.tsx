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
    q: "Do VAC bans ever expire or get removed?",
    a: "No. A VAC ban is permanent and Valve does not lift them on appeal. The profile counter keeps ticking — '2,000 days since last ban' — but the ban itself never goes away. The only exceptions have been rare cases where a wave of bans was issued in error and reversed for everyone affected.",
  },
  {
    q: "Can you see FACEIT bans on a Steam profile?",
    a: "No. FACEIT bans exist only on FACEIT — they lock the FACEIT account, not the Steam account, and Steam shows no trace of them. To check, you have to look at the player's FACEIT profile itself.",
  },
  {
    q: "Is a matchmaking cooldown the same as a ban?",
    a: "No. Cooldowns are short, automatic timeouts for things like abandoning a match or excessive team damage. They expire on their own — roughly 30 minutes up to a week for repeat offenses — and never appear on a Steam profile.",
  },
  {
    q: "Does a VAC ban on someone's profile mean they cheated in CS2?",
    a: "Not necessarily. The profile says a VAC ban exists and how many days ago it landed, but not which game it came from — hundreds of Steam games are VAC-secured. It proves the account was caught cheating somewhere, at some point; the age of the ban and the rest of the account's history tell you how much that matters now.",
  },
];

export default function Page() {
  return (
    <GuideArticle guide={g} faq={FAQ}>
      <p>{`When someone in a CS2 lobby says a player is "banned", they can mean four different things: a VAC ban, a game ban, a matchmaking cooldown, or a FACEIT ban. They come from different systems, last different lengths of time, and show up in different places — and mixing them up leads to bad conclusions in both directions. Here is what each one actually means, and how to read a ban when you see it on a real profile.`}</p>

      <h2>The four at a glance</h2>
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Issued by</th>
            <th>Duration</th>
            <th>On the Steam profile?</th>
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
            <td>{`The game's developer (Valve, for CS2)`}</td>
            <td>Permanent for cheating; some griefing verdicts historically temporary</td>
            <td>{`Yes — "game ban on record"`}</td>
          </tr>
          <tr>
            <td>Matchmaking cooldown</td>
            <td>CS2 itself, automatically</td>
            <td>Minutes to days</td>
            <td>No</td>
          </tr>
          <tr>
            <td>FACEIT ban</td>
            <td>The FACEIT platform</td>
            <td>Temporary or permanent</td>
            <td>No</td>
          </tr>
        </tbody>
      </table>

      <h2>VAC bans: automatic and permanent</h2>
      <p>{`VAC — Valve Anti-Cheat — runs whenever you play on a VAC-secured server, which includes all of Valve's official CS2 matchmaking. It scans for known cheat software, and a positive match means a ban. Detection and punishment are often separated on purpose: VAC bans frequently land in delayed waves, days or weeks after the session where the cheat was spotted, so cheat developers cannot easily tell which version got flagged.`}</p>
      <p>{`Three properties define a VAC ban. It is permanent — there is no expiry and no appeal process that reverses a legitimate ban; the only removals on record have been rare mass reversals after a detection error. It is account-wide for the affected game — the account is locked out of that game's VAC-secured servers for good, and items in the banned game's inventory can no longer be traded or sold on the Community Market. And it is public: the profile displays a red notice such as "1 VAC ban on record | 365 day(s) since last ban" that other players can see.`}</p>
      <p>{`One detail people miss: the profile never says which game the ban came from. A VAC ban issued in another VAC-secured title shows up exactly the same way, and for some older titles that share an engine a single detection historically covered a family of games at once. That matters when you are judging a lobby-mate — more on that below.`}</p>

      <h2>Game bans: issued by the game, not the client</h2>
      <p>{`A game ban looks almost identical on a profile — "1 game ban on record" — but it arrives by a different route. Instead of VAC's automated client-side detection, the game's developer issues it through Steam. For Counter-Strike that developer is Valve itself, so the practical difference is which system caught the player, not who is in charge.`}</p>
      <p>{`In CS:GO, many game bans came from Overwatch, the system where experienced community members reviewed demos of reported players and issued verdicts — permanent bans for cheating, temporary ones for griefing. In CS2 Valve leans on its own server-side detection instead. Either way, a game ban on a Counter-Strike account carries essentially the same weight as a VAC ban: the account was judged to be cheating or seriously disruptive, and cheating verdicts do not expire.`}</p>

      <h2>Matchmaking cooldowns: penalties, not bans</h2>
      <p>{`Cooldowns are the thing most often miscalled a ban. Abandon a match, sit AFK, do too much team damage, kick teammates too often — or get kicked too often yourself — and CS2 temporarily blocks you from matchmaking. The timeouts escalate with repeat offenses, roughly from 30 minutes to 2 hours to 24 hours to a full week, and de-escalate again after a clean stretch of play.`}</p>
      <p>{`Two things separate a cooldown from a real ban: it expires on its own, and it leaves no mark on the Steam profile. A player on a cooldown has been penalized for behavior, not convicted of anything. If a teammate claims they were "banned for a week", this is almost always what happened.`}</p>

      <h2>FACEIT bans: a separate ladder, a separate rulebook</h2>
      <p>{`FACEIT runs its own competitive ladder with its own anti-cheat client, which every player must run during matches and which is generally regarded as stricter than VAC. Its bans are platform-level: they lock the FACEIT account, not the Steam account underneath it.`}</p>
      <p>{`FACEIT also bans for more than cheating. Smurfing, running multiple accounts, and serious toxicity can all draw platform bans, some temporary and some permanent. None of it appears on Steam — a Steam profile can look spotless while the linked FACEIT account is permanently banned, and Steam's own bans are a separate record that FACEIT displays and enforces by its own rules. If you are evaluating a FACEIT profile, the level and ELO history usually tell you more than ban-hunting; our guide to `}<Link href="/guides/faceit-levels-and-elo">FACEIT levels &amp; ELO</Link>{` covers how to read them.`}</p>

      <h2>{`What a ban on a profile does — and doesn't — tell you`}</h2>
      <p>{`Steam gives you exactly two facts: how many VAC and game bans the account has, and how many days have passed since the most recent one. Everything else is inference, so it pays to be precise about what you can and cannot conclude:`}</p>
      <ul>
        <li>{`A ban does not name its game. A "VAC ban on record" may be from CS2 — or from any other VAC-secured title the account has played. On its own it proves the account cheated somewhere, once.`}</li>
        <li>{`Age changes everything. A ban from 40 days ago on an account grinding CS2 today is a live red flag; a ban from eight years ago on an otherwise normal account is closer to an old scar.`}</li>
        <li>{`A clean profile is weak evidence too. Bans land on accounts, not people — an active cheater's current account is clean right up until the wave that catches it.`}</li>
        <li>{`Cooldowns and FACEIT bans are invisible here. Steam's ban box tells you nothing about either.`}</li>
      </ul>

      <h2>Ban evasion and fresh accounts</h2>
      <p>{`Because VAC and game bans are permanent and stuck to the account, the standard response is simply to abandon the account and start a new one. CS2's base game is free to download, so the real cost of evasion is buying Prime status again and re-climbing the ranks — one reason Valve gates competitive features behind Prime in the first place.`}</p>
      <p>{`The practical consequence: the accounts most worth scrutinizing are rarely the ones wearing a visible ban. A banned account is a closed case. The live question is the fresh, low-hour account performing far above its apparent level — the classic evasion-or-smurf pattern. Our guide to `}<Link href="/guides/spotting-smurfs-and-cheaters">spotting smurfs and cheaters</Link>{` walks through those signals and, just as importantly, how to weigh them without jumping to conclusions.`}</p>

      <h2>Check ban status on any profile</h2>
      <p>
        Look up any account on{" "}
        <Link href="/">{SITE_NAME}</Link> and the profile card shows VAC and
        game ban status with days since the last ban, right next to account
        age, playtime, FACEIT level and Premier rating — the context that turns
        a red banner into an informed read. You can also put two accounts side
        by side in the <Link href="/compare">comparison tool</Link> to see how
        a suspicious profile stacks up against a normal one.
      </p>
      <p>{`Ban history also feeds ${SITE_NAME}'s CheatMeter as one input among several. Treat that score the way this whole guide suggests treating bans: as a signal worth a closer look, never as proof. If you genuinely believe someone is cheating, report them through Valve or FACEIT and let the anti-cheat systems make the call.`}</p>
    </GuideArticle>
  );
}
