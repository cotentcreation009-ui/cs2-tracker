import { ADSENSE_CLIENT } from "@/lib/site";

// ads.txt authorizes Google to sell ad inventory for this domain. Required for
// AdSense ads to serve (and to clear the "ads.txt not found" warning). The pub
// number is the ca-pub id with the "ca-" prefix dropped.
export const dynamic = "force-static";

export function GET() {
  const pub = ADSENSE_CLIENT.replace(/^ca-/, "");
  const body = `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`;
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
