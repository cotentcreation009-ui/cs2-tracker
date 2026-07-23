// Instant skeleton while the team page's server shell (metadata fetch)
// resolves, so clicking a team name gives immediate feedback.
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading team">
      <span className="block h-4 w-28 animate-pulse rounded bg-line/50" />
      <div className="card-2 h-36 animate-pulse bg-line/20" />
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="card h-64 animate-pulse bg-line/20" />
        <div className="card h-64 animate-pulse bg-line/20" />
      </div>
    </div>
  );
}
