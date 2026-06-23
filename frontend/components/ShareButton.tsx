"use client";

import { useState } from "react";

/**
 * ShareButton copies the current page URL (or uses the native share sheet on
 * mobile) so players can drop a profile/compare link into Discord/Twitter — the
 * viral loop a stats site runs on. Client component for clipboard/navigator.
 */
export function ShareButton({ label = "Share" }: { label?: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.href;
    const title = document.title;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        /* user cancelled or unsupported — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; nothing we can do */
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-panel2 px-3 py-1.5 text-sm font-medium text-ink transition hover:border-brand/60"
    >
      {copied ? "Link copied ✓" : label}
    </button>
  );
}
