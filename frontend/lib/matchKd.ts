/**
 * The K and D a match row should show. The profile feed only carries kills and
 * deaths for the most recent games; older rows arrive with neither. Once the
 * row's per-game stats have loaded (they do when it is expanded) those carry
 * the real numbers, so they fill the gap. null = nothing known either way.
 */
export function rowKD(
  row: { kills?: number; deaths?: number },
  deep?: { kills?: number; deaths?: number } | null,
): { kills: number; deaths: number } | null {
  const k = row.kills ?? 0;
  const d = row.deaths ?? 0;
  if (k + d > 0) return { kills: k, deaths: d };
  const dk = deep?.kills ?? 0;
  const dd = deep?.deaths ?? 0;
  if (dk + dd > 0) return { kills: dk, deaths: dd };
  return null;
}
