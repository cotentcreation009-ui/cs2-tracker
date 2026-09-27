"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

// The board's "next layer": a floating panel of detail that opens on hover
// and on keyboard focus, and goes away on leave, blur, Escape, scroll or
// resize. One panel per list — the hook holds a single anchor — placed beside
// the row it describes. It is a tooltip, not a menu: nothing inside it takes
// focus, so it never traps it, and the row points at it with aria-describedby
// so a screen reader hears the same detail the pointer sees.

export interface DetailAnchor {
  key: string;
  rect: DOMRect;
}

export function useDetailAnchor() {
  const [anchor, setAnchor] = useState<DetailAnchor | null>(null);
  const close = useCallback(() => setAnchor(null), []);

  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    // Any scroller — the page, a sidebar, the standings strip — moves the
    // anchor out from under the panel.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [anchor, close]);

  const bind = useCallback(
    (key: string) => {
      const open = (e: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) =>
        setAnchor({ key, rect: e.currentTarget.getBoundingClientRect() });
      return { onMouseEnter: open, onMouseLeave: close, onFocus: open, onBlur: close };
    },
    [close],
  );

  return { anchor, bind, close };
}

/** The handlers `bind(key)` hands a row. */
export type RowBind = ReturnType<ReturnType<typeof useDetailAnchor>["bind"]>;

/**
 * Where the panel sits relative to its anchor. "right"/"left"/"under" are
 * fixed to the viewport, for rows inside a panel that scrolls or clips;
 * "inline" hangs under the row in flow (the row must be position: relative).
 */
export type Placement = "right" | "left" | "under" | "inline";

const GAP = 8;

function initialStyle(anchor: DOMRect, place: Placement, width: number): CSSProperties {
  if (place === "inline") return { width };
  if (place === "under") return { position: "fixed", top: anchor.bottom + GAP, left: anchor.left, width };
  if (place === "right") return { position: "fixed", top: anchor.top, left: anchor.right + GAP, width };
  return {
    position: "fixed",
    top: anchor.top,
    right: document.documentElement.clientWidth - anchor.left + GAP,
    width,
  };
}

export function DetailPopover({
  id,
  anchor,
  place,
  width = 272,
  children,
}: {
  id: string;
  anchor: DOMRect;
  place: Placement;
  width?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>(() => initialStyle(anchor, place, width));

  // Once the panel has a height, keep it inside the viewport: slide a
  // right/left panel up, flip an "under" panel above its anchor.
  useLayoutEffect(() => {
    if (place === "inline") return;
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    if (place === "under") {
      const left = Math.max(GAP, Math.min(anchor.left, vw - width - GAP));
      const below = anchor.bottom + GAP;
      const top = below + h > vh - GAP ? Math.max(GAP, anchor.top - h - GAP) : below;
      setStyle({ position: "fixed", top, left, width });
      return;
    }
    const top = Math.max(GAP, Math.min(anchor.top, vh - h - GAP));
    setStyle(
      place === "right"
        ? { position: "fixed", top, left: anchor.right + GAP, width }
        : { position: "fixed", top, right: vw - anchor.left + GAP, width },
    );
  }, [anchor, place, width]);

  return (
    <div
      ref={ref}
      id={id}
      role="tooltip"
      style={style}
      // bg-panel2 over .card: a panel floating over dense rows must be opaque.
      className={`modal-pop card pointer-events-none z-30 rounded-xl bg-panel2 p-3 text-xs text-muted shadow-2xl ${
        place === "inline" ? "absolute left-0 top-full mt-1" : ""
      }`}
    >
      {children}
    </div>
  );
}

/** One "label · value" line of a detail panel. */
export function DetailLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 leading-snug">
      <span className="shrink-0 text-faint">{label}</span>
      <span className="min-w-0 text-right font-semibold tabular-nums text-ink">{children}</span>
    </div>
  );
}

/** What a click does — the panel's last line. */
export function DetailHint({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 border-t border-line/50 pt-1.5 text-[10px] leading-snug text-faint">
      {children}
    </p>
  );
}
