// Pulsing "LIVE" badge. The ping ring is disabled under prefers-reduced-motion
// (motion-reduce:hidden) while the solid dot + label stay, so the state is still
// legible without motion.
export function LiveBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-[#ff4655]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#ff6b76] ${className}`}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#ff4655] opacity-75 motion-reduce:hidden" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#ff4655]" />
      </span>
      Live
    </span>
  );
}
