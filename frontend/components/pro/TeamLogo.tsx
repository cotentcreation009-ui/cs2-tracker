"use client";

import { useState } from "react";
import { readableOn, validHex } from "./format";

// Team crest. A real logo sits on a subtle dark tile with a team-colour ring;
// when there's no art (or it breaks), we fall back to a BADGE tinted with the
// team's colour + high-contrast initials — so teams keep a visual identity even
// without a logo, instead of a blank shield.
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
      <span
        style={{
          ...dim,
          boxShadow: tint ? `inset 0 0 0 1px ${tint}55` : undefined,
        }}
        className={`grid shrink-0 place-items-center overflow-hidden rounded-xl bg-panel/70 p-1 ring-1 ring-line/70 ${className}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          className="max-h-full max-w-full object-contain"
        />
      </span>
    );
  }

  const base = tint ?? "#3a4358";
  return (
    <span
      style={{
        ...dim,
        background: `linear-gradient(140deg, ${base}, color-mix(in srgb, ${base} 42%, #05070d))`,
        color: readableOn(base),
      }}
      className={`grid shrink-0 place-items-center rounded-xl font-black ring-1 ring-white/10 ${className}`}
    >
      <span style={{ fontSize: size * 0.44, textShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>
        {initial}
      </span>
    </span>
  );
}
