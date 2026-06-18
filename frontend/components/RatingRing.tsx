import { ratingColor } from "@/lib/format";

/**
 * RatingRing renders an HLTV-style rating inside a progress arc. The arc fills
 * proportionally to the rating, capped at 2.0 so elite and average players are
 * visually distinguishable.
 */
export function RatingRing({
  rating,
  size = 132,
}: {
  rating: number;
  size?: number;
}) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(rating / 2, 1));
  const colorClass = ratingColor(rating);

  return (
    <div
      className="relative grid place-items-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className={colorClass}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={`text-3xl font-bold tabular-nums ${colorClass}`}>
          {rating.toFixed(2)}
        </span>
        <span className="stat-label mt-0.5">Rating</span>
      </div>
    </div>
  );
}
