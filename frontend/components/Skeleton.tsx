export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-panel2 ${className}`} />;
}

/** Placeholder shown while a profile page streams in. */
export function ProfileSkeleton() {
  return (
    <div className="space-y-5">
      <div className="card-2 flex items-center gap-4 px-5 py-5">
        <Skeleton className="h-20 w-20" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Skeleton className="h-72 lg:col-span-2" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}

/** Placeholder shown while a match page streams in. */
export function MatchSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-24 w-full" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}
