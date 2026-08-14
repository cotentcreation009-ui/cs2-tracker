import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { API_BASE, internalHeaders } from "@/lib/api";

// Bridge from a pro player's card to their stats page here.
//
// The rails show ~100 rostered players; resolving every one of them to a Steam
// account up front would be 100 Liquipedia lookups per refresh for links nobody
// clicks. So resolution happens on the click instead: this route does one
// lookup, then redirects to /profiles/<steamID64>. The card is cached 14 days
// at the backend and a day at the edge, so a popular player costs one lookup
// ever.
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  // A redirect hop with no content of its own — keep it out of the index.
  return { title: "Player — CSRun", robots: { index: false, follow: true } };
}

type Card = { found?: boolean; name?: string; steamId?: string; team?: string };

async function playerCard(nick: string): Promise<Card | null> {
  try {
    const res = await fetch(
      `${API_BASE}/api/pro-matches/player-card/${encodeURIComponent(nick)}`,
      { headers: internalHeaders(), next: { revalidate: 3600 } },
    );
    if (!res.ok) return null;
    return (await res.json()) as Card;
  } catch {
    return null;
  }
}

export default async function ProPlayerBridge({
  params,
}: {
  params: Promise<{ nick: string }>;
}) {
  const { nick: raw } = await params;
  const nick = decodeURIComponent(raw);
  const card = await playerCard(nick);

  // Redirect outside the try/catch above: next/navigation's redirect() works by
  // throwing, and a catch would swallow it.
  const steamId = card?.steamId ?? "";
  if (/^7656119\d{10}$/.test(steamId)) redirect(`/profiles/${steamId}`);

  // No Steam account on the wiki — a real and fairly common case. Say so
  // plainly rather than guessing at an account and showing a stranger's stats.
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <div className="card p-6 text-center">
        <h1 className="text-xl font-extrabold tracking-tight text-ink">
          {nick}
        </h1>
        {card?.name && <p className="mt-1 text-sm text-muted">{card.name}</p>}
        <p className="mt-4 text-sm text-muted">
          We don&apos;t have a Steam account on file for this player, so there
          are no stats to show here. Pro accounts are often private or
          unlisted.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/pro-matches"
            className="rounded-lg border border-line bg-panel2/60 px-4 py-2 text-sm font-semibold text-ink hover:border-brand/50"
          >
            Back to pro matches
          </Link>
          <a
            href={`https://www.hltv.org/search?query=${encodeURIComponent(nick)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-muted hover:text-ink"
          >
            Look them up on HLTV
          </a>
        </div>
      </div>
    </div>
  );
}
