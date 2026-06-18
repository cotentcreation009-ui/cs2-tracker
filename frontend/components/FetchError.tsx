import { Notice } from "./Notice";

/** FetchError maps an ApiError status to a friendly explanation. */
export function FetchError({
  status,
  message,
}: {
  status: number;
  message: string;
}) {
  if (status === 0) {
    return (
      <Notice tone="error" title="Backend unreachable">
        The API server isn&apos;t responding. Start the backend (or
        <code className="mx-1 rounded bg-panel px-1.5 py-0.5 text-xs">
          docker compose up
        </code>
        ) and check <span className="font-mono">API_INTERNAL_URL</span>.
        <div className="mt-2 text-xs text-faint">{message}</div>
      </Notice>
    );
  }
  if (status === 404) {
    return <Notice title="Not found">{message}</Notice>;
  }
  return (
    <Notice tone="error" title={`Something went wrong (${status})`}>
      {message}
    </Notice>
  );
}
