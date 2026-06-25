import type { PlayerCareer } from "@/lib/types";
import { fmt } from "@/lib/format";

const TONES = [
  "bg-line2",
  "bg-brand/50",
  "bg-brand",
  "bg-brand2",
  "bg-mid",
];

/**
 * MultiKillBar shows the full 1K–5K round distribution that the profile
 * otherwise collapses into a single "multi-kill rounds" number — a quick read on
 * how often a player gets aces vs single frags. Parsed-career data only.
 */
export function MultiKillBar({ career }: { career: PlayerCareer }) {
  const buckets = [
    { label: "1K", n: career.k1 },
    { label: "2K", n: career.k2 },
    { label: "3K", n: career.k3 },
    { label: "4K", n: career.k4 },
    { label: "5K", n: career.k5 },
  ];
  const total = buckets.reduce((s, b) => s + b.n, 0);
  if (total === 0) return null;

  return (
    <div className="card px-5 py-4">
      <div className="stat-label mb-2">Multi-kill rounds</div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-panel">
        {buckets.map((b, i) =>
          b.n > 0 ? (
            <span
              key={b.label}
              className={TONES[i]}
              style={{ width: `${(b.n / total) * 100}%` }}
              title={`${b.label}: ${fmt(b.n)} rounds`}
            />
          ) : null,
        )}
      </div>
      <div className="mt-2 grid grid-cols-5 gap-1 text-center">
        {buckets.map((b, i) => (
          <div key={b.label}>
            <div className="flex items-center justify-center gap-1 text-xs text-muted">
              <span className={`h-2 w-2 rounded-full ${TONES[i]}`} />
              {b.label}
            </div>
            <div className="text-sm font-semibold tabular-nums">{fmt(b.n)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
