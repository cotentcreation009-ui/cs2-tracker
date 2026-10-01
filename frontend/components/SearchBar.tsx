"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { PlayerHit } from "@/lib/types";
import {
  clearRecentPlayers,
  getRecentPlayers,
  subscribeRecent,
} from "@/lib/recent";
import { routeForQuery } from "@/lib/searchRoute";

/**
 * SearchBar accepts a SteamID64, vanity name, or pasted steamcommunity URL and
 * routes to the matching profile. While typing (>=2 chars) it shows an
 * autocomplete dropdown of known players (debounced, same-origin /api/search);
 * when empty it shows recently-viewed players from localStorage.
 *
 * It is rendered twice on the homepage — the site header carries one on every
 * page, the hero another — so the behaviour here is the behaviour everywhere
 * and every element id comes from useId.
 */
type SearchStatus = "idle" | "loading" | "done";

export function SearchBar({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [results, setResults] = useState<PlayerHit[]>([]);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [recent, setRecent] = useState<PlayerHit[]>([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  // Set by a pointer or key on the input. A focus that follows one is intent
  // and opens the list; the focus autoFocus gives on page load is not, and
  // used to paint a returning visitor's Recent list over the hero before
  // they had touched anything.
  const interacted = useRef(false);
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;

  useEffect(() => {
    const read = () => setRecent(getRecentPlayers());
    read();
    return subscribeRecent(read);
  }, []);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) {
      setResults([]);
      setStatus("idle");
      return;
    }
    let active = true;
    setStatus("loading");
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { players?: PlayerHit[] };
        if (active) setResults(data.players ?? []);
      } catch {
        if (active) setResults([]);
      } finally {
        if (active) setStatus("done");
      }
    }, 200);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [value]);

  const q = value.trim();
  const showRecent = q.length < 2;
  const list = showRecent ? recent : results;
  // The dropdown has something to say when there are rows, or when a real
  // query is being looked up / came back empty — never a bare empty box.
  const expanded = open && (list.length > 0 || (!showRecent && status !== "idle"));

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
    const href = routeForQuery(value);
    if (!href) return;
    router.push(href);
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      setHi(-1);
      return;
    }
    if (e.key === "ArrowDown" && !open) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open || list.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, list.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, -1));
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
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => {
            interacted.current = true;
            setValue(e.target.value);
            setOpen(true);
            setHi(-1);
          }}
          onPointerDown={() => {
            interacted.current = true;
          }}
          onClick={() => setOpen(true)}
          onKeyDown={(e) => {
            interacted.current = true;
            onKey(e);
          }}
          onFocus={() => {
            if (interacted.current || value.trim()) setOpen(true);
          }}
          role="combobox"
          aria-label="Search for a player"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-activedescendant={
            expanded && hi >= 0 && list[hi] ? optionId(hi) : undefined
          }
          placeholder="SteamID64, vanity name, or profile URL"
          className="w-full rounded-lg border border-line bg-panel2 py-2 pl-9 pr-3 text-sm text-ink placeholder:text-faint outline-none transition focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
          spellCheck={false}
          autoComplete="off"
        />
      </form>

      {expanded && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-line bg-panel2 shadow-xl">
          {showRecent && (
            <div className="flex items-center justify-between px-3 pt-2">
              <span className="stat-label">Recent</span>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => clearRecentPlayers()}
                aria-label="Clear recently viewed players"
                className="text-[11px] font-semibold text-faint transition hover:text-ink"
              >
                Clear
              </button>
            </div>
          )}
          {!showRecent && list.length === 0 && status === "loading" && (
            <div role="status" className="px-3 py-2.5 text-sm text-faint">
              Searching…
            </div>
          )}
          {!showRecent && list.length === 0 && status === "done" && (
            <div role="status" className="px-3 py-2.5 text-sm text-muted">
              No tracked player matches “{q}” — press Enter to look it up.
            </div>
          )}
          {list.length > 0 && (
            <ul
              id={listId}
              role="listbox"
              aria-label={showRecent ? "Recently viewed players" : "Matching players"}
              className="scroll-slim max-h-72 overflow-y-auto"
            >
              {list.map((p, i) => (
                <li
                  key={p.steamId64}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === hi}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => navTo(p.steamId64)}
                  className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-panel ${
                    i === hi ? "bg-panel" : ""
                  }`}
                >
                  {p.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.avatarUrl}
                      alt=""
                      className="h-6 w-6 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="grid h-6 w-6 shrink-0 place-items-center rounded bg-panel text-[11px] font-bold text-faint"
                    >
                      {(p.personaName || "?").slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="truncate">
                    {p.personaName || p.steamId64}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
