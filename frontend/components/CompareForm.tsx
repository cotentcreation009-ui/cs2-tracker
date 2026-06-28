"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { PlayerHit } from "@/lib/types";
import { getRecentPlayers } from "@/lib/recent";

// 24px avatar (literal classes so Tailwind keeps them).
function Avatar({ url, name }: { url?: string; name: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="h-6 w-6 shrink-0 rounded-md border border-line object-cover" />
  ) : (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-line bg-panel2 text-[10px] font-bold text-faint">
      {(name || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

// Compare builder: shows the currently-selected players as removable chips, an
// add-by-search field, and a quick-pick list of recently-viewed players. Each
// change navigates to /compare?ids=<…> so the server fetches the new set.
export function CompareForm({
  selected = [],
  max = 6,
}: {
  selected?: PlayerHit[];
  max?: number;
}) {
  const router = useRouter();
  const [recent, setRecent] = useState<PlayerHit[]>([]);
  const [input, setInput] = useState("");

  useEffect(() => {
    setRecent(getRecentPlayers());
  }, []);

  const ids = selected.map((s) => s.steamId64);
  const full = ids.length >= max;

  const nav = (list: string[]) =>
    router.push(list.length ? `/compare?ids=${list.map(encodeURIComponent).join(",")}` : "/compare");

  const add = (raw: string) => {
    const t = raw.trim();
    if (!t || full || ids.includes(t)) return;
    nav([...ids, t]);
  };
  const remove = (id: string) => nav(ids.filter((x) => x !== id));

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    add(input);
    setInput("");
  };

  const recentAvail = recent.filter((r) => !ids.includes(r.steamId64));

  return (
    <div className="card-2 space-y-4 px-5 py-5">
      {/* selected players */}
      {selected.length > 0 && (
        <div>
          <div className="stat-label mb-1.5">
            Comparing {selected.length} {selected.length === 1 ? "player" : "players"}
            {selected.length === 1 && <span className="text-faint"> · add at least one more</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            {selected.map((p) => (
              <span
                key={p.steamId64}
                className="flex items-center gap-2 rounded-lg border border-line bg-panel py-1 pl-1.5 pr-1 text-sm"
              >
                <Avatar url={p.avatarUrl} name={p.personaName} />
                <span className="max-w-[160px] truncate">{p.personaName || p.steamId64}</span>
                <button
                  type="button"
                  onClick={() => remove(p.steamId64)}
                  title="Remove"
                  className="grid h-5 w-5 place-items-center rounded text-faint transition hover:bg-panel2 hover:text-bad"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* add by search */}
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={full ? `Up to ${max} players` : "Add a player — SteamID64 or vanity"}
          spellCheck={false}
          disabled={full}
          className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-brand/60 focus:ring-2 focus:ring-brand/20 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={full || !input.trim()}
          className="shrink-0 rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-bg transition hover:opacity-90 disabled:opacity-40"
        >
          Add
        </button>
      </form>

      {/* recent players quick-pick */}
      {recentAvail.length > 0 && !full && (
        <div>
          <div className="stat-label mb-1.5">Recent players</div>
          <div className="flex flex-wrap gap-2">
            {recentAvail.map((r) => (
              <button
                key={r.steamId64}
                type="button"
                onClick={() => add(r.steamId64)}
                className="flex items-center gap-2 rounded-lg border border-line bg-panel py-1 pl-1.5 pr-2.5 text-sm transition hover:border-brand/60 hover:bg-panel2"
              >
                <Avatar url={r.avatarUrl} name={r.personaName} />
                <span className="max-w-[140px] truncate">{r.personaName || r.steamId64}</span>
                <span className="text-brand">+</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
