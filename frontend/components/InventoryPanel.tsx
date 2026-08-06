"use client";

import { useEffect, useMemo, useState } from "react";

// The CS2 skin-inventory showcase: total value up top, then the collection
// itself — filterable by category and by whether an item carries a market
// price. Fetched when the panel first opens; Steam-side results are cached
// hard so repeat opens cost nothing.

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
  // Non-zero means price is the median of that many real sales in the last 30
  // days; absent means it's Skinport's suggested price, which nobody has
  // necessarily paid.
  sale_volume?: number;
  // >1 means several finishes share this market name (Doppler phases and their
  // rare variants) and price is the median across them — which one this is
  // can't be read from a public inventory.
  price_variants?: number;
  marketable?: boolean;
  tradable?: boolean;
}

interface InvView {
  private?: boolean;
  // Served from our stored snapshot because Steam wouldn't answer — the
  // numbers are real, just as of fetched_at.
  stale?: boolean;
  // We have never managed to read this one and Steam is refusing right now.
  unavailable?: boolean;
  retry_after_sec?: number;
  // Too large to read in full — the totals cover what we did read.
  truncated?: boolean;
  total_items?: number;
  total_value: number;
  priced_items: number;
  // How many of priced_items are valued on real sales rather than an estimate.
  realized_items?: number;
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

// Why an item carries no value. An unpriced item is usually not a gap in our
// data — it's an item no market will carry, and saying so is more useful than
// a dash. Steam tells us which kind of "no" it is.
function priceGap(it: InvItem): { short: string; long: string } | null {
  if (it.price) return null;
  if (!it.marketable) {
    return {
      short: "Not sellable",
      long: "Steam doesn't allow this item on the Community Market, so no market price exists for it.",
    };
  }
  return {
    short: "No price",
    long: "Sellable, but with nothing listed on Skinport and too few recent sales to take a median from, there's no figure worth quoting.",
  };
}

type PriceFilter = "all" | "priced" | "unpriced";
type SortKey = "value" | "rarity" | "name";

// Rarity runs low to high; sorting by it should put the Covert knife first, so
// anything unrecognised sinks rather than floats.
const RARITY_ORDER = [
  "Consumer Grade", "Base Grade", "Industrial Grade", "Mil-Spec Grade", "High Grade",
  "Restricted", "Distinguished", "Classified", "Exceptional", "Covert", "Superior",
  "Extraordinary", "Master", "Remarkable", "Exotic", "Contraband",
];
const rarityRank = (r?: string) => {
  const i = RARITY_ORDER.indexOf(r ?? "");
  return i < 0 ? -1 : i;
};

const stackValue = (it: InvItem) => (it.price ?? 0) * it.count;

// How many cards to reveal at a time. Inventories run to a thousand entries;
// painting them all on open makes the panel stutter for no benefit.
const PAGE = 30;

// "3 hours ago" — how old the snapshot we're showing is.
function ago(iso?: string): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function InventoryPanel({ steamId }: { steamId: string }) {
  const [view, setView] = useState<InvView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState("loading");
    fetch(`/api/profiles/${encodeURIComponent(steamId)}/inventory`, {
      cache: attempt > 0 ? "reload" : "default",
    })
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
  }, [steamId, attempt]);

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
  if (state === "error" || !view || view.unavailable) {
    const wait = view?.retry_after_sec ?? 0;
    const when =
      wait >= 90 ? `about ${Math.round(wait / 60)} minutes` : wait > 0 ? `about a minute` : "a moment";
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
        <p className="text-base font-semibold text-ink">Steam isn&apos;t handing out this one yet</p>
        <p className="max-w-md text-sm text-muted">
          Steam limits how often anyone can read inventories, and it&apos;s turned us away for now.
          Once we get one clean read we keep it, so this only bites the first time. Try again in{" "}
          {when}.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="btn btn-ghost h-8 px-3 text-xs">
            Try again
          </button>
          <a
            href={`https://steamcommunity.com/profiles/${steamId}/inventory/#730`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost h-8 px-3 text-xs"
          >
            View on Steam ↗
          </a>
        </div>
      </div>
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
  const asOf = ago(view.fetched_at);

  return (
    <div className="space-y-4">
      {view.stale && asOf ? (
        <p className="rounded-lg border border-line bg-panel2/40 px-3 py-2 text-[11px] text-muted">
          Steam is throttling inventory reads right now, so this is our last good read from{" "}
          <span className="font-semibold text-ink">{asOf}</span>. Prices and items may have moved
          since.
        </p>
      ) : null}

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
              {view.priced_items} of {view.item_count} items priced
              {view.realized_items ? (
                <>
                  {" · "}
                  <span
                    className="text-muted"
                    title="Valued at the median of what actually sold on Skinport in the last 30 days, rather than at a suggested price"
                  >
                    {view.realized_items} on real sale prices
                  </span>
                </>
              ) : null}
              {" · via Skinport"}
            </div>
            {view.truncated ? (
              <div className="mt-1 text-[11px] text-muted">
                Steam caps how much of an inventory it hands over at once, so this covers the first{" "}
                {view.item_count}
                {view.total_items ? ` of ${view.total_items}` : ""} items — the real total is higher.
              </div>
            ) : null}
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

      {items.length > 0 ? (
        <Collection items={items} />
      ) : (
        <p className="px-4 py-8 text-center text-sm text-muted">No items to show.</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-3">
        <p className="text-[10px] leading-snug text-faint">
          Values in USD from Skinport: the median of the last 30 days of real sales where an item
          sells often enough for that to mean something, otherwise Skinport&apos;s suggested price.
          These are cash-market figures, not Steam wallet prices, and items with no market price
          aren&apos;t counted. Inventory data from Steam; shown only for public inventories
          {asOf ? <> · read {asOf}</> : null}.
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

// The collection itself: category tabs across the top, a priced/unpriced
// switch, a sort, and the grid. All client-side — the whole inventory is
// already in hand, so filtering costs nothing and never re-hits Steam.
function Collection({ items }: { items: InvItem[] }) {
  const [cat, setCat] = useState("all");
  const [priced, setPriced] = useState<PriceFilter>("all");
  const [sort, setSort] = useState<SortKey>("value");
  const [shown, setShown] = useState(PAGE);

  // categories, richest first — the tab row doubles as the breakdown that
  // used to sit at the bottom as dead chips
  const cats = useMemo(() => {
    const m = new Map<string, { name: string; count: number; value: number }>();
    for (const it of items) {
      const name = it.type || "Other";
      const c = m.get(name) ?? { name, count: 0, value: 0 };
      c.count += it.count;
      c.value += stackValue(it);
      m.set(name, c);
    }
    return [...m.values()].sort((a, b) => b.value - a.value || b.count - a.count);
  }, [items]);

  // Counts are of items owned, not of grid entries — a stack of 12 cases is
  // 12. "All" therefore has to sum the same way the category tabs do, or the
  // tabs visibly fail to add up to it.
  const totalOwned = useMemo(() => items.reduce((a, i) => a + i.count, 0), [items]);
  const unpricedTotal = useMemo(
    () => items.reduce((a, i) => (i.price ? a : a + i.count), 0),
    [items],
  );

  const visible = useMemo(() => {
    const out = items.filter((it) => {
      if (cat !== "all" && (it.type || "Other") !== cat) return false;
      if (priced === "priced" && !it.price) return false;
      if (priced === "unpriced" && it.price) return false;
      return true;
    });
    out.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "rarity") {
        const d = rarityRank(b.rarity) - rarityRank(a.rarity);
        if (d) return d;
      }
      return stackValue(b) - stackValue(a) || a.name.localeCompare(b.name);
    });
    return out;
  }, [items, cat, priced, sort]);

  // a filter change should always land you at the top of a fresh page
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setShown(PAGE);
  };

  return (
    <div>
      {/* category tabs — the row scrolls rather than wrapping, so a fade on the
          right edge shows there is more than the last visible tab */}
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-linear-to-l from-panel2 to-transparent"
        />
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          <CatTab active={cat === "all"} onClick={() => reset(setCat)("all")} name="All" count={totalOwned} />
          {cats.map((c) => (
            <CatTab
              key={c.name}
              active={cat === c.name}
              onClick={() => reset(setCat)(c.name)}
              name={c.name}
              count={c.count}
              value={c.value}
            />
          ))}
        </div>
      </div>

      {/* priced / unpriced + sort */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-line bg-panel p-0.5">
          {(
            [
              ["all", "All"],
              ["priced", "Priced"],
              ["unpriced", `No price${unpricedTotal ? ` (${unpricedTotal})` : ""}`],
            ] as [PriceFilter, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => reset(setPriced)(k)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                priced === k ? "bg-line/50 text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-faint">
          Sort
          <select
            value={sort}
            onChange={(e) => reset(setSort)(e.target.value as SortKey)}
            className="rounded-md border border-line bg-panel px-2 py-1 text-[11px] font-semibold text-ink"
          >
            <option value="value">Value</option>
            <option value="rarity">Rarity</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>

      {/* why these have no price, said once rather than on every card */}
      {priced === "unpriced" && visible.length > 0 ? (
        <p className="mt-2 rounded-lg border border-line bg-panel2/40 px-3 py-2 text-[11px] leading-relaxed text-muted">
          These carry no value because no market will quote one.{" "}
          <span className="font-semibold text-ink">Not sellable</span>
          {" means Steam doesn't allow the item on the Community Market at all — service medals, "}
          {"coins, badges, applied graffiti, name tags and storage units. "}
          <span className="font-semibold text-ink">No price</span>
          {" means it can be sold, but nothing is listed and too few have sold recently to take a "}
          {"median from."}
        </p>
      ) : null}

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {visible.slice(0, shown).map((it) => (
          <ItemCard key={it.market_hash_name} it={it} />
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted">Nothing here — try another filter.</p>
      ) : null}

      {visible.length > shown ? (
        <div className="mt-3 flex justify-center">
          <button type="button" onClick={() => setShown((n) => n + PAGE * 2)} className="btn btn-ghost h-8 px-4 text-xs">
            Show more ({visible.length - shown} left)
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CatTab({
  active,
  onClick,
  name,
  count,
  value,
}: {
  active: boolean;
  onClick: () => void;
  name: string;
  count: number;
  value?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-left transition ${
        active ? "border-brand/50 bg-brand/10" : "border-line bg-panel hover:border-line2"
      }`}
    >
      <span className={`block text-[11px] font-semibold ${active ? "text-ink" : "text-muted"}`}>
        {name} <span className="tabular-nums text-faint">{count}</span>
      </span>
      {value != null && value > 0 ? (
        <span className="block text-[10px] tabular-nums text-faint">{usd(value)}</span>
      ) : null}
    </button>
  );
}

function ItemCard({ it }: { it: InvItem }) {
  const hue = it.rarity_color || "#8a93a5";
  const wear = it.exterior ? (WEAR_SHORT[it.exterior] ?? it.exterior) : "";
  const gap = priceGap(it);
  return (
    <div
      className="group relative overflow-hidden rounded-xl border p-2.5 transition duration-150 hover:-translate-y-0.5"
      style={{ borderColor: `${hue}40`, background: `linear-gradient(180deg, ${hue}14, transparent 70%)` }}
      title={
        it.price
          ? `${it.name} — ${usd(it.price)} each. ${
              it.sale_volume
                ? `Median of ${it.sale_volume} sales in the last 30 days.`
                : "Skinport's suggested price — no recent sales to go on."
            }${
              it.price_variants
                ? ` This skin comes in ${it.price_variants} separately-priced finishes and a public inventory doesn't say which one this is, so the figure is the median across them.`
                : ""
            }`
          : gap
            ? `${it.name} — ${gap.long}`
            : it.name
      }
    >
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, ${hue}, transparent)` }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={it.icon} alt="" loading="lazy" referrerPolicy="no-referrer" className="mx-auto h-20 w-auto object-contain drop-shadow-md" />
      <div className="mt-1.5 min-h-8">
        <p className="truncate text-[11px] font-semibold leading-tight text-ink">
          {it.name.replace(/^StatTrak™ /, "").replace(/^Souvenir /, "")}
        </p>
        <p className="flex items-center gap-1 text-[9px] leading-tight text-faint">
          {it.stattrak ? <span className="font-bold text-[#cf6a32]">ST™</span> : null}
          {it.souvenir ? <span className="font-bold text-[#ffd700]">SOUV</span> : null}
          {wear ? <span>{wear}</span> : null}
          {it.count > 1 ? <span>×{it.count}</span> : null}
        </p>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-1">
        {gap ? (
          <span className="truncate text-[10px] font-semibold text-faint" title={gap.long}>
            {gap.short}
          </span>
        ) : (
          <>
            <span className="text-xs font-bold tabular-nums text-ink">
              {it.price_variants ? "~" : ""}
              {usd((it.price ?? 0) * it.count)}
            </span>
            {it.count > 1 ? (
              <span className="text-[9px] tabular-nums text-faint">{usd(it.price ?? 0)} ea</span>
            ) : it.price_variants ? (
              <span className="text-[9px] text-faint">phase?</span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
