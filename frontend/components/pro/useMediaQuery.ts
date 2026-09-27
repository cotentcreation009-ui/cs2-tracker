"use client";

import { useCallback, useSyncExternalStore } from "react";

// True when the viewport matches `query` (a CSS media query). Server-rendered
// HTML and the hydration pass always see `false`, so markup never mismatches;
// React then re-renders synchronously with the real answer before the visitor
// can interact. Quote breakpoints in rem, as Tailwind does, so JS and CSS keep
// agreeing when a visitor has changed their root font size.
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(
    () => window.matchMedia(query).matches,
    [query],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function getServerSnapshot(): boolean {
  return false;
}
