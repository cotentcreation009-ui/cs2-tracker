"use client";

import { useEffect, useState } from "react";

interface PollState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

// Lightweight polling hook — the project has no SWR dependency, so this covers
// the "fetch on mount + refetch on an interval" need with a few niceties:
//   • pauses while the tab is hidden (no wasted requests in a background tab)
//   • refetches immediately when the tab becomes visible again
//   • keeps the last good `data` on a transient error so scores don't flash out
//   • accepts `initialData` so a server-rendered detail page hydrates instantly
export function usePoll<T>(
  url: string,
  intervalMs: number,
  opts: { enabled?: boolean; initialData?: T | null } = {},
): PollState<T> {
  const { enabled = true, initialData = null } = opts;
  const [data, setData] = useState<T | null>(initialData);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(initialData == null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (!alive) return;
      // Skip the network while hidden; re-check on the next interval.
      if (typeof document !== "undefined" && document.hidden) {
        timer = setTimeout(tick, intervalMs);
        return;
      }
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const json = (await res.json()) as T;
        if (!alive) return;
        setData(json);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) {
          setLoading(false);
          timer = setTimeout(tick, intervalMs);
        }
      }
    };

    void tick();

    const onVisible = () => {
      if (!document.hidden && alive) {
        if (timer) clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, intervalMs, enabled]);

  return { data, error, loading };
}

// Re-renders every `ms` so relative "Ns ago" freshness labels tick up between
// polls. Returns the current epoch millis.
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
