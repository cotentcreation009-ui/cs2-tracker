"use client";

import { useState } from "react";
import { resolvePlayerPhoto } from "@/lib/liquipediaClient";

// Pro-player avatar: team-tinted initials that upgrade to the player's
// Liquipedia photo (CC BY-SA). Tries our backend cache first; if the server
// can't provide it (Liquipedia rate-limits datacenter IPs), the browser
// resolves the photo itself via Liquipedia's CORS API and hotlinks the
// thumbnail with no referrer. Initials remain the instant fallback.
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
  const [src, setSrc] = useState<string | null>(
    `/api/pro-matches/player-image/${encodeURIComponent(nick)}`,
  );
  const [loaded, setLoaded] = useState(false);
  const [triedClient, setTriedClient] = useState(false);

  const onError = () => {
    setLoaded(false);
    if (triedClient) {
      setSrc(null);
      return;
    }
    setTriedClient(true);
    setSrc(null);
    resolvePlayerPhoto(nick)
      .then((u) => {
        if (u) setSrc(u);
      })
      .catch(() => {
        // keep initials
      });
  };

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
        ...(card ? { aspectRatio: "4 / 5", fontSize: 20 } : { width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.36)) }),
        background: `${hex}1f`,
        color: hex,
        boxShadow: `inset 0 0 0 1px ${hex}40`,
      }}
    >
      {nick.slice(0, 2)}
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={onError}
          className={`absolute inset-0 h-full w-full object-cover ${card ? "object-top" : ""} transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      ) : null}
    </span>
  );
}
