"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

// StatsPeek — the three buttons next to the player's name. Instead of scrolling
// the page, each button opens a modal *over* the CheatMeter showing that
// section's full stats: FACEIT-vs-Premier split, extended Leetify stats, and the
// counter report (map ban plan). The section content is passed in as already-
// rendered nodes (server components from ProfileView), so this stays a thin
// client shell that just toggles which one is visible.

type PeekKey = "matches" | "split" | "leetify" | "counter" | "matchstats";

const META: Record<PeekKey, { label: string; hex: string; path: string }> = {
  matches: { label: "Matches", hex: "#38d6ff", path: "M12 8v4l2.5 1.5M12 3a9 9 0 1 0 9 9M17 3h4v4" },
  split: { label: "FACEIT vs Premier", hex: "#f5b942", path: "M4 8h13l-3-3M20 16H7l3 3" },
  leetify: { label: "Leetify stats", hex: "#5b9dff", path: "M4 20V10M10 20V4M16 20v-7M20 20H3" },
  counter: { label: "Counter report", hex: "#f5694a", path: "M12 3 5 6v5c0 4 3 7 7 8 4-1 7-4 7-8V6z" },
  matchstats: { label: "Match stats", hex: "#46d369", path: "M3 5h18M3 12h18M3 19h11" },
};
const ORDER: PeekKey[] = ["matches", "split", "leetify", "counter", "matchstats"];

function Glyph({ path, hex, className = "h-4 w-4" }: { path: string; hex: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} shrink-0`} fill="none" stroke={hex} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}

export function StatsPeek({
  matches,
  split,
  leetify,
  counter,
  matchstats,
  className = "",
}: {
  matches?: ReactNode;
  split?: ReactNode;
  leetify?: ReactNode;
  counter?: ReactNode;
  matchstats?: ReactNode;
  className?: string;
}) {
  const nodes: Record<PeekKey, ReactNode> = { matches, split, leetify, counter, matchstats };
  const items = ORDER.filter((k) => nodes[k]);
  const [open, setOpen] = useState<PeekKey | null>(null);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMounted(true), []);
  const close = useCallback(() => setOpen(null), []);

  // While a modal is open: lock background scroll, close on Esc, move focus into
  // the dialog, and restore focus to the button that opened it on close.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      // Focus trap: keep Tab cycling inside the dialog so it can't reach the
      // page behind the modal.
      if (e.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable.length) {
          e.preventDefault();
          dialog.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      triggerRef.current?.focus();
    };
  }, [open, close]);

  if (!items.length) return null;
  const meta = open ? META[open] : null;

  return (
    <>
      <div className={`flex flex-wrap items-center justify-center gap-2 ${className}`}>
        {items.map((k) => {
          const m = META[k];
          const active = open === k;
          return (
            <button
              key={k}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={active}
              onClick={(e) => {
                triggerRef.current = e.currentTarget;
                setOpen(k);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[13px] font-medium text-ink transition hover:bg-panel"
              style={{
                borderColor: active ? `${m.hex}` : "var(--color-line)",
                background: active ? `${m.hex}1f` : "var(--color-panel2)",
              }}
            >
              <Glyph path={m.path} hex={m.hex} />
              {m.label}
            </button>
          );
        })}
      </div>

      {mounted &&
        open &&
        meta &&
        createPortal(
          <div
            className="modal-backdrop-in fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-5"
            onMouseDown={close}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label={meta.label}
              tabIndex={-1}
              onMouseDown={(e) => e.stopPropagation()}
              className="modal-pop flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-line bg-bg shadow-2xl outline-none"
            >
              <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-panel/50 px-4 py-3 sm:px-5">
                <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted">
                  <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: `${meta.hex}1f` }}>
                    <Glyph path={meta.path} hex={meta.hex} />
                  </span>
                  {meta.label}
                </div>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-panel2 text-muted transition hover:border-brand/60 hover:text-ink"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              </header>
              <div className="overflow-y-auto p-3 sm:p-4">{nodes[open]}</div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
