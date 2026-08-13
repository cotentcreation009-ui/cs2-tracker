import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/site";
import { ProBoard } from "@/components/pro/ProBoard";
import { ProSpotlight } from "@/components/pro/ProSpotlight";

// Server wrapper so the board gets its own title/description/canonical for SEO;
// the interactive, self-polling board itself lives in the ProBoard client
// component. If the backend has no GRID_API_KEY the feed returns enabled:false
// and the board renders a tasteful "coming soon" card — the page still indexes.
export const metadata: Metadata = {
  title: `Live CS2 Pro Matches — ${SITE_NAME}`,
  description:
    "Live and upcoming Counter-Strike 2 pro matches: real-time series scores, live round counts, round-by-round breakdowns, tournaments and stream links — auto-updating.",
  alternates: { canonical: "/pro-matches" },
  openGraph: {
    title: `Live CS2 Pro Matches — ${SITE_NAME}`,
    description:
      "Real-time CS2 pro match scores: live series & round counts, round-by-round breakdowns and stream links.",
    url: "/pro-matches",
    type: "website",
  },
};

export default function ProMatchesPage() {
  return (
    <div className="space-y-10">
      <ProBoard />
      {/* Below the board on purpose: live scores are why people open this page,
          and the rails are for browsing once you have looked at them. */}
      <ProSpotlight />
    </div>
  );
}
