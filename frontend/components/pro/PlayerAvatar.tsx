"use client";

import { useState } from "react";

// Pro-player avatar: team-tinted initials that upgrade to the player's
// Liquipedia photo (CC BY-SA) once /api/pro-matches/player-image resolves.
// Cold lookups are rate-limited server-side, so photos can fill in
// progressively — the initials stay as the instant fallback.
export function PlayerAvatar({
  nick,
  hex,
  size = 28,
}: {
  nick: string;
  hex: string;
  size?: number;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <span
      aria-hidden
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-full font-extrabold uppercase leading-none"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(8, Math.round(size * 0.36)),
        background: `${hex}1f`,
        color: hex,
        boxShadow: `inset 0 0 0 1px ${hex}40`,
      }}
    >
      {nick.slice(0, 2)}
      {!failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/pro-matches/player-image/${encodeURIComponent(nick)}`}
          alt=""
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      ) : null}
    </span>
  );
}
