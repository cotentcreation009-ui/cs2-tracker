import type { ReactNode } from "react";

/** Notice renders a friendly, centred message panel for empty / error states. */
export function Notice({
  title,
  children,
  tone = "info",
}: {
  title: string;
  children?: ReactNode;
  tone?: "info" | "error";
}) {
  const ring = tone === "error" ? "border-bad/40" : "border-line";
  return (
    <div
      className={`card mx-auto mt-10 max-w-lg border ${ring} px-6 py-10 text-center`}
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && (
        <div className="mt-2 text-sm leading-relaxed text-muted">{children}</div>
      )}
    </div>
  );
}
