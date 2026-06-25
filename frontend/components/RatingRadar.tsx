import type { LeetifyProfile } from "@/lib/types";

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
// Map a Leetify impact value (~ -0.10..+0.10, 0 = average) onto 0..1, centre 0.5.
const impactNorm = (v: number) => clamp01(0.5 + (v / 0.1) * 0.5);
const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;

/**
 * RatingRadar plots a Leetify profile's five rating dimensions as a single
 * "skill profile" shape — a quick read on what kind of player this is. Aim /
 * positioning / utility are 0–100; clutch / opening are impact values shown
 * relative to average (centre = average). The exact numbers stay in the panel.
 */
export function RatingRadar({ rating: r }: { rating: LeetifyProfile["rating"] }) {
  const dims = [
    { label: "Aim", norm: clamp01(r.aim / 100), raw: r.aim.toFixed(0) },
    {
      label: "Position",
      norm: clamp01(r.positioning / 100),
      raw: r.positioning.toFixed(0),
    },
    { label: "Utility", norm: clamp01(r.utility / 100), raw: r.utility.toFixed(0) },
    { label: "Clutch", norm: impactNorm(r.clutch), raw: signed(r.clutch) },
    { label: "Opening", norm: impactNorm(r.opening), raw: signed(r.opening) },
  ];

  const cx = 120;
  const cy = 104;
  const R = 66;
  const n = dims.length;
  const pt = (i: number, frac: number): [number, number] => {
    const a = ((-90 + i * (360 / n)) * Math.PI) / 180;
    return [cx + Math.cos(a) * R * frac, cy + Math.sin(a) * R * frac];
  };
  const poly = (frac: number) =>
    dims.map((_, i) => pt(i, frac).map((v) => v.toFixed(1)).join(",")).join(" ");
  const dataPoly = dims
    .map((d, i) => pt(i, d.norm).map((v) => v.toFixed(1)).join(","))
    .join(" ");

  return (
    <div className="rounded-lg border border-line bg-panel/40 px-3 py-2">
      <div className="stat-label mb-1 text-center">Skill profile</div>
      <svg viewBox="0 0 240 200" className="mx-auto h-48 w-full max-w-[260px]">
        {/* grid rings */}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <polygon
            key={f}
            points={poly(f)}
            fill="none"
            stroke="var(--color-line)"
            strokeWidth="1"
            strokeOpacity={f === 0.5 ? 0.7 : 0.4}
          />
        ))}
        {/* axes */}
        {dims.map((d, i) => {
          const [x, y] = pt(i, 1);
          return (
            <line
              key={d.label}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke="var(--color-line)"
              strokeWidth="1"
              strokeOpacity="0.4"
            />
          );
        })}
        {/* data shape */}
        <polygon
          points={dataPoly}
          fill="var(--color-brand)"
          fillOpacity="0.18"
          stroke="var(--color-brand)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {dims.map((d, i) => {
          const [x, y] = pt(i, d.norm);
          return <circle key={d.label} cx={x} cy={y} r="2.5" fill="var(--color-brand)" />;
        })}
        {/* labels */}
        {dims.map((d, i) => {
          const [x, y] = pt(i, 1.2);
          const anchor = x < cx - 6 ? "end" : x > cx + 6 ? "start" : "middle";
          return (
            <text
              key={d.label}
              x={x}
              y={y}
              textAnchor={anchor}
              dominantBaseline="middle"
              className="fill-muted text-[10px]"
            >
              {d.label}{" "}
              <tspan className="fill-ink font-semibold">{d.raw}</tspan>
            </text>
          );
        })}
      </svg>
    </div>
  );
}
