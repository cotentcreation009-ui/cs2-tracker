// StatRun brand logo. The mark is three ascending bars (stats) on the brand
// gradient; the wordmark sets "Run" in the gradient. Pure SVG/CSS = crisp at any
// size, no image asset needed.

export function BrandMark({
  size = 30,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      role="img"
      aria-label="StatRun"
    >
      <defs>
        <linearGradient
          id="statrun-grad"
          x1="0"
          y1="0"
          x2="32"
          y2="32"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#38d6ff" />
          <stop offset="1" stopColor="#8a7dff" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8.5" fill="url(#statrun-grad)" />
      <g fill="#07131b">
        <rect x="8" y="18" width="3.6" height="7" rx="1.3" />
        <rect x="14.2" y="13" width="3.6" height="12" rx="1.3" />
        <rect x="20.4" y="8" width="3.6" height="17" rx="1.3" />
      </g>
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <span className="grid place-items-center rounded-[9px] shadow-[0_0_18px_-5px_rgba(56,214,255,0.7)]">
        <BrandMark size={30} />
      </span>
      <span className="text-lg font-extrabold tracking-tight">
        Stat<span className="gradient-text">Run</span>
      </span>
    </span>
  );
}
