import type {
  FaceitProfile,
  LeetifyProfile,
  Player,
  SteamExtras,
  SteamGameStats,
} from "@/lib/types";
import {
  BAND_HEX,
  BAND_LABEL,
  BAND_TEXT,
  RISK_LABEL,
  computeSuspicion,
  type Band,
  type MetricCard,
  type SusFactor,
  type Suspicion,
} from "@/lib/suspicion";
import { flag, fmt } from "@/lib/format";
import Link from "next/link";
import { ShareButton } from "@/components/ShareButton";
import { RatingRing } from "@/components/RatingRing";
import { PremierRank, type PremierPoint } from "@/components/PremierRank";
import { FaceitRank } from "@/components/FaceitRank";

const PERSONA: Record<number, string> = { 1: "Online", 2: "Busy", 3: "Away", 4: "Snooze", 5: "Online", 6: "Online" };

// --- tiny icon set (stroke glyphs) ------------------------------------------
function Icon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  const p: Record<string, React.ReactNode> = {
    bolt: <path d="M13 2 4 14h6l-1 8 9-12h-6z" />,
    target: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    cross: (
      <>
        <circle cx="12" cy="12" r="7" />
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      </>
    ),
    swap: <path d="M4 8h13l-3-3M20 16H7l3 3" />,
    chart: <path d="M4 20V10M10 20V4M16 20v-7M20 20H3" />,
    flask: <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" />,
    flame: <path d="M12 3c1 4 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 .5 2 2 2 3 1-1-2-1-4 0-6z" />,
    shield: <path d="M12 3 5 6v5c0 4 3 7 7 8 4-1 7-4 7-8V6z" />,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {p[name] ?? p.target}
    </svg>
  );
}

const factorTag = (f: SusFactor): string => {
  if (f.key === "bans") return f.score > 0 ? "Flagged" : "Clean";
  return f.band === "verylow" ? "Normal" : BAND_LABEL[f.band];
};

// --- semicircular gauge -----------------------------------------------------
function Gauge({ score, hex }: { score: number; hex: string }) {
  const cx = 130;
  const cy = 132;
  const r = 104;
  const pol = (t: number, rad: number): [number, number] => {
    const a = (180 * (1 - t / 100) * Math.PI) / 180;
    return [cx + rad * Math.cos(a), cy - rad * Math.sin(a)];
  };
  const [nx, ny] = pol(score, r - 16);
  const ticks = [0, 25, 50, 75, 100];
  return (
    <svg viewBox="0 0 260 165" className="mt-1 w-full max-w-[300px]">
      <defs>
        <linearGradient id="cm-arc" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#46d369" />
          <stop offset="40%" stopColor="#f5b942" />
          <stop offset="68%" stopColor="#ff8a3d" />
          <stop offset="100%" stopColor="#f5694a" />
        </linearGradient>
      </defs>
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="url(#cm-arc)"
        strokeWidth="16"
        strokeLinecap="round"
      />
      {ticks.map((t) => {
        const [lx, ly] = pol(t, r + 16);
        const anchor = t < 45 ? "start" : t > 55 ? "end" : "middle";
        return (
          <text
            key={t}
            x={lx}
            y={ly}
            textAnchor={anchor}
            className="fill-faint text-[10px]"
          >
            {t}%
          </text>
        );
      })}
      <text
        x={cx}
        y={cy - 22}
        textAnchor="middle"
        className="fill-muted"
        style={{ fontSize: 38, opacity: 0.12 }}
      >
        ☠
      </text>
      <line
        x1={cx}
        y1={cy}
        x2={nx}
        y2={ny}
        stroke={hex}
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r="8" fill={hex} />
      <circle cx={cx} cy={cy} r="3.5" fill="var(--color-bg)" />
    </svg>
  );
}

const BANDS: { b: Band; r: string }[] = [
  { b: "verylow", r: "0–20%" },
  { b: "low", r: "20–40%" },
  { b: "moderate", r: "40–60%" },
  { b: "high", r: "60–80%" },
  { b: "veryhigh", r: "80–100%" },
];

