"use client";

// SectionJump — the three quick-jump buttons that sit next to the player's name
// on the stats page. Each smooth-scrolls to (and briefly flashes) one of the big
// on-page sections: the FACEIT-vs-Premier split, the extended Leetify stats, and
// the counter report (map ban plan). A button only renders when its target
// section is actually on the page (all three need Leetify data; the split also
// needs recent matches). The scroll targets are the id'd wrappers in ProfileView.

type JumpKey = "split" | "leetify" | "counter";

const JUMPS: { key: JumpKey; id: string; label: string; hex: string; path: string }[] = [
  {
    key: "split",
    id: "platform-split",
    label: "FACEIT vs Premier",
    hex: "#f5b942",
    path: "M4 8h13l-3-3M20 16H7l3 3", // swap arrows
  },
  {
    key: "leetify",
    id: "leetify-stats",
    label: "Leetify stats",
    hex: "#5b9dff",
    path: "M4 20V10M10 20V4M16 20v-7M20 20H3", // bar chart
  },
  {
    key: "counter",
    id: "counter-report",
    label: "Counter report",
    hex: "#f5694a",
    path: "M12 3 5 6v5c0 4 3 7 7 8 4-1 7-4 7-8V6z", // shield (game plan)
  },
];

export function SectionJump({
  split = false,
  leetify = false,
  counter = false,
  className = "",
}: {
  split?: boolean;
  leetify?: boolean;
  counter?: boolean;
  className?: string;
}) {
  const avail: Record<JumpKey, boolean> = { split, leetify, counter };
  const items = JUMPS.filter((j) => avail[j.key]);
  if (!items.length) return null;

  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.remove("jump-flash");
    // reflow so re-adding the class restarts the animation on repeat clicks
    void el.offsetWidth;
    el.classList.add("jump-flash");
    window.setTimeout(() => el.classList.remove("jump-flash"), 1500);
  };

  return (
    <div className={`flex flex-wrap items-center justify-center gap-2 ${className}`}>
      {items.map((j) => (
        <button
          key={j.id}
          type="button"
          onClick={() => go(j.id)}
          title={`Jump to ${j.label}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel2 px-3 py-1.5 text-sm font-medium text-ink transition hover:border-brand/60 hover:bg-panel"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 shrink-0"
            fill="none"
            stroke={j.hex}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d={j.path} />
          </svg>
          {j.label}
        </button>
      ))}
    </div>
  );
}
