import type { ParsedRow } from "@/lib/api";
import { tierColor, kdColor } from "@/lib/format";

// Stats CSRun computed itself, from demos it downloaded and parsed.
//
// This panel is deliberately separate from every Leetify-fed surface and says
// whose numbers these are in its own header. Two reasons, and both matter: a
// visitor deserves to know which company measured what, and these are the only
// numbers on the site nobody can take away — worth naming.
export function OurStatsPanel({ rows }: { rows: ParsedRow[] }) {
  if (!rows.length) return null;

  const sum = (pick: (r: ParsedRow) => number | undefined) =>
    rows.reduce((t, r) => t + (pick(r) ?? 0), 0);

  const kills = sum((r) => r.kills);
  const deaths = sum((r) => r.deaths);
  const hsKills = sum((r) => r.hsKills);
  const damage = sum((r) => r.damage);
  const rounds = sum((r) => r.rounds);
  const shots = sum((r) => r.shots);
  const hits = sum((r) => r.hits);
  const openK = sum((r) => r.openingKills);
  const openD = sum((r) => r.openingDeaths);

  // Averaged only over matches that carried the field — absent is not zero.
  const mean = (pick: (r: ParsedRow) => number | undefined) => {
    const vals = rows.map(pick).filter((v): v is number => !!v && v > 0);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  };
  const aim = mean((r) => r.aimRating);
  const preaim = mean((r) => r.preaim);

  const ratio = (n: number, d: number) => (d > 0 ? n / d : 0);
  const pct = (n: number, d: number) => 100 * ratio(n, d);

  const cells: { label: string; value: string; cls?: string; sub?: string }[] = [];
  if (aim > 0)
    cells.push({
      label: "Aim rating",
      value: aim.toFixed(0),
      cls: tierColor(aim, 60, 40),
      sub: "our 0–100 read",
    });
  if (shots > 0)
    cells.push({
      label: "Accuracy",
      value: `${pct(hits, shots).toFixed(1)}%`,
      cls: tierColor(pct(hits, shots), 22, 14),
      sub: "bullets that hit",
    });
  if (kills > 0)
    cells.push({
      label: "Headshot %",
      value: `${pct(hsKills, kills).toFixed(0)}%`,
      cls: tierColor(pct(hsKills, kills), 50, 35),
    });
  if (deaths > 0)
    cells.push({ label: "K/D", value: ratio(kills, deaths).toFixed(2), cls: kdColor(ratio(kills, deaths)) });
  if (rounds > 0)
    cells.push({
      label: "ADR",
      value: ratio(damage, rounds).toFixed(0),
      cls: tierColor(ratio(damage, rounds), 80, 65),
    });
  if (openK + openD > 0)
    cells.push({
      label: "Opening duels",
      value: `${pct(openK, openK + openD).toFixed(0)}%`,
      cls: tierColor(pct(openK, openK + openD), 55, 45),
      sub: `${openK}W ${openD}L`,
    });
  if (preaim > 0)
    cells.push({
      label: "Crosshair placement",
      value: `${preaim.toFixed(1)}°`,
      sub: "lower is tighter",
    });

  // The context no scoreboard carries — the reason parsing our own demos is
  // worth the trouble.
  const wall = sum((r) => r.wallbangs);
  const smoke = sum((r) => r.throughSmoke);
  const noscope = sum((r) => r.noScopes);
  const blind = sum((r) => r.blindKills);
  const snap = sum((r) => r.snapKills);

  return (
    <div className="space-y-4">
      <div>
        <div className="stat-label mb-1">CSRun stats · from demos we parsed</div>
        <p className="text-xs leading-relaxed text-muted">
          Computed by CSRun from{" "}
          <span className="font-semibold text-ink">{rows.length}</span> recent{" "}
          {rows.length === 1 ? "demo" : "demos"} downloaded from Valve — not
          from Leetify or any other site. These are our own measurements, and
          the aim rating is our own formula.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {cells.map((c) => (
          <div key={c.label} className="rounded-xl border border-line/50 bg-panel/40 px-3.5 py-2.5">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-faint">
              {c.label}
            </p>
            <p className={`mt-1 text-xl font-extrabold tabular-nums leading-tight ${c.cls ?? "text-ink"}`}>
              {c.value}
            </p>
            {c.sub ? <p className="mt-0.5 text-[10px] text-faint">{c.sub}</p> : null}
          </div>
        ))}
      </div>

      {wall + smoke + noscope + blind + snap > 0 && (
        <div>
          <div className="stat-label mb-1.5">Kill context</div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            {[
              ["Wallbangs", wall],
              ["Through smoke", smoke],
              ["No-scopes", noscope],
              ["While blind", blind],
              ["Snap kills", snap],
            ]
              .filter(([, n]) => (n as number) > 0)
              .map(([label, n]) => (
                <span
                  key={label as string}
                  className="rounded-lg border border-line/50 bg-panel/40 px-2.5 py-1"
                >
                  <span className="font-semibold tabular-nums text-ink">{n as number}</span>{" "}
                  <span className="text-faint">{label as string}</span>
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
