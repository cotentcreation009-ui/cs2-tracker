"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { PlayerHit } from "@/lib/types";
import { getRecentPlayers } from "@/lib/recent";

/**
 * SearchBar accepts a SteamID64, vanity name, or pasted steamcommunity URL and
 * routes to the matching profile. While typing (>=2 chars) it shows an
 * autocomplete dropdown of known players (debounced, same-origin /api/search);
 * when empty it shows recently-viewed players from localStorage.
 */
export function SearchBar({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [results, setResults] = useState<PlayerHit[]>([]);
  const [recent, setRecent] = useState<PlayerHit[]>([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRecent(getRecentPlayers());
  }, []);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let active = true;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { players?: PlayerHit[] };
        if (active) setResults(data.players ?? []);
      } catch {
        /* ignore */
      }
    }, 200);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [value]);

  const showRecent = value.trim().length < 2;
  const list = showRecent ? recent : results;

  function navTo(steamId64: string) {
    setOpen(false);
    router.push(`/profiles/${steamId64}`);
  }

  function go(e: React.FormEvent) {
    e.preventDefault();
    if (hi >= 0 && list[hi]) {
      navTo(list[hi].steamId64);
      return;
    }
    const v = value.trim();
    if (!v) return;
    const url = v.match(/steamcommunity\.com\/(id|profiles)\/([^/?#]+)/i);
    if (url) router.push(`/${url[1].toLowerCase()}/${url[2]}`);
    else if (/^\d{17}$/.test(v)) router.push(`/profiles/${v}`);
    else router.push(`/id/${encodeURIComponent(v)}`);
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent) {
    if (!open || list.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, list.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, -1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div
      ref={boxRef}
      className="relative w-full"
      onBlur={(e) => {
        if (!boxRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
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
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
            setHi(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          aria-label="Search for a player"
          placeholder="SteamID64, vanity name, or profile URL"
          className="w-full rounded-lg border border-line bg-panel2 py-2 pl-9 pr-3 text-sm text-ink placeholder:text-faint outline-none transition focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
          spellCheck={false}
        />
      </form>

      {open && list.length > 0 && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-line bg-panel2 shadow-xl">
          {showRecent && <div className="stat-label px-3 pt-2">Recent</div>}
          <ul>
            {list.map((p, i) => (
              <li key={p.steamId64}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => navTo(p.steamId64)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-panel ${
                    i === hi ? "bg-panel" : ""
                  }`}
                >
                  {p.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.avatarUrl}
                      alt=""
                      className="h-6 w-6 rounded object-cover"
                    />
                  ) : (
                    <span className="h-6 w-6 rounded bg-panel" />
                  )}
                  <span className="truncate">
                    {p.personaName || p.steamId64}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