function BandLegend({ band }: { band: Band }) {
  return (
    <div className="mt-1.5 grid grid-cols-5 gap-1">
      {BANDS.map((x) => {
        const on = x.b === band;
        return (
          <div
            key={x.b}
            className="rounded-md border px-1 py-1 text-center"
            style={
              on
                ? { borderColor: BAND_HEX[band], background: `${BAND_HEX[band]}1f` }
                : { borderColor: "var(--color-line)" }
            }
          >
            <div
              className="text-[9px] font-bold uppercase leading-tight"
              style={{ color: on ? BAND_HEX[band] : "var(--color-faint)" }}
            >
              {BAND_LABEL[x.b]}
            </div>
            <div className="text-[9px] text-faint">{x.r}</div>
          </div>
        );
      })}
    </div>
  );
}

// --- metric scale card ------------------------------------------------------
function ScaleCard({ m }: { m: MetricCard }) {
  const hex = BAND_HEX[m.band];
  return (
    <div className="card px-3 py-2.5">
      <div className="flex items-center gap-1.5 stat-label">
        <Icon name={m.icon} className="h-3.5 w-3.5" />
        {m.label}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-xl font-bold tabular-nums" style={{ color: hex }}>
          {m.value}
        </span>
        <span
          className="rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase"
          style={{ background: `${hex}26`, color: hex }}
        >
          {BAND_LABEL[m.band]}
        </span>
      </div>
      <div className="mt-2">
        <div
          className="relative h-1.5 rounded-full"
          style={{
            background:
              "linear-gradient(90deg, rgba(70,211,105,.55), rgba(245,185,66,.55), rgba(245,105,74,.6))",
          }}
        >
          <span
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
            style={{ left: `${m.marker}%`, background: hex, borderColor: "var(--color-bg)" }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-faint">
          <span>
            {m.loVal} {m.loLabel}
          </span>
          <span>
            {m.hiVal} {m.hiLabel}
          </span>
        </div>
      </div>
      <div className="mt-1.5 text-[11px] text-muted">{m.note}</div>
    </div>
  );
}

// --- match-history donut ----------------------------------------------------
function Donut({
  wins,
  losses,
  draws,
  total,
}: {
  wins: number;
  losses: number;
  draws: number;
  total: number;
}) {
  const R = 54;
  const C = 2 * Math.PI * R;
  const cx = 70;
  const cy = 70;
  const segs = [
    { v: wins, c: "#46d369" },
    { v: losses, c: "#f5694a" },
    { v: draws, c: "#f5b942" },
  ];
  let acc = 0;
  return (
    <svg viewBox="0 0 140 140" className="h-32 w-32 shrink-0">
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--color-line)" strokeWidth="13" />
      {segs.map((s, i) => {
        const frac = total ? s.v / total : 0;
        const len = frac * C;
        const el = (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={R}
            fill="none"
            stroke={s.c}
            strokeWidth="13"
            strokeDasharray={`${len} ${C - len}`}
            strokeDashoffset={-acc}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        );
        acc += len;
        return el;
      })}
      <text x={cx} y={cy - 1} textAnchor="middle" className="fill-ink" style={{ fontSize: 26, fontWeight: 800 }}>
        {total}
      </text>
      <text x={cx} y={cy + 15} textAnchor="middle" className="fill-faint" style={{ fontSize: 9, letterSpacing: 1 }}>
        MATCHES
      </text>
    </svg>
  );
}

