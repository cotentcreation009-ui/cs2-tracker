import type {
  FaceitProfile,
  LeetifyProfile,
  PlayerCareer,
  SteamGameStats,
} from "@/lib/types";

type Vals = Record<string, number | null>;

/**
 * CrossSource reconciles the same metric across every data source we have —
 * the tracker's own parsed career, Leetify, FACEIT and official Steam lifetime
 * stats — side by side. Showing one player's HS%/win-rate/K-D from multiple
 * providers at once is something single-source competitors can't do.
 */
export function CrossSource({
  career,
  leetify,
  faceit,
  steamStats,
}: {
  career: PlayerCareer;
  leetify?: LeetifyProfile | null;
  faceit?: FaceitProfile | null;
  steamStats?: SteamGameStats | null;
}) {
  const hasNative = career.matches > 0;
  const st = steamStats?.stats;
  const sn = (k: string) => st?.[k] ?? 0;

  const cols: string[] = [];
  if (hasNative) cols.push("Tracker");
  if (leetify) cols.push("Leetify");
  if (faceit) cols.push("FACEIT");
  if (steamStats) cols.push("Steam");
  if (cols.length < 2) return null;

  const allRows: { label: string; vals: Vals; fmt: (v: number) => string }[] = [
    {
      label: "Headshot %",
      fmt: (v) => `${v.toFixed(0)}%`,
      vals: {
        Tracker: hasNative ? career.hsPct : null,
        Leetify: null, // Leetify's "HS accuracy" is a different metric
        FACEIT: faceit ? faceit.hsPct : null,
        Steam:
          steamStats && sn("total_kills")
            ? (sn("total_kills_headshot") / sn("total_kills")) * 100
            : null,
      },
    },
    {
      label: "Win rate",
      fmt: (v) => `${v.toFixed(0)}%`,
      vals: {
        Tracker: hasNative ? career.winRate : null,
        Leetify: leetify ? leetify.winrate * 100 : null,
        FACEIT: faceit ? faceit.winRatePct : null,
        Steam: null, // Steam exposes round wins, not match wins
      },
    },
    {
      label: "K/D",
      fmt: (v) => v.toFixed(2),
      vals: {
        Tracker: hasNative ? career.kd : null,
        Leetify: null,
        FACEIT: faceit ? faceit.kdRatio : null,
        Steam:
          steamStats && sn("total_deaths")
            ? sn("total_kills") / sn("total_deaths")
            : null,
      },
    },
    {
      label: "Matches",
      fmt: (v) => v.toLocaleString("en-US"),
      vals: {
        Tracker: hasNative ? career.matches : null,
        Leetify: leetify ? leetify.total_matches : null,
        FACEIT: faceit ? faceit.matches : null,
        Steam: null,
      },
    },
  ];

  const rows = allRows.filter(
    (r) => cols.filter((c) => r.vals[c] != null).length >= 2,
  );

  if (rows.length === 0) return null;

  const gridCols = `1fr ${cols.map(() => "1fr").join(" ")}`;

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
        Across sources
      </h2>
      <div className="card overflow-hidden">
        <div
          className="grid gap-2 border-b border-line px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-faint"
          style={{ gridTemplateColumns: gridCols }}
        >
          <span></span>
          {cols.map((c) => (
            <span key={c} className="text-right">
              {c}
            </span>
          ))}
        </div>
        <ul>
          {rows.map((r) => (
            <li
              key={r.label}
              className="grid items-center gap-2 border-t border-line/60 px-4 py-2 text-sm"
              style={{ gridTemplateColumns: gridCols }}
            >
              <span className="text-xs uppercase tracking-wider text-muted">
                {r.label}
              </span>
              {cols.map((c) => {
                const v = r.vals[c];
                return (
                  <span key={c} className="text-right tabular-nums">
                    {v == null ? (
                      <span className="text-faint">—</span>
                    ) : (
                      r.fmt(v)
                    )}
                  </span>
                );
              })}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
