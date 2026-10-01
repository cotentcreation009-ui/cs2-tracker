import type { ReactNode } from "react";

// The one heading pattern for the homepage's sections: an uppercase eyebrow,
// an optional subline that says what the data below actually is, and an
// optional action on the right (a link, a Clear button). Plain presentational
// — no "use client", no server-only imports — so the server-rendered page and
// the client-side strips render the same heading.
export function SectionHeading({
  eyebrow,
  subline,
  action,
  id,
}: {
  eyebrow: string;
  subline?: ReactNode;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <h2
          id={id}
          className="text-sm font-semibold uppercase tracking-wider text-muted"
        >
          {eyebrow}
        </h2>
        {subline && <p className="mt-0.5 text-xs text-faint">{subline}</p>}
      </div>
      {action}
    </div>
  );
}