// --- consistency multi-line (each series normalised to its own range) -------
function MultiLine({
  series,
}: {
  series: { label: string; color: string; values: number[] }[];
}) {
  const w = 320;
  const h = 96;
  const pad = 5;
  const line = (values: number[]) => {
    if (values.length < 2) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    return values
      .map((v, i) => {
        const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
        const y = h - pad - ((v - min) / range) * (h - 2 * pad);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  };
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full">
      {series.map((s) => (
        <path
          key={s.label}
          d={line(s.values)}
          fill="none"
          stroke={s.color}
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

const VERDICT_TITLE: Record<Band, string> = {
  verylow: "Looks legit",
  low: "Likely legit",
  moderate: "Some flags",
  high: "Suspicious",
  veryhigh: "Highly suspicious",
};

/**
 * CheatMeter rolls every cheating-associated signal we can derive from public
 * stats into one dashboard — gauge, factor breakdown, per-metric scales,
 * cross-queue performance, recent W/L and a confidence read. It is explicitly a
 * "look closer" anomaly score, NOT proof; elite legit players score high too.
 */
export function CheatMeter({
  player,
  leetify,
  faceit,
  steamStats,
  steamExtras,
  rating,
  generatedOn,
}: {
  player: Player;
  leetify?: LeetifyProfile | null;
  faceit?: FaceitProfile | null;
  steamStats?: SteamGameStats | null;
  steamExtras?: SteamExtras | null;
  rating?: number | null;
  generatedOn?: string;
}) {
  const sus: Suspicion | null = computeSuspicion(leetify, faceit, steamStats, steamExtras);
  if (!sus || !sus.hasEnough) return null;

  // identity + ranks for the hero (everything visible in the CheatMeter view)
  const steamCreated = player.steamCreatedAt ? new Date(player.steamCreatedAt) : null;
  const ageY =
    steamCreated && !Number.isNaN(steamCreated.getTime())
      ? (Date.now() - steamCreated.getTime()) / (365.25 * 24 * 3600 * 1000)
      : null;
  const premier = leetify?.ranks?.premier ?? 0;
  const premierHistory: PremierPoint[] = (leetify?.recent_matches ?? [])
    .filter((m) => m.rank_type === 11 && (m.rank ?? 0) > 0)
    .map((m) => ({ rating: m.rank as number, date: m.finished_at }));
  const faceitLevel = faceit?.skillLevel || leetify?.ranks?.faceit || 0;
  const wingman = leetify?.ranks?.wingman ?? 0;
  const {
    score,
    band,
    subtitle,
    verdict,
    confidence,
    lowConfidence,
    factors,
    metrics,
    summary,
    scope,
    trend,
  } = sus;
  const hex = BAND_HEX[band];
  const pct = (v: number) => (summary.total ? (v / summary.total) * 100 : 0);

  return (
    <section className="card-2 px-5 py-4">
      {/* top row: title (left) · player name over the meter (center) · actions (right) */}
      <div className="mb-4 grid grid-cols-1 items-center gap-2 border-b border-line/60 pb-4 lg:grid-cols-[1fr_auto_1fr]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-bad/15 text-bad">
            <Icon name="shield" className="h-4 w-4" />
          </span>
          <h2 className="text-lg font-extrabold tracking-tight">CheatMeter</h2>
          <span className="pill bg-brand/15 text-brand">BETA</span>
          {lowConfidence && (
            <span
              className="pill bg-mid/15 text-mid"
              title={`Confidence ${confidence}/100 — thin data, so the risk band is capped and hedged`}
            >
              Low confidence
            </span>
          )}
        </div>
        {/* center: player name + avatar, on the top row, over the meter below */}
        <div className="flex min-w-0 items-center justify-center gap-2.5">
          <div className="shrink-0 rounded-xl bg-linear-to-br from-brand to-brand2 p-[2px]">
            {player.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={player.avatarUrl} alt={player.personaName} className="h-10 w-10 rounded-[10px] object-cover" />
            ) : (
              <div className="grid h-10 w-10 place-items-center rounded-[10px] bg-panel text-base font-bold text-faint">
                {(player.personaName || "?").slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>
          <span className="truncate text-2xl font-extrabold leading-tight">
            {player.personaName || player.steamId64}
          </span>
        </div>
        <div className="flex items-center gap-2 lg:justify-end">
          <ShareButton label="Share" />
          <Link
            href={`/compare?a=${player.steamId64}`}
            className="inline-flex shrink-0 items-center rounded-lg border border-line bg-panel2 px-3 py-1.5 text-sm font-medium text-ink transition hover:border-brand/60"
          >
            Compare
          </Link>
        </div>
      </div>

      {/* ranks — Premier (click for rating history) · FACEIT · Wingman */}
      {(premier > 0 || faceitLevel > 0 || wingman > 0) && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {premier > 0 && <PremierRank premier={premier} history={premierHistory} />}
          <FaceitRank
            faceit={faceit}
            levelFallback={leetify?.ranks?.faceit ?? 0}
            eloFallback={leetify?.ranks?.faceit_elo ?? 0}
          />
          {wingman > 0 && (
            <div className="flex items-center gap-2.5 rounded-xl border border-line bg-panel px-3.5 py-2" title="Wingman rank">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-panel2 text-sm font-black text-muted">W</span>
              <div>
                <div className="stat-label">Wingman</div>
                <div className="text-base font-bold tabular-nums text-ink">#{wingman}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* steam profile (left) · name + meter (centered) · factors (right) */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)_minmax(0,300px)] lg:items-start">
        {/* left: steam profile + analysis scope */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="stat-label">Steam profile</div>
            <div className="flex flex-wrap gap-1.5">
              {steamExtras?.personaState != null && steamExtras.personaState > 0 && (
                <span className="pill bg-good/15 text-good">
                  <span className="h-1.5 w-1.5 rounded-full bg-good" />
                  {PERSONA[steamExtras.personaState] || "Online"}
                </span>
              )}
              {steamExtras?.visibility === 1 && <span className="pill bg-mid/15 text-mid">Private</span>}
              {player.countryCode && (
                <span className="pill bg-panel text-muted">
                  {flag(player.countryCode)} {player.countryCode}
                </span>
              )}
              {ageY != null && (
                <span className="pill bg-panel text-muted" title={`Steam account created ${steamCreated?.toLocaleDateString()}`}>
                  {ageY.toFixed(1)}y on Steam
                </span>
              )}
              {steamExtras != null && steamExtras.steamLevel > 0 && (
                <span className="pill bg-panel text-muted">Steam lvl {steamExtras.steamLevel}</span>
              )}
              {steamExtras != null && steamExtras.friends > 0 && (
                <span className="pill bg-panel text-muted">{steamExtras.friends.toLocaleString("en-US")} friends</span>
              )}
              {steamExtras?.friendCode && <span className="pill bg-panel font-mono text-muted">{steamExtras.friendCode}</span>}
              {player.profileUrl && (
                <a href={player.profileUrl} target="_blank" rel="noreferrer" className="pill bg-panel text-muted transition hover:text-ink">
                  Steam ↗
                </a>
              )}
            </div>
            <div className="font-mono text-[11px] text-faint">{player.steamId64}</div>
          </div>
          {rating != null && <RatingRing rating={rating} />}
          <div className="rounded-xl border border-line bg-panel/40 p-3">
            <div className="stat-label">Analysis scope</div>
            <div className="mt-1 text-sm text-ink">
              {scope.hours != null && (
                <span className="font-semibold tabular-nums">{fmt(Math.round(scope.hours))}h</span>
              )}
              {scope.hours != null && <span className="text-faint"> playtime · </span>}
              <span className="font-semibold tabular-nums">{fmt(scope.matches)}</span>
              <span className="text-faint"> matches</span>
            </div>
          </div>
          {generatedOn && (
            <div className="rounded-xl border border-line bg-panel/40 p-3 text-[11px] text-faint">
              Generated {generatedOn}
            </div>
          )}
        </div>

        {/* center: the meter */}
        <div className="flex flex-col items-center text-center">
          <div className="stat-label">Cheating likelihood</div>
          <div className={`text-6xl font-extrabold leading-none tabular-nums ${BAND_TEXT[band]}`}>
            {score.toFixed(0)}%
          </div>
          <div className={`mt-0.5 text-base font-bold uppercase ${BAND_TEXT[band]}`}>{RISK_LABEL[band]}</div>
          <div className="text-xs text-muted">{subtitle}</div>
          <Gauge score={score} hex={hex} />
          <div className="w-full max-w-[300px]">
            <BandLegend band={band} />
          </div>
          <p className="mt-2 max-w-[320px] text-[10px] leading-snug text-faint">
            Statistical anomaly from public stats — a &quot;look closer&quot; signal, not proof.
            Skilled legit players score high too.
          </p>
        </div>

        {/* factors — single stacked column on the right */}
        <div>
          <div className="stat-label mb-1.5">Factors analyzed <span className="font-normal normal-case text-faint">· biggest drivers first</span></div>
          <ul className="space-y-1.5">
            {[...factors]
              .sort((a, b) => b.score - a.score || Number(!!b.primary) - Number(!!a.primary))
              .map((f) => (
              <li
                key={f.key}
                className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 ${
                  f.primary ? "border border-brand/30 bg-brand/5" : "bg-panel/40"
                }`}
              >
                <span
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-panel2"
                  style={{ color: BAND_HEX[f.band] }}
                >
                  <Icon name={f.icon} className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium leading-tight">{f.label}</div>
                  <div className="truncate text-[11px] text-faint">{f.detail}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-bold tabular-nums">{f.display}</div>
                  <div
                    className="text-[10px] font-bold uppercase"
                    style={{ color: BAND_HEX[f.band] }}
                  >
                    {factorTag(f)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* metric scale cards */}
      {metrics.length > 0 && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {metrics.map((m) => (
            <ScaleCard key={m.key} m={m} />
          ))}
        </div>
      )}

      {/* consistency · history · verdict */}
      <div
        className={`mt-3 grid gap-3 ${
          summary.total > 0 ? "lg:grid-cols-[1.25fr_1fr_1fr]" : ""
        }`}
      >
        {summary.total > 0 && (
          <>
        <div className="card px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="stat-label">
              Performance consistency
              <span className="text-faint"> · last {summary.total}</span>
            </div>
            <div className="flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1 text-brand2">
                <span className="h-0.5 w-3 rounded bg-brand2" />
                Rating
              </span>
              <span className="flex items-center gap-1 text-mid">
                <span className="h-0.5 w-3 rounded bg-mid" />
                {trend.secondaryLabel}
              </span>
            </div>
          </div>
          <MultiLine
            series={[
              { label: "Rating", color: "var(--color-brand2)", values: trend.rating },
              { label: trend.secondaryLabel, color: "var(--color-mid)", values: trend.secondary },
            ]}
          />
        </div>

        <div className="card flex items-center gap-3 px-4 py-3">
          <Donut
            wins={summary.wins}
            losses={summary.losses}
            draws={summary.draws}
            total={summary.total}
          />
          <div className="min-w-0 space-y-1.5 text-sm">
            <div className="stat-label">Match history</div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-good">
                <span className="h-2 w-2 rounded-full bg-good" />
                Wins
              </span>
              <span className="tabular-nums">
                {summary.wins} ({pct(summary.wins).toFixed(0)}%)
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-bad">
                <span className="h-2 w-2 rounded-full bg-bad" />
                Losses
              </span>
              <span className="tabular-nums">
                {summary.losses} ({pct(summary.losses).toFixed(0)}%)
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-mid">
                <span className="h-2 w-2 rounded-full bg-mid" />
                Draws
              </span>
              <span className="tabular-nums">
                {summary.draws} ({pct(summary.draws).toFixed(0)}%)
              </span>
            </div>
          </div>
        </div>
          </>
        )}

        <div className="card px-4 py-3">
          <div className="stat-label mb-1">Overall verdict</div>
          <div className="flex items-start gap-2">
            <span style={{ color: hex }} className="mt-0.5 text-xl leading-none">
              ⚠
            </span>
            <div>
              <div className="text-base font-extrabold" style={{ color: hex }}>
                {VERDICT_TITLE[band]}
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{verdict}</p>
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-center justify-between text-[11px]">
              <span className="stat-label">Confidence</span>
              <span className="font-bold tabular-nums">{confidence.toFixed(0)}%</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-panel">
              <div
                className="h-full rounded-full bg-linear-to-r from-brand to-brand2"
                style={{ width: `${confidence}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-1 border-t border-line pt-3 text-[11px] leading-relaxed text-faint sm:flex-row sm:items-center sm:justify-between">
        <span>
          CheatMeter compares public stats against typical player patterns to
          estimate anomaly.{" "}
          <span className="text-muted">
            Not a ban and not definitive proof
          </span>{" "}
          — playstyle, role and sample size all matter. Elite legit players score
          high too.
        </span>
        {generatedOn && (
          <span className="shrink-0">Generated {generatedOn}</span>
        )}
      </div>
    </section>
  );
}
