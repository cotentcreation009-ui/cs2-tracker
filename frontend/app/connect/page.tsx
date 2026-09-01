import type { Metadata } from "next";
import { ConnectForm } from "@/components/ConnectForm";

export const metadata: Metadata = {
  title: "Connect your matches — live CS2 stats | CSRun",
  description:
    "Connect your CS2 match history once and your CSRun profile updates itself within minutes of every game — the same official Valve mechanism the big stats sites use.",
};

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  const initialId = id && /^7656119\d{10}$/.test(id) ? id : "";
  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-10">
      <header>
        <h1 className="text-2xl font-extrabold text-ink">
          Connect your matches
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Two codes, one time, and your profile keeps itself current — new
          matches appear within minutes of the final round, forever. This is
          the same official Valve mechanism every major stats site runs on:
          you grant read-only access to your <em>match list</em>, nothing else.
        </p>
      </header>

      <section className="rounded-xl border border-line bg-panel/30 p-4 text-sm leading-relaxed text-muted">
        <p className="stat-label mb-2">Why bother</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <span className="text-ink">Your page goes live.</span> No more
            waiting on other sites&apos; crawls — your stats, ratings and
            CheatMeter track every game you finish.
          </li>
          <li>
            <span className="text-ink">Everyone you play gets covered too.</span>{" "}
            Each of your matches carries stats for all ten players in the
            lobby, so the teammates and opponents you look up stay fresh as a
            side effect.
          </li>
          <li>
            <span className="text-ink">Revocable any time.</span> The code
            can&apos;t log in, can&apos;t trade, can&apos;t see anything but
            your match list — and Steam lets you revoke it whenever you like.
          </li>
        </ul>
      </section>

      <ConnectForm initialId={initialId} />

      <p className="text-[11px] leading-snug text-faint">
        Your auth code is stored server-side only and never shown anywhere,
        including to you. We use it for exactly one thing: asking Valve
        &quot;did this account finish a new match?&quot;.
      </p>
    </div>
  );
}
