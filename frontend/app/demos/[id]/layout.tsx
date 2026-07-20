import type { Metadata } from "next";
import type { ReactNode } from "react";

// A parsed demo lives only in THIS visitor's browser (IndexedDB) — the URL is
// meaningless to anyone else and renders no public content. Keep it out of the
// index so Google doesn't burn crawl budget on it or log it as
// "Crawled – currently not indexed". Links are still followed.
export const metadata: Metadata = {
  title: "Demo analysis — StatRun",
  robots: { index: false, follow: true },
};

export default function DemoViewerLayout({ children }: { children: ReactNode }) {
  return children;
}
