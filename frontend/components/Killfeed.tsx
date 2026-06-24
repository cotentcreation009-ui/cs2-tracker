import type { Kill } from "@/lib/types";

/**
 * Killfeed renders the stored kill events grouped by round. Names are resolved
 * from the match scoreboard via nameOf (kills carry only SteamID64s).
 */
export function Killfeed({
  kills,
  nameOf,
}: {
  kills: Kill[];
  nameOf: (id: string) => string;
}) {
  if (kills.length === 0) return null;

  const byRound = new Map<number, Kill[]>();
  for (const k of kills) {
    const arr = byRound.get(k.round) ?? [];
    arr.push(k);
    byRound.set(k.round, arr);
  }
  const rounds = [...byRound.keys()].sort((a, b) => a - b);

  return (
    <div className="card px-4 py-3">
      <div className="stat-label mb-3">Killfeed</div>
      <div className="scroll-slim max-h-[520px] space-y-4 overflow-y-auto pr-1">
        {rounds.map((r) => (
          <div key={r}>
            <div className="mb-1 text-xs font-semibold text-faint">
              Round {r}
            </div>
            <ul className="space-y-1">
              {byRound.get(r)!.map((k, i) => (
                <li
                  key={i}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <span className="font-medium text-ink">
                    {nameOf(k.killerId)}
                  </span>
                  <span className="rounded bg-panel2 px-1.5 py-0.5 text-xs text-muted">
                    {k.weapon}
                    {k.headshot && <span className="ml-1 text-bad">HS</span>}
                  </span>
                  <span className="text-muted">{nameOf(k.victimId)}</span>
                  {k.assisterId && k.assisterId !== "0" && (
                    <span className="text-xs text-faint">
                      + {nameOf(k.assisterId)}
                    </span>
                  )}
                  {k.opening && (
                    <span className="pill bg-brand/15 text-brand">opening</span>
                  )}
                  {k.trade && (
                    <span className="pill bg-mid/15 text-mid">trade</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
