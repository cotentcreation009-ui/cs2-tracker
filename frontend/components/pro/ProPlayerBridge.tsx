"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { resolvePlayerSteamId } from "@/lib/liquipediaClient";
import { firstId } from "./firstId";

// SteamID64s for individual accounts: 17 digits opening 7656.
const ID64 = /^7656\d{13}$/;

async function serverId(nick: string): Promise<string | null> {
  try {
    const res = await fetch(
      `/api/pro-matches/player-card/${encodeURIComponent(nick)}`,
    );
    if (!res.ok) return null;
    const d = (await res.json()) as { steamId?: string };
    return ID64.test(d.steamId ?? "") ? (d.steamId as string) : null;
  } catch {
    return null;
  }
}

async function browserId(nick: string): Promise<string | null> {
  try {
    const id = await resolvePlayerSteamId(nick);
    return id && ID64.test(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * Bridge from a pro player's card to their stats page here.
 *
 * The lookup that works runs in the VISITOR's browser, not on the server —
 * the same reason player photos, team crests and identity cards already
 * resolve client-side. A server-rendered version of this page told every
 * visitor we had no Steam account for anyone.
 *
 * Both sources are asked AT ONCE. Measured against production, a server-side
 * card lookup hangs until the backend's own 5s deadline before answering
 * "not found", so awaiting it first would sit on a spinner for five seconds
 * before the browser lookup — the one that actually resolves — even started.
 * The server stays in the race because it is same-origin and instant on the
 * day it starts working again.
 *
 * Resolution is per-click by design. The rails carry ~100 rostered players and
 * Liquipedia is paced at one request every 2.1s, so resolving them all up
 * front would take minutes for links nobody clicks.
 */
export function ProPlayerBridge({ nick }: { nick: string }) {
  const router = useRouter();
  const [state, setState] = useState<"resolving" | "missing">("resolving");

  useEffect(() => {
    let alive = true;
    (async () => {
      const id = await firstId([serverId(nick), browserId(nick)]);
      if (!alive) return;
      // replace, not push: Back should return to the rail, not bounce through
      // this page and resolve all over again.
      if (id) router.replace(`/profiles/${id}`);
      else setState("missing");
    })();
    return () => {
      alive = false;
    };
  }, [nick, router]);

  if (state === "resolving") {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="card p-6 text-center" aria-busy="true">
          <h1 className="text-xl font-extrabold tracking-tight text-ink">
            {nick}
          </h1>
          <p className="mt-2 text-sm text-muted">Finding their stats…</p>
          <div className="mx-auto mt-5 h-1.5 w-40 overflow-hidden rounded-full bg-line/40">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-brand/70" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <div className="card p-6 text-center">
        <h1 className="text-xl font-extrabold tracking-tight text-ink">
          {nick}
        </h1>
        <p className="mt-4 text-sm text-muted">
          We couldn&apos;t match this nickname to a Steam account, so there are
          no stats to show. Not every pro has one listed publicly.
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
