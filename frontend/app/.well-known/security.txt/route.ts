// security.txt (RFC 9116) — tells researchers how to report a security issue
// with StatRun / steamcommunity.run. Served at /.well-known/security.txt.
// A route handler (not a public/ file) so it works under output: "standalone".
export const dynamic = "force-static";

const BODY = `# Security policy for StatRun (steamcommunity.run)
# https://www.rfc-editor.org/rfc/rfc9116

Contact: https://github.com/cotentcreation009-ui/cs2-tracker/issues
Expires: 2027-06-29T00:00:00.000Z
Preferred-Languages: en
Canonical: https://steamcommunity.run/.well-known/security.txt
`;

export function GET() {
  return new Response(BODY, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
