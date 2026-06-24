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
      <Notice tone="error" title="Stats are temporarily unavailable">
        We&apos;re having trouble loading stats right now. Please try again in a
        few moments.
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
