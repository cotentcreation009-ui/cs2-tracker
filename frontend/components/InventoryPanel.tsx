"use client";

import { useEffect, useState } from "react";

// The CS2 skin-inventory showcase: total value up top, the most valuable
// items as rarity-lit cards, then the rarity spread and category breakdown.
// Fetched when the panel first opens; Steam-side results are cached hard so
// repeat opens cost nothing.

interface InvItem {
  name: string;
  market_hash_name: string;
  icon: string;
  type?: string;
  rarity?: string;
  rarity_color?: string;
  exterior?: string;
  stattrak?: boolean;
  souvenir?: boolean;
  count: number;
  price?: number;
}

interface InvView {
  private?: boolean;
  total_value: number;
  priced_items: number;
  item_count: number;
  distinct_count: number;
  marketable_count: number;
  top_items?: InvItem[];
  categories?: { name: string; count: number; value: number }[];
  rarities?: { name: string; color: string; count: number }[];
  fetched_at?: string;
}

const WEAR_SHORT: Record<string, string> = {
  "Factory New": "FN",
  "Minimal Wear": "MW",
  "Field-Tested": "FT",
  "Well-Worn": "WW",
  "Battle-Scarred": "BS",
};

const usd = (v: number) =>
  v >= 1000
    ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : `$${v.toFixed(2)}`;

export function InventoryPanel({ steamId }: { steamId: string }) {
  const [view, setView] = useState<InvView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let alive = true;
    fetch(`/api/profiles/${encodeURIComponent(steamId)}/inventory`)
      .then((r) => {
        if (!r.ok) throw new Error(`status ${r.status}`);
        return r.json() as Promise<InvView>;
      })
      .then((d) => {
        if (alive) {
          setView(d);
          setState("ready");
        }
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
    };
  }, [steamId]);

  if (state === "loading") {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="h-24 animate-pulse rounded-xl bg-line/20" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-xl bg-line/20" />
          ))}
        </div>
      </div>
    );
  }
  if (state === "error" || !view) {
    return (
      <p className="px-4 py-10 text-center text-sm text-muted">
        Couldn&apos;t load the inventory right now — Steam rate-limits inventory reads, so give it
        a minute and try again.
      </p>
    );
  }
  if (view.private) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
        <p className="text-base font-semibold text-ink">This inventory is private</p>
        <p className="max-w-md text-sm text-muted">
          Steam only shares inventories the owner has set to public, so there&apos;s nothing we can
          show here.
        </p>
      </div>
    );
  }

  const items = view.top_items ?? [];
  const rarities = view.rarities ?? [];
  const rarityTotal = rarities.reduce((a, r) => a + r.count, 0);
  const cats = (view.categories ?? []).slice(0, 8);

  return (
    <div className="space-y-4">
      {/* headline: what the collection is worth */}
      <div className="relative overflow-hidden rounded-xl border border-line bg-panel2/40 p-4 sm:p-5">
        <span aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-[#e8b04c] opacity-[0.10] blur-3xl" />
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <div className="stat-label">Estimated inventory value</div>
            <div className="mt-1 text-3xl font-extrabold tabular-nums text-ink sm:text-4xl">
              {usd(view.total_value)}
            </div>
            <div className="mt-1 text-[11px] text-faint">
              {view.priced_items} of {view.item_count} items priced · market prices via Skinport
            </div>
          </div>
          <div className="flex gap-5">
            <div>
              <div className="stat-label">Items</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{view.item_count}</div>
            </div>
            <div>
              <div className="stat-label">Distinct</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{view.distinct_count}</div>
            </div>
            <div>
              <div className="stat-label">Marketable</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{view.marketable_count}</div>
            </div>
          </div>
        </div>
        {/* rarity spread */}
        {rarityTotal > 0 ? (
          <div className="mt-4">
            <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-line/30" aria-hidden>
              {rarities.map((r) => (
                <span key={r.name} style={{ width: `${(r.count / rarityTotal) * 100}%`, background: r.color || "#8a93a5" }} />
              ))}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {rarities.map((r) => (
                <span key={r.name} className="flex items-center gap-1 text-[10px] text-faint">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: r.color || "#8a93a5" }} />
                  {r.name} <span className="tabular-nums">{r.count}</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* the showcase: most valuable items, lit by their rarity */}
      {items.length > 0 ? (
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-ink">Top items</h3>
            <span className="text-[10px] text-faint">by stack value</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {items.slice(0, 20).map((it) => {
              const hue = it.rarity_color || "#8a93a5";
              const wear = it.exterior ? (WEAR_SHORT[it.exterior] ?? it.exterior) : "";
              return (
                <div
                  key={it.market_hash_name}
                  className="group relative overflow-hidden rounded-xl border p-2.5 transition duration-150 hover:-translate-y-0.5"
                  style={{ borderColor: `${hue}40`, background: `linear-gradient(180deg, ${hue}14, transparent 70%)` }}
                  title={`${it.name}${it.price ? ` — ${usd(it.price)} each` : ""}`}
                >
                  <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, ${hue}, transparent)` }} />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.icon} alt="" loading="lazy" referrerPolicy="no-referrer" className="mx-auto h-20 w-auto object-contain drop-shadow-md" />
                  <div className="mt-1.5 min-h-8">
                    <p className="truncate text-[11px] font-semibold leading-tight text-ink">{it.name.replace(/^StatTrak™ /, "").replace(/^Souvenir /, "")}</p>
                    <p className="flex items-center gap-1 text-[9px] leading-tight text-faint">
                      {it.stattrak ? <span className="font-bold text-[#cf6a32]">ST™</span> : null}
                      {it.souvenir ? <span className="font-bold text-[#ffd700]">SOUV</span> : null}
                      {wear ? <span>{wear}</span> : null}
                      {it.count > 1 ? <span>×{it.count}</span> : null}
                    </p>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between">
                    <span className="text-xs font-bold tabular-nums text-ink">
                      {it.price ? usd(it.price * it.count) : "—"}
                    </span>
                    {it.count > 1 && it.price ? (
                      <span className="text-[9px] tabular-nums text-faint">{usd(it.price)} ea</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="px-4 py-8 text-center text-sm text-muted">No items to show.</p>
      )}

      {/* what the inventory is made of */}
      {cats.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {cats.map((c) => (
            <span key={c.name} className="rounded-full border border-line bg-panel px-2.5 py-1 text-[11px] text-muted">
              {c.name} <span className="font-semibold text-ink">{c.count}</span>
              {c.value > 0 ? <span className="ml-1 tabular-nums text-faint">{usd(c.value)}</span> : null}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-3">
        <p className="text-[10px] leading-snug text-faint">
          Values are market estimates (Skinport suggested prices, USD) — not Steam wallet prices,
          and unpriced items aren&apos;t counted. Inventory data from Steam; shown only for public
          inventories.
        </p>
        <a
          href={`https://steamcommunity.com/profiles/${steamId}/inventory/#730`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-ghost h-8 shrink-0 px-3 text-xs"
        >
          Full inventory on Steam ↗
        </a>
      </div>
    </div>
  );
}
