"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode,
} from "react";

/**
 * One tile on the rail. Deliberately dumb data: callers map their own domain
 * objects onto this shape, so the rail never learns about players, teams or
 * any API. Everything optional is genuinely optional — a card with nothing but
 * an id and a name still renders honestly instead of inventing filler.
 */
export interface RailCard {
  id: string;
  /** Headline, rendered uppercase. */
  name: string;
  /** When set, the whole card becomes a link. */
  href?: string;
  /** Any remote host; missing or broken falls back to an initial-letter tile. */
  imageUrl?: string;
  /**
   * A caller-rendered photo for the picture area, for sources the rail cannot
   * fetch from a URL — e.g. player photos that only resolve in the visitor's
   * browser. Takes precedence over imageUrl; the node is expected to fill the
   * tile (it is placed absolute inset-0).
   */
  media?: ReactNode;
  /** CSS colour for the segment pills / hover glow. Defaults to the brand cyan. */
  accent?: string;
  /** Shown as a small corner badge when present. */
  rank?: number;
  /** e.g. a team name or country. */
  subtitle?: string;
  /** Up to 3 are shown, small, under the name. */
  stats?: { label: string; value: string }[];
  /** 0..1 — how many of the segment pills are lit. */
  meter?: number;
}

const CARD_W = 158; // px, card width
const CARD_GAP = 12; // px, must match the mr-3 on each <li> (the loop math needs it)
const SEGMENTS = 5;
const REF_CARDS = 8; // speedSec is quoted for a rail of this many cards

/**
 * Keyframes + the hover/focus/reduced-motion rules Tailwind can't express.
 * React dedupes by `href`, so several rails on one page share one definition
 * and it gets hoisted into <head>. (A module-level "already rendered" flag was
 * the obvious guard but is wrong under SSR: the module outlives the request, so
 * every page after the first would render no CSS at all.)
 *
 * These rules are deliberately unlayered — they outrank Tailwind's layered
 * utilities and the .card component class, so the accent glow always wins.
 */
const RAIL_CSS = `
@keyframes csrunRailDrift {
  from { transform: translate3d(0, 0, 0); }
  to   { transform: translate3d(-50%, 0, 0); }
}
.csrun-rail-track {
  animation: csrunRailDrift var(--rail-dur, 40s) linear infinite;
  will-change: transform;
}
.csrun-rail:hover .csrun-rail-track,
.csrun-rail:focus-within .csrun-rail-track { animation-play-state: paused; }
.csrun-rail-fade {
  -webkit-mask-image: linear-gradient(to right, transparent, #000 28px, #000 calc(100% - 28px), transparent);
  mask-image: linear-gradient(to right, transparent, #000 28px, #000 calc(100% - 28px), transparent);
}
.csrun-rail-card {
  transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;
}
.csrun-rail-card:hover,
.csrun-rail-card:focus-visible {
  transform: translateY(-3px);
  border-color: color-mix(in srgb, var(--rail-accent) 65%, transparent);
  box-shadow: 0 0 30px -10px var(--rail-accent), 0 20px 40px -30px rgba(0, 0, 0, .9);
}
/* globals.css rounds every :focus-visible to 6px for its outline; without this
   a focused card's corners would snap square. The doubled class wins whatever
   order the two stylesheets land in. */
.csrun-rail-card.csrun-rail-card:focus-visible { border-radius: 1rem; }
.csrun-rail-photo { transition: transform .35s ease; }
.csrun-rail-card:hover .csrun-rail-photo { transform: scale(1.06); }
@media (prefers-reduced-motion: reduce) {
  .csrun-rail-track { animation: none; }
  .csrun-rail-echo { display: none; }
  .csrun-rail-card, .csrun-rail-photo { transition: none; }
  .csrun-rail-card:hover, .csrun-rail-card:focus-visible { transform: none; }
  .csrun-rail-skeleton { animation: none; }
}
`;

const CARD_CLS =
  "csrun-rail-card relative block h-[230px] w-[158px] overflow-hidden rounded-2xl border border-line";

