"use client";

import { useEffect, useState } from "react";
import { resolveTeamLogo } from "@/lib/liquipediaClient";

// A team's crest for the top-20 rail.
//
// GRID gives us a logo only for orgs we have actually tracked, so the best
// teams in the world were rendering as bare initials until they happened to
// play a series we poll. Liquipedia has a crest for all of them — resolved in
// the VISITOR's browser, because Liquipedia rate-limits datacenter IPs and our
// server would just collect 429s. Falls back to the initial tile, never to a
// broken image.
export function TeamCrest({
  name,
  logoUrl,
  hex,
  compact = false,
}: {
  name: string;
  logoUrl?: string;
  hex: string;
  /**
   * A small inline mark (a list row, a chip) rather than a card tile: the
   * crest fills more of the box and the fallback initial is sized to fit it.
   */
  compact?: boolean;
}) {
  const [src, setSrc] = useState<string | null>(logoUrl || null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (logoUrl) {
      setSrc(logoUrl);
      return;
    }
    let alive = true;
    resolveTeamLogo(name)
      .then((u) => {
        if (alive && u) setSrc(u);
      })
      .catch(() => {
        /* keep the initial */
      });
    return () => {
      alive = false;
    };
  }, [name, logoUrl]);

  const show = src && !failed;
  return (
    <span
      aria-hidden
      className="absolute inset-0 grid place-items-center overflow-hidden"
      style={{ background: `${hex}14` }}
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          // contain, not cover: a crest cropped to fill loses the mark.
          className={
            compact
              ? "h-[82%] w-[82%] object-contain"
              : "h-[62%] w-[76%] object-contain drop-shadow-[0_6px_18px_rgba(0,0,0,.55)]"
          }
        />
      ) : (
        <span
          className={`font-black uppercase leading-none ${
            compact ? "text-[11px] opacity-80" : "text-5xl opacity-40"
          }`}
          style={{ color: hex }}
        >
          {name.slice(0, 1)}
        </span>
      )}
    </span>
  );
}
