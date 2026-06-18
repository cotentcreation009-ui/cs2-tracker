"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * SearchBar accepts a SteamID64, a vanity name, or a pasted steamcommunity URL
 * and routes to the matching profile page. It mirrors Steam's own URL space:
 * numeric ids go to /profiles/<id>, everything else to /id/<vanity> (resolved
 * server-side).
 */
export function SearchBar({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState("");

  function go(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;

    const url = v.match(
      /steamcommunity\.com\/(id|profiles)\/([^/?#]+)/i,
    );
    if (url) {
      router.push(`/${url[1].toLowerCase()}/${url[2]}`);
      return;
    }
    if (/^\d{17}$/.test(v)) {
      router.push(`/profiles/${v}`);
    } else {
      router.push(`/id/${encodeURIComponent(v)}`);
    }
  }

  return (
    <form onSubmit={go} className="relative w-full">
      <svg
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="SteamID64, vanity name, or profile URL"
        className="w-full rounded-lg border border-line bg-panel2 py-2 pl-9 pr-3 text-sm text-ink placeholder:text-faint outline-none transition focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
        spellCheck={false}
      />
    </form>
  );
}
