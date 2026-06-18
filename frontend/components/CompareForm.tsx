"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CompareForm({
  initialA = "",
  initialB = "",
}: {
  initialA?: string;
  initialB?: string;
}) {
  const router = useRouter();
  const [a, setA] = useState(initialA);
  const [b, setB] = useState(initialB);

  function go(e: React.FormEvent) {
    e.preventDefault();
    if (!a.trim() || !b.trim()) return;
    router.push(
      `/compare?a=${encodeURIComponent(a.trim())}&b=${encodeURIComponent(b.trim())}`,
    );
  }

  const field =
    "w-full rounded-lg border border-line bg-panel py-2 px-3 text-sm outline-none transition focus:border-brand/60 focus:ring-2 focus:ring-brand/20";

  return (
    <form onSubmit={go} className="card-2 space-y-3 px-5 py-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="stat-label">Player A</label>
          <input
            value={a}
            onChange={(e) => setA(e.target.value)}
            placeholder="SteamID64 or vanity"
            spellCheck={false}
            className={`mt-1 ${field}`}
          />
        </div>
        <div>
          <label className="stat-label">Player B</label>
          <input
            value={b}
            onChange={(e) => setB(e.target.value)}
            placeholder="SteamID64 or vanity"
            spellCheck={false}
            className={`mt-1 ${field}`}
          />
        </div>
      </div>
      <button
        type="submit"
        className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-bg transition hover:opacity-90"
      >
        Compare
      </button>
    </form>
  );
}
