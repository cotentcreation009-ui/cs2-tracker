"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="card mx-auto mt-10 max-w-lg border-bad/40 px-6 py-10 text-center">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="mt-2 text-sm text-muted">
        An unexpected error occurred while rendering this page.
      </p>
      {error.digest && (
        <p className="mt-1 font-mono text-xs text-faint">ref: {error.digest}</p>
      )}
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-bg transition hover:opacity-90"
      >
        Try again
      </button>
    </div>
  );
}
