import type { Metadata } from "next";
import type { ReactNode } from "react";

// The call-out zone editor is a local authoring tool (state lives in the
// visitor's browser) with no public content — noindex, but keep links followed.
export const metadata: Metadata = {
  title: "Zone editor — StatRun",
  robots: { index: false, follow: true },
};

export default function ZonesLayout({ children }: { children: ReactNode }) {
  return children;
}
