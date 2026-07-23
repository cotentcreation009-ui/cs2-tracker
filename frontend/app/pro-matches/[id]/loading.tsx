// Instant skeleton while the match detail resolves server-side. Historical
// series are fetched on demand from GRID (1–2 upstream calls), so without this
// a click on an old result showed nothing for a couple of seconds.
export default function Loading() {
  const bar = "animate-pulse rounded bg-line/50";
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading match">
      <span className={`block h-4 w-28 ${bar}`} />
      <div className="card-2 space-y-6 p-7">
        <div className="flex items-center justify-between">
          <span className={`h-4 w-40 ${bar}`} />
          <span className={`h-5 w-14 ${bar}`} />
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-3">
            <span className={`h-14 w-14 ${bar}`} />
            <span className={`h-5 w-24 ${bar}`} />
          </span>
          <span className={`h-10 w-20 ${bar}`} />
          <span className="flex items-center gap-3">
            <span className={`h-5 w-24 ${bar}`} />
            <span className={`h-14 w-14 ${bar}`} />
          </span>
        </div>
      </div>
      <span className={`block h-40 w-full ${bar}`} />
      <span className={`block h-40 w-full ${bar}`} />
    </div>
  );
}
