import type { ReactNode } from "react";

export function StatCard({
  label,
  value,
  sub,
  valueClass = "text-ink",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="card px-4 py-3.5 transition-colors hover:border-line2">
      <div className="stat-label">{label}</div>
      <div
        className={`mt-1.5 text-2xl font-bold tabular-nums tracking-tight ${valueClass}`}
      >
        {value}
      </div>
      {sub != null && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}
