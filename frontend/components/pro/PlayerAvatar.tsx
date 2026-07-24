"use client";

import { useEffect, useState } from "react";
import { resolvePlayerPhoto } from "@/lib/liquipediaClient";

// Pro-player avatar: team-tinted placeholder that upgrades to the player's
// Liquipedia photo (CC BY-SA). Resolution happens in the BROWSER, batched for
// the whole page (two API calls total) — the backend can't fetch these
// because Liquipedia rate-limits datacenter IPs, and routing through it made
// photos trickle in one by one. Players without a photo keep a silhouette
// (card) or initials (circle) so nothing looks broken.
export function PlayerAvatar({
  nick,
  hex,
  size = 28,
  shape = "circle",
}: {
  nick: string;
  hex: string;
  size?: number;
  /** "circle" = inline avatar; "card" = fills its parent (HLTV-style photo tile) */
  shape?: "circle" | "card";
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    resolvePlayerPhoto(nick)
      .then((u) => {
        if (alive && u) setSrc(u);
      })
      .catch(() => {
        // keep the placeholder
      });
    return () => {
      alive = false;
    };
  }, [nick]);

  const card = shape === "card";
  return (
    <span
      aria-hidden
      className={
        card
          ? "relative grid w-full place-items-center overflow-hidden rounded-lg font-extrabold uppercase leading-none"
          : "relative grid shrink-0 place-items-center overflow-hidden rounded-full font-extrabold uppercase leading-none"
      }
      style={{
        ...(card
          ? { aspectRatio: "4 / 5" }
          : { width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.36)) }),
        background: `${hex}1f`,
        color: hex,
        boxShadow: `inset 0 0 0 1px ${hex}40`,
      }}
    >
      {card ? (
        // default player silhouette for photo-less players
        <svg viewBox="0 0 24 24" className="absolute bottom-0 w-[70%] opacity-45" fill="currentColor">
          <path d="M12 12.2c2.6 0 4.7-2.2 4.7-4.9S14.6 2.4 12 2.4 7.3 4.6 7.3 7.3s2.1 4.9 4.7 4.9zm0 2.2c-4.2 0-10 2.1-10 6.3V24h20v-3.3c0-4.2-5.8-6.3-10-6.3z" />
        </svg>
      ) : (
        nick.slice(0, 2)
      )}
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setSrc(null)}
          className={`absolute inset-0 h-full w-full object-cover ${card ? "object-top" : ""} transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      ) : null}
    </span>
  );
}