function Tile({ card, echo = false }: { card: RailCard; echo?: boolean }) {
  // Remembering the URL that failed (not a boolean) means a card that later
  // gets a different imageUrl retries on its own, with no reset effect.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const accent = card.accent?.trim() || "var(--color-brand)";
  const photo = card.imageUrl && card.imageUrl !== failedSrc ? card.imageUrl : null;
  const stats = card.stats?.slice(0, 3) ?? [];
  const lit =
    card.meter == null
      ? null
      : Math.round(Math.min(1, Math.max(0, card.meter)) * SEGMENTS);
  const initial = Array.from(card.name.trim())[0]?.toUpperCase() ?? "?";

  const style = {
    "--rail-accent": accent,
    backgroundColor: "var(--color-panel2)",
    // Lit surface: the accent bleeds in from the top-left corner. Only really
    // visible on photo-less cards, which is exactly where the tile needs help.
    backgroundImage: `linear-gradient(160deg, color-mix(in srgb, ${accent} 18%, transparent), transparent 58%)`,
  } as CSSProperties;

  const inner = (
    <>
      {card.media ? (
        // A photo the caller had to render itself (the rail can't fetch it from
        // a URL). Same wrapper class as the <img>, so it gets the hover zoom.
        <span className="csrun-rail-photo absolute inset-0">{card.media}</span>
      ) : photo ? (
        // next/image is wrong here: sources are arbitrary remote hosts the
        // caller supplies, so there is no remotePatterns list to whitelist.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(photo)}
          className="csrun-rail-photo absolute inset-0 h-full w-full object-cover object-top"
        />
      ) : (
        <span
          aria-hidden="true"
          className="absolute inset-0 grid place-items-center text-6xl font-black uppercase leading-none opacity-40"
          style={{ color: accent }}
        >
          {initial}
        </span>
      )}

      {/* Scrim: keeps the caps legible over a bright photo. */}
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-linear-to-t from-bg via-bg/55 to-transparent"
      />

      {card.rank != null && (
        <span className="absolute left-2 top-2 rounded-md border border-line bg-bg/80 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted">
          #{card.rank}
        </span>
      )}

      <span className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-2.5">
        {card.subtitle && (
          <span className="truncate text-[10px] uppercase tracking-wider text-faint">
            {card.subtitle}
          </span>
        )}
        <span className="truncate text-[15px] font-extrabold uppercase leading-tight tracking-tight text-ink">
          {card.name}
        </span>

        {stats.length > 0 && (
          <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] leading-none">
            {stats.map((s) => (
              <span key={s.label} className="whitespace-nowrap">
                <span className="text-faint">{s.label} </span>
                <span className="font-semibold tabular-nums text-ink">{s.value}</span>
              </span>
            ))}
          </span>
        )}

        {/* The rail doesn't know what a meter measures, so it stays decorative
            for assistive tech — a bare "60%" would be noise. With no meter we
            show a plain accent underline: a row of unlit segments would read
            as a score of zero we were never given. */}
        {lit == null ? (
          <span
            aria-hidden="true"
            className="mt-0.5 h-[3px] w-8 rounded-full opacity-75"
            style={{ backgroundColor: accent }}
          />
        ) : (
          <span aria-hidden="true" className="mt-0.5 flex gap-1">
            {Array.from({ length: SEGMENTS }).map((_, i) => (
              <span
                key={i}
                className="h-[3px] flex-1 rounded-full"
                style={
                  i < lit
                    ? { backgroundColor: accent, boxShadow: `0 0 8px -1px ${accent}` }
                    : { backgroundColor: "color-mix(in srgb, var(--color-line) 85%, transparent)" }
                }
              />
            ))}
          </span>
        )}
      </span>
    </>
  );

  if (!card.href) {
    return (
      <span className={CARD_CLS} style={style}>
        {inner}
      </span>
    );
  }

  const external = /^(https?:)?\/\//i.test(card.href);
  return (
    <Link
      href={card.href}
      className={CARD_CLS}
      style={style}
      // The duplicated copy is aria-hidden, so its links must leave the tab
      // order too — otherwise every card is reachable twice.
      tabIndex={echo ? -1 : undefined}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {inner}
    </Link>
  );
}

