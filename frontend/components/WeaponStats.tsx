import type { WeaponStat } from "@/lib/types";
import { tierColor } from "@/lib/format";

export function WeaponStats({ weapons }: { weapons: WeaponStat[] }) {
  if (weapons.length === 0) return null;
  const max = Math.max(...weapons.map((w) => w.kills), 1);

  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-[1.6fr_0.6fr_0.6fr] gap-2 border-b border-line px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-faint">
        <span>Weapon</span>
        <span className="text-right">Kills</span>
        <span className="text-right">HS%</span>
      </div>
      <ul>
        {weapons.map((w) => (
          <li
            key={w.weapon}
            className="grid grid-cols-[1.6fr_0.6fr_0.6fr] items-center gap-2 px-4 py-2.5"
          >
            <div className="min-w-0">
              <div className="mb-1 truncate text-sm font-medium">{w.weapon}</div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel2">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand to-brand2"
                  style={{ width: `${(w.kills / max) * 100}%` }}
                />
              </div>
            </div>
            <div className="text-right text-sm font-semibold tabular-nums">
              {w.kills}
            </div>
            <div
              className={`text-right text-sm tabular-nums ${tierColor(w.hsPct, 50, 35)}`}
            >
              {w.hsPct.toFixed(0)}%
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
