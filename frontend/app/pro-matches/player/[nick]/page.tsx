import type { Metadata } from "next";
import { ProPlayerBridge } from "@/components/pro/ProPlayerBridge";

// Bridge from a pro player's card to their stats page here. The work happens
// in the browser — see ProPlayerBridge for why — so this is a thin shell.
export function generateMetadata(): Metadata {
  // A redirect hop with no content of its own — keep it out of the index.
  return { title: "Player — CSRun", robots: { index: false, follow: true } };
}

export default async function ProPlayerPage({
  params,
}: {
  params: Promise<{ nick: string }>;
}) {
  const { nick } = await params;
  return <ProPlayerBridge nick={decodeURIComponent(nick)} />;
}