function Strip({ cards, echo = false }: { cards: RailCard[]; echo?: boolean }) {
  return (
    <>
      {cards.map((c) => (
        // The margin lives on every item (including the last) so one pass is
        // exactly n * (card + gap) wide and the -50% loop lands seamlessly.
        <li key={c.id} className="mr-3 shrink-0">
          <Tile card={c} echo={echo} />
        </li>
      ))}
    </>
  );
}

/**
 * A horizontally drifting wall of portrait cards.
 *
 * Motion: the list is rendered twice inside one track and translated 0 → -50%
 * on a linear infinite loop, so the seam is invisible. It pauses on hover and
 * on focus-within so cards stay clickable, and `prefers-reduced-motion` drops
 * the animation and the duplicate entirely, leaving a plain scroll strip. The
 * viewport is `overflow-x: auto` in both modes, so touch and trackpad always
 * work.
 */
export function SpotlightRail({
  title,
  subtitle,
  cards,
  loading = false,
  emptyNote,
  speedSec = 40,
  action,
}: {
  title: string;
  subtitle?: string;
  cards: RailCard[];
  loading?: boolean;
  emptyNote?: string;
  /** Controls for this rail (e.g. a region switcher), shown beside the title. */
  action?: ReactNode;
  /** Seconds for one full pass at ~8 cards; scaled up as cards are added. */
  speedSec?: number;
}): JSX.Element {
  const viewRef = useRef<HTMLDivElement>(null);
  const [loop, setLoop] = useState(false);
  const count = cards.length;

  // The duplicate copy only earns its place once one pass overflows the rail.
  // Below that the translate would drag the row off screen and leave a hole,
  // so we stay a static strip. Measured rather than guessed from card count
  // because "enough cards" depends entirely on the viewport.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const measure = () =>
      setLoop(count * (CARD_W + CARD_GAP) > view.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(view);
    return () => ro.disconnect();
    // `loading` matters even though the body never reads it: the viewport only
    // exists once the skeletons are gone, so a loading→loaded flip that leaves
    // the card count unchanged would otherwise never get measured at all.
  }, [count, loading]);

  // translateX is a percentage of the track, so the same duration over more
  // cards would just scroll faster. Scale with the count to hold the glide.
  const durationSec = Math.max(
    10,
    Math.round(speedSec * (Math.max(count, 1) / REF_CARDS)),
  );

  return (
    <section>
      <style href="csrun-spotlight-rail" precedence="csrun-rail">
        {RAIL_CSS}
      </style>

      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="shrink-0 text-sm font-semibold uppercase tracking-wider text-muted">
            {title}
          </h2>
          {action}
        </div>
        {subtitle && <p className="truncate text-xs text-faint">{subtitle}</p>}
      </div>

      {loading ? (
        <div
          aria-busy="true"
          className="scroll-slim overflow-x-auto overflow-y-hidden"
        >
          <div className="flex w-max py-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="csrun-rail-skeleton mr-3 h-[230px] w-[158px] shrink-0 animate-pulse rounded-2xl border border-line bg-panel2"
              />
            ))}
          </div>
        </div>
      ) : count === 0 ? (
        <div className="card px-4 py-6 text-center text-sm text-muted">
          {emptyNote || "Nothing to show here yet."}
        </div>
      ) : (
        <div className={`csrun-rail relative ${loop ? "csrun-rail-fade" : ""}`}>
          <div
            ref={viewRef}
            className="scroll-slim overflow-x-auto overflow-y-hidden"
          >
            <div
              className={`flex w-max ${loop ? "csrun-rail-track" : ""}`}
              style={{ "--rail-dur": `${durationSec}s` } as CSSProperties}
            >
              {/* py-3 leaves room for the hover lift + glow, which the
                  scroll container would otherwise clip. */}
              <ul className="flex shrink-0 py-3">
                <Strip cards={cards} />
              </ul>
              {loop && (
                <ul className="csrun-rail-echo flex shrink-0 py-3" aria-hidden="true">
                  <Strip cards={cards} echo />
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
