"use client";

import { useState } from "react";

// The self-serve "connect your match history" form.
//
// Ownership needs no login: the backend verifies the pair against Valve, and
// a (steamid, auth code) pair only validates when the codes genuinely belong
// to that account. Errors from the backend name which of the two codes to fix,
// so they are shown verbatim.
export function ConnectForm({ initialId = "" }: { initialId?: string }) {
  const [profile, setProfile] = useState(initialId);
  const [authCode, setAuthCode] = useState("");
  const [shareCode, setShareCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      // Accept a bare SteamID64 or a full profile URL.
      let steamId = profile.trim();
      const m = steamId.match(/\/profiles\/(7656119\d{10})/);
      if (m) steamId = m[1];
      if (!/^7656119\d{10}$/.test(steamId)) {
        // Vanity URLs and names go through the resolver endpoint.
        const r = await fetch(`/api/resolve?q=${encodeURIComponent(profile.trim())}`);
        const j = (await r.json()) as { steamId64?: string };
        if (!j.steamId64) {
          setError("Couldn't work out the SteamID64 — paste your full Steam profile URL.");
          setBusy(false);
          return;
        }
        steamId = j.steamId64;
      }

      const res = await fetch("/api/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          steamId,
          authCode: authCode.trim().toUpperCase(),
          shareCode: shareCode.trim(),
        }),
      });
      const j = (await res.json()) as { connected?: boolean; error?: string };
      if (res.ok && j.connected) {
        setDone(true);
      } else {
        setError(j.error ?? `something went wrong (${res.status})`);
      }
    } catch {
      setError("Network hiccup — try again.");
    }
    setBusy(false);
  }

  if (done) {
    return (
      <div className="rounded-xl border border-good/40 bg-good/10 p-4 text-sm text-ink">
        <p className="font-semibold text-good">Connected ✓</p>
        <p className="mt-1 text-muted">
          Your codes checked out against Valve and the catch-up has started. Your
          profile picks up new matches within minutes of each game from now on —
          nothing else to do, ever.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="stat-label">Your Steam profile URL or SteamID64</span>
        <input
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
          placeholder="https://steamcommunity.com/profiles/7656119…"
          required
          className="mt-1 w-full rounded-lg border border-line bg-panel/60 px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none"
        />
      </label>
      <label className="block">
        <span className="stat-label">Match history auth code</span>
        <input
          value={authCode}
          onChange={(e) => setAuthCode(e.target.value)}
          placeholder="XXXX-XXXXX-XXXX"
          required
          pattern="[A-Za-z0-9]{4}-[A-Za-z0-9]{5}-[A-Za-z0-9]{4}"
          className="mt-1 w-full rounded-lg border border-line bg-panel/60 px-3 py-2 font-mono text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none"
        />
        <span className="mt-1 block text-[11px] leading-snug text-faint">
          From Steam&apos;s{" "}
          <a
            href="https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand underline decoration-dotted underline-offset-2"
          >
            match history access page
          </a>{" "}
          → &quot;Create Authentication Code&quot;. It only lets us <em>read your match
          list</em> — it can&apos;t touch your account, and you can revoke it there
          any time.
        </span>
      </label>
      <label className="block">
        <span className="stat-label">A recent match share code</span>
        <input
          value={shareCode}
          onChange={(e) => setShareCode(e.target.value)}
          placeholder="CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx"
          required
          className="mt-1 w-full rounded-lg border border-line bg-panel/60 px-3 py-2 font-mono text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none"
        />
        <span className="mt-1 block text-[11px] leading-snug text-faint">
          Shown on the same Steam page — or, better, open CS2 → Watch → Your
          Matches and copy the <em>oldest</em> one there, which backfills those
          games too. Codes older than a month are refused by Valve.
        </span>
      </label>
      {error && (
        <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
      >
        {busy ? "Checking with Valve…" : "Connect my matches"}
      </button>
    </form>
  );
}
