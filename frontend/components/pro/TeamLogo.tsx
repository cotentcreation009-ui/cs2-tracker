"use client";

import { useState } from "react";
import { validHex } from "./format";

// Team crest with a lettered fallback tile for private/missing/broken logos
// (mirrors FriendsPanel's Avatar). `color` (team colorPrimary) tints the
// fallback tile's ring so teams stay visually distinct even without art.
export function TeamLogo({
  name,
  src,
  size = 40,
  color,
  className = "",
}: {
  name?: string;
  src?: string;
  size?: number;
  color?: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  const dim = { width: size, height: size };
  const tint = validHex(color);

  if (src && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setBroken(true)}
        style={dim}
        className={`shrink-0 rounded-lg object-contain ${className}`}
      />
    );
  }
  return (
    <span
      style={{
        ...dim,
        borderColor: tint ? `${tint}66` : undefined,
        color: tint ?? undefined,
      }}
      className={`grid shrink-0 place-items-center rounded-lg border border-line bg-panel font-bold text-muted ${className}`}
    >
      <span style={{ fontSize: size * 0.42 }}>{initial}</span>
    </span>
  );
}
