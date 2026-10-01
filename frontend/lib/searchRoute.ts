// Where the search box sends a free-text query. Extracted verbatim from
// SearchBar's submit handler so the one piece of shared behaviour that must
// not change — the header on every page routes through it too — is
// unit-tested instead of eyeballed:
//
//   a steamcommunity.com/id/<vanity> or /profiles/<id> URL → that page here
//   17 digits                                              → /profiles/<id>
//   anything else                                          → /id/<vanity>
//   blank                                                  → nowhere (null)
export function routeForQuery(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const url = v.match(/steamcommunity\.com\/(id|profiles)\/([^/?#]+)/i);
  if (url) return `/${url[1].toLowerCase()}/${url[2]}`;
  if (/^\d{17}$/.test(v)) return `/profiles/${v}`;
  return `/id/${encodeURIComponent(v)}`;
}
