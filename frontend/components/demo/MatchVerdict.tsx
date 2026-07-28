"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import { computeInsights, type PlayerInsight } from "@/lib/demo/insights";
import { demoCheat, BAND_HEX, BAND_LABEL, type DemoCheat } from "@/lib/demo/cheat";
import { computeTendencies, playstyleSummary } from "@/lib/demo/tendencies";
import { cheatMoments, hasAimData, type CheatMoment } from "@/lib/demo/evidence";
import { aimConsistency, type SeriesPoint, type StepChange } from "@/lib/demo/consistency";
import {
  aggregateTeamRotates,
  analyzeRotations,
  TRIGGER_LABEL,
  type PlayerRotates,
  type RotateEvent,
  type TeamRotates,
  type TriggerKind,
} from "@/lib/demo/rotates";
import { AccountCheck } from "@/components/demo/AccountCheck";
import { opponentHistory, type OpponentSighting } from "@/lib/demo/opponents";
import { mapLabel } from "@/lib/format";
import { cachedAccountScores, fetchAccountScores, getAiRead, setAiRead } from "@/lib/demo/accountStore";
import type { DemoView } from "@/components/demo/MatchToolbar";
import { buildProjection, type Projection } from "@/lib/demo/projection";
import { hasCalibration, radarImage } from "@/lib/maps/calibration";

const CT = "#5b9dff";
const T = "#e7b53c";
const teamHex = (t: PlayerInsight["team"]) => (t === "T" ? T : t === "CT" ? CT : "var(--color-faint)");
const mmss = (t: number) => {
  const s = Math.max(0, Math.floor(t)); // floor (not round) so 59.6s can't render ":60"
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// A player is "flag-worthy" (drives the lobby count) when the aim-anomaly read
// is at least moderate AND backed by real data.
const FLAG_SCORE = 40;
const isFlagged = (c: DemoCheat) => c.score >= FLAG_SCORE && c.confidence >= 0.5;

const FACTOR_HINT: Record<string, string> = {
  snap: "Landed a kill almost instantly despite the crosshair being far off target — a superhuman correction. The strongest tell, and it doesn't punish good angle-holding.",
  acc: "Share of fired bullets that hit — volume-independent gun accuracy.",
  rot: "Cross-map rotations begun AFTER the enemy team committed elsewhere but BEFORE any information pointed at the destination — no kills, enemy utility, bomb action, or audible contact on that side of the map. Legit hunches split evenly right/wrong and timer reads are slow; fast, consistently-correct blind rotates read like a radar. ✓ correct · ✗ wrong (subtracts).",
  hsacc: "Share of fired bullets that hit the head.",
  react: "Time from an enemy first becoming visible to the kill. Only very low (trigger-like) reads flag.",
  hs: "Headshot percentage of kills. Strong players run high too, so it's a weak corroborator.",
};

const VERDICT_UI: Record<RotateEvent["verdict"], { label: string; cls: string; hex: string }> = {
  "blind-correct": { label: "before any info — correct", cls: "bg-bad/15 text-bad", hex: "#ff5c5c" },
  "blind-wrong": { label: "blind guess — wrong", cls: "bg-good/15 text-good", hex: "#46d369" },
  hunch: { label: "blind hunch", cls: "bg-panel text-muted", hex: "#e7b53c" },
  informed: { label: "after info — normal", cls: "bg-panel text-faint", hex: "#7f8ea3" },
};
const VERDICT_ORDER: Record<RotateEvent["verdict"], number> = {
  "blind-correct": 0,
  "blind-wrong": 1,
  hunch: 2,
  informed: 3,
};

// trigger-kind hues (identity also carried by the icon + tooltip, never color alone)
const KIND_HEX: Record<TriggerKind, string> = {
  utility: "#38d6ff",
  fight: "#e7b53c",
  contact: "#8a7dff",
  bomb: "#ff7a5c",
};

// tiny glyphs so trigger kinds read at a glance instead of as sentences
function KindIcon({ kind, className = "h-3 w-3" }: { kind: TriggerKind; className?: string }) {
  switch (kind) {
    case "utility": // grenade
      return (
        <svg viewBox="0 0 12 12" className={className} fill="currentColor" aria-hidden>
          <circle cx="6" cy="7.2" r="3.4" />
          <rect x="4.9" y="1" width="2.2" height="2.6" rx="0.6" />
        </svg>
      );
    case "fight": // crosshair
      return (
        <svg viewBox="0 0 12 12" className={className} fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
          <circle cx="6" cy="6" r="2.9" />
          <path d="M6 0.6v2.2M6 9.2v2.2M0.6 6h2.2M9.2 6h2.2" />
        </svg>
      );
    case "contact": // sound waves
      return (
        <svg viewBox="0 0 12 12" className={className} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
          <path d="M2.6 4.6a4.6 4.6 0 0 1 0 2.8" />
          <path d="M5.4 3a8 8 0 0 1 0 6" />
          <path d="M8.2 1.5a11.4 11.4 0 0 1 0 9" />
        </svg>
      );
    case "bomb": // planted C4
      return (
        <svg viewBox="0 0 12 12" className={className} fill="currentColor" aria-hidden>
          <rect x="1.8" y="4.4" width="8.4" height="5.8" rx="1.4" />
          <rect x="4.2" y="2" width="3.6" height="2.2" rx="0.5" />
        </svg>
      );
  }
}

// ── evidence explorer: one BIG map that draws whatever is selected ─────────
type Evidence = { kind: "rot"; ev: RotateEvent } | { kind: "kill"; m: CheatMoment };

const KIND_SHORT: Record<TriggerKind, string> = {
  utility: "utility",
  fight: "fight",
  contact: "sound",
  bomb: "bomb",
};

// The centerpiece: a large radar with the selected evidence drawn on it —
// a rotation's full route + where the (unseen) enemies actually stood, or a
// flagged kill's sight line. Every mark explains itself on hover (enlarged
// invisible hit areas → styled tooltip), and a small legend sits on the map
// so the symbols are readable without hovering at all.
// pre-kill tracking trace: both players' 1 Hz paths in the seconds before a
// tracked kill — the killer's view rays vs the occluded victim's route
interface KillTrace {
  killer: { x: number; y: number; z?: number; d: number; t: number }[];
  victim: { x: number; y: number; z?: number; t: number }[];
}

function EvidenceMap({
  sel,
  proj,
  radar,
  anchors,
  playerName,
  trace,
}: {
  sel: Evidence | null;
  proj: Projection;
  radar: string | null;
  anchors: { a: { x: number; y: number; label: string }; b: { x: number; y: number; label: string } } | null;
  playerName: string;
  trace: KillTrace | null;
}) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const P = (wx: number, wy: number, wz?: number) => {
    const p = proj.project(wx, wy, wz);
    return p ? { x: p.x * 100, y: p.y * 100 } : null;
  };
  const rot = sel?.kind === "rot" ? sel.ev : null;
  const kill = sel?.kind === "kill" ? sel.m : null;

  const pts = (rot?.path ?? [])
    .map((p) => P(p.x, p.y, p.z))
    .filter((p): p is { x: number; y: number } => p != null);
  const line = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const prev = pts.length > 1 ? pts[pts.length - 2] : null;
  const ang = last && prev ? (Math.atan2(last.y - prev.y, last.x - prev.x) * 180) / Math.PI : 0;
  const hex = rot ? VERDICT_UI[rot.verdict].hex : "#7f8ea3";
  const trig =
    rot?.trigger && rot.trigger.x != null && rot.trigger.y != null
      ? P(rot.trigger.x, rot.trigger.y, rot.trigger.z)
      : null;
  const kp = kill ? P(kill.kx, kill.ky, kill.kz) : null;
  const vp = kill ? P(kill.vx, kill.vy, kill.vz) : null;
  // CS2 world units → meters (1 unit = 0.75in = 0.01905 m)
  const killDist = kill ? Math.hypot(kill.kx - kill.vx, kill.ky - kill.vy) * 0.01905 : 0;

  // hover helpers: show a styled tooltip anchored to a map position
  const show = (x: number, y: number, text: string) => ({
    onMouseEnter: () => setTip({ x, y, text }),
    onMouseLeave: () => setTip(null),
  });
  const hit = { fill: "transparent", stroke: "transparent", style: { cursor: "help" } as const };

  const legend =
    sel == null ? null : sel.kind === "rot" ? (
      <>
        <div>
          <span style={{ color: hex }}>━▶</span> {playerName}&apos;s route
        </div>
        <div>
          <span className="text-bad">○</span> enemies when he moved
        </div>
        {rot?.trigger && (
          <div>
            <span style={{ color: KIND_HEX[rot.trigger.kind] }}>●</span> the info ({KIND_SHORT[rot.trigger.kind]})
          </div>
        )}
      </>
    ) : (
      <>
        <div>
          <span className="text-brand">●</span> {playerName} shot from
        </div>
        <div>
          <span className="text-bad">✕</span> {kill?.victim} died · ~{killDist.toFixed(0)}m
        </div>
        {trace && (
          <>
            <div>
              <span className="text-bad">┅</span> {kill?.victim}&apos;s hidden route before the kill
            </div>
            <div>
              <span className="text-brand">╱</span> {playerName}&apos;s crosshair, second by second
            </div>
          </>
        )}
      </>
    );

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-line bg-panel2" style={{ aspectRatio: "1" }}>
      {radar && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={radar} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
      )}
      <div className="absolute inset-0 bg-[rgba(4,6,14,0.25)]" />
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" onMouseLeave={() => setTip(null)}>
        {/* site labels */}
        {anchors &&
          ([anchors.a, anchors.b] as const).map((s) => {
            const p = P(s.x, s.y);
            return p ? (
              <text
                key={s.label}
                x={p.x}
                y={p.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="7"
                fontWeight="900"
                fill="#e8eefb"
                stroke="#04060e"
                strokeWidth="1.6"
                paintOrder="stroke"
                opacity="0.9"
              >
                {s.label}
              </text>
            ) : null;
          })}

        {/* rotation: enemies (hidden state) + route + info marker */}
        {rot &&
          rot.enemies.map((e, i) => {
            const p = P(e.x, e.y, e.z);
            return p ? (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r="2.1" fill="rgba(255,92,92,0.28)" stroke="#ff5c5c" strokeWidth="0.7" />
                <circle cx={p.x} cy={p.y} r="0.7" fill="#ff5c5c" />
                <circle cx={p.x} cy={p.y} r="4" {...hit} {...show(p.x, p.y, `enemy standing here when ${playerName} moved — not visible to him`)} />
              </g>
            ) : null;
          })}
        {rot && pts.length > 1 && (
          <>
            <polyline points={line} fill="none" stroke="#04060e" strokeWidth="3.2" strokeLinejoin="round" opacity="0.75" />
            <polyline points={line} fill="none" stroke={hex} strokeWidth="1.7" strokeLinejoin="round" />
            <polyline
              points={line}
              fill="none"
              stroke="transparent"
              strokeWidth="6"
              strokeLinejoin="round"
              style={{ cursor: "help" }}
              {...(pts[Math.floor(pts.length / 2)]
                ? show(
                    pts[Math.floor(pts.length / 2)].x,
                    pts[Math.floor(pts.length / 2)].y,
                    `${playerName}'s route ${rot.from} → ${rot.to} · ${mmss(rot.t0)} → ${mmss(rot.tArrive)}`,
                  )
                : {})}
            />
          </>
        )}
        {rot && pts[0] && (
          <g>
            <circle cx={pts[0].x} cy={pts[0].y} r="2" fill="#04060e" stroke="#e8eefb" strokeWidth="1" />
            <circle cx={pts[0].x} cy={pts[0].y} r="4" {...hit} {...show(pts[0].x, pts[0].y, `start — left ${rot.from} at ${mmss(rot.t0)}`)} />
          </g>
        )}
        {rot && last && (
          <g>
            <g transform={`translate(${last.x} ${last.y}) rotate(${ang})`}>
              <path d="M3.6 0 L-2.6 -3 L-2.6 3 Z" fill={hex} stroke="#04060e" strokeWidth="0.7" />
            </g>
            <circle cx={last.x} cy={last.y} r="4.5" {...hit} {...show(last.x, last.y, `arrived at ${rot.to} · ${mmss(rot.tArrive)}`)} />
          </g>
        )}
        {rot && trig && rot.trigger && (
          <g>
            <circle cx={trig.x} cy={trig.y} r="3.4" fill="none" stroke={KIND_HEX[rot.trigger.kind]} strokeWidth="0.8" opacity="0.65" />
            <circle cx={trig.x} cy={trig.y} r="1.9" fill={KIND_HEX[rot.trigger.kind]} stroke="#04060e" strokeWidth="0.8" />
            <circle
              cx={trig.x}
              cy={trig.y}
              r="5"
              {...hit}
              {...show(trig.x, trig.y, `the info he could act on: ${rot.trigger.label} at ${mmss(rot.trigger.t)}`)}
            />
          </g>
        )}

        {/* pre-kill tracking trace: the victim's occluded route + the killer's
            crosshair direction at each 1 Hz sample. A fan of rays that keeps
            pointing at the moving hidden target IS the tell, made visible. */}
        {kill && trace && (
          <g>
            {(() => {
              const vpts = trace.victim
                .map((s) => P(s.x, s.y, s.z))
                .filter((q): q is { x: number; y: number } => q != null);
              // split at inset jumps: on Nuke/Vertigo the two levels are
              // separate radar regions — one polyline across them draws a
              // nonsense diagonal. A >15-viewBox-unit hop between consecutive
              // 1 Hz samples can only be a level change.
              const segs: { x: number; y: number }[][] = [];
              let cur: { x: number; y: number }[] = [];
              for (const q of vpts) {
                const prev = cur[cur.length - 1];
                if (prev && Math.hypot(q.x - prev.x, q.y - prev.y) > 15) {
                  if (cur.length > 1) segs.push(cur);
                  cur = [];
                }
                cur.push(q);
              }
              if (cur.length > 1) segs.push(cur);
              return (
                <>
                  {segs.map((seg, si) => (
                    <polyline
                      key={si}
                      points={seg.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ")}
                      fill="none"
                      stroke="#ff5c5c"
                      strokeWidth="1"
                      strokeDasharray="1.6 1.6"
                      opacity="0.8"
                    />
                  ))}
                  {trace.killer.map((s, i) => {
                    const q = P(s.x, s.y, s.z);
                    if (!q) return null;
                    const rad = (-s.d * Math.PI) / 180; // same convention as the replay radar
                    const age = (trace.killer[trace.killer.length - 1].t - s.t) / 8;
                    return (
                      <g key={i} opacity={0.9 - 0.6 * age}>
                        <line
                          x1={q.x}
                          y1={q.y}
                          x2={q.x + Math.cos(rad) * 7}
                          y2={q.y + Math.sin(rad) * 7}
                          stroke="#38d6ff"
                          strokeWidth="0.6"
                        />
                        <circle cx={q.x} cy={q.y} r="0.8" fill="#38d6ff" />
                        <circle
                          cx={q.x}
                          cy={q.y}
                          r="2.5"
                          {...hit}
                          {...show(q.x, q.y, `${playerName} at ${mmss(s.t)} — the ray is his crosshair while ${kill.victim} was hidden`)}
                        />
                      </g>
                    );
                  })}
                </>
              );
            })()}
          </g>
        )}

        {/* flagged kill: shooter → victim sight line */}
        {kill && kp && vp && (
          <>
            <line x1={kp.x} y1={kp.y} x2={vp.x} y2={vp.y} stroke="#04060e" strokeWidth="2" opacity="0.7" />
            <line x1={kp.x} y1={kp.y} x2={vp.x} y2={vp.y} stroke="#e8eefb" strokeWidth="0.8" strokeDasharray="2 1.6" />
            <line
              x1={kp.x}
              y1={kp.y}
              x2={vp.x}
              y2={vp.y}
              strokeWidth="5"
              {...hit}
              {...show((kp.x + vp.x) / 2, (kp.y + vp.y) / 2, `the sight line · ~${killDist.toFixed(0)}m${kill.tags[0] ? ` · ${kill.tags[0]}` : ""}`)}
            />
          </>
        )}
        {kill && kp && (
          <g>
            <circle cx={kp.x} cy={kp.y} r="2.2" fill="#38d6ff" stroke="#04060e" strokeWidth="0.9" />
            <circle cx={kp.x} cy={kp.y} r="4.5" {...hit} {...show(kp.x, kp.y, `${playerName} shot from here · R${kill.roundN} ${mmss(kill.t)}`)} />
          </g>
        )}
        {kill && vp && (
          <g>
            <g stroke="#ff5c5c" strokeWidth="1.1" strokeLinecap="round">
              <line x1={vp.x - 1.7} y1={vp.y - 1.7} x2={vp.x + 1.7} y2={vp.y + 1.7} />
              <line x1={vp.x - 1.7} y1={vp.y + 1.7} x2={vp.x + 1.7} y2={vp.y - 1.7} />
            </g>
            <circle cx={vp.x} cy={vp.y} r="4.5" {...hit} {...show(vp.x, vp.y, `${kill.victim} died here${kill.hs ? " — headshot" : ""}`)} />
          </g>
        )}
      </svg>

      {/* what the symbols mean — always visible, bottom-left */}
      {legend && (
        <div className="pointer-events-none absolute bottom-1.5 left-1.5 space-y-0.5 rounded-md bg-black/65 px-2 py-1 text-[9px] leading-relaxed text-muted backdrop-blur-sm">
          {legend}
        </div>
      )}

      {/* hover tooltip */}
      {tip && (
        <div
          className="pointer-events-none absolute z-10 max-w-[85%] rounded-md border border-line bg-black/90 px-2 py-1 text-[10px] font-medium text-ink shadow-lg"
          style={{
            left: `${Math.min(80, Math.max(10, tip.x))}%`,
            top: `${tip.y}%`,
            transform: tip.y < 16 ? "translate(-50%, 14px)" : "translate(-50%, calc(-100% - 10px))",
          }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}

// ── big labeled timeline for the selected rotation ─────────────────────────
function EvidenceTimeline({ ev }: { ev: RotateEvent }) {
  const W = 360;
  const tMax = Math.max(ev.tArrive, ev.firstInfo ?? 0, ev.commitAt ?? 0) + 10;
  const x = (t: number) => 12 + (Math.max(0, t) / tMax) * (W - 24);
  const hex = VERDICT_UI[ev.verdict].hex;
  const kindHex = ev.trigger ? KIND_HEX[ev.trigger.kind] : "#cfd8e6";
  const infoX = ev.firstInfo != null ? x(ev.firstInfo) : null;
  const moveX = x(ev.t0);
  const arriveX = x(ev.tArrive);
  return (
    <svg viewBox={`0 0 ${W} 46`} className="w-full">
      <line x1="12" y1="26" x2={W - 12} y2="26" stroke="var(--color-line)" strokeWidth="2" />
      <text x="12" y="42" fontSize="9" fill="var(--color-faint)">
        0:00
      </text>
      {/* enemy shift — the hidden state changing */}
      {ev.commitAt != null && (
        <g>
          <path d={`M${x(ev.commitAt)} 19 l4 4 -4 4 -4 -4 Z`} fill="#ff9d5c" stroke="#04060e" strokeWidth="1" />
          <text x={x(ev.commitAt)} y="12" textAnchor="middle" fontSize="9" fontWeight="700" fill="#ff9d5c">
            enemies shift {mmss(ev.commitAt)}
          </text>
        </g>
      )}
      {/* the move */}
      <line x1={moveX} y1="26" x2={Math.max(moveX + 4, arriveX - 4)} y2="26" stroke={hex} strokeWidth="6" strokeLinecap="round" />
      <path d={`M${arriveX + 5} 26 L${arriveX - 4} 21 L${arriveX - 4} 31 Z`} fill={hex} />
      <text x={moveX} y="42" textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--color-ink)">
        moved {mmss(ev.t0)}
      </text>
      {/* the information */}
      {infoX != null && ev.trigger && (
        <g>
          <circle cx={infoX} cy="26" r="5" fill={kindHex} stroke="#04060e" strokeWidth="1.6">
            <title>{`${ev.trigger.label} at ${mmss(ev.trigger.t)}`}</title>
          </circle>
          {(() => {
            // top row unless it collides with the commit label; then the bottom
            // row unless that collides with the move label; else tooltip only
            const clearTop = ev.commitAt == null || Math.abs(x(ev.commitAt) - infoX) >= 70;
            const clearBottom = Math.abs(moveX - infoX) >= 62;
            if (!clearTop && !clearBottom) return null;
            return (
              <text x={infoX} y={clearTop ? 12 : 42} textAnchor="middle" fontSize="9" fontWeight="700" fill={kindHex}>
                {KIND_SHORT[ev.trigger.kind]} {mmss(ev.trigger.t)}
              </text>
            );
          })()}
        </g>
      )}
    </svg>
  );
}

// compact factor names for the narrow suspicion-rail rows (full labels truncate)
const FACTOR_SHORT: Record<string, string> = {
  snap: "snap kills",
  acc: "accuracy",
  hsacc: "HS acc",
  react: "reaction",
  hs: "HS %",
  rot: "rotates",
};

function safeName(name: string): string {
  return (
    [...String(name)]
      .filter((ch) => {
        const c = ch.codePointAt(0) ?? 0;
        return c >= 0x20 && c !== 0x7f && ch !== "<" && ch !== ">";
      })
      .join("")
      .trim()
      .slice(0, 64) || "Unknown"
  );
}

// ── suspicion leaderboard row ──────────────────────────────────────────────
function SuspectRow({
  p,
  cheat,
  rank,
  selected,
  onSelect,
}: {
  p: PlayerInsight;
  cheat: DemoCheat;
  rank: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const hex = teamHex(p.team);
  const top = cheat.factors[0];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition ${
        selected ? "border-brand/50 bg-brand/10" : "border-transparent hover:bg-panel/60"
      }`}
    >
      <span className="w-4 shrink-0 text-right text-[10px] font-bold tabular-nums text-faint">{rank}</span>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: hex }} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-xs font-semibold ${selected ? "text-brand" : "text-ink"}`}>{p.name}</span>
        <span className="mt-0.5 block h-1 w-full overflow-hidden rounded-full bg-panel">
          <span
            className="block h-full rounded-full"
            style={{ width: `${cheat.score}%`, background: BAND_HEX[cheat.band] }}
          />
        </span>
      </span>
      <span className="w-14 shrink-0 text-right">
        <span className="block text-xs font-bold tabular-nums" style={{ color: BAND_HEX[cheat.band] }}>
          {cheat.score.toFixed(0)}%
        </span>
        <span className="block truncate text-[9px] uppercase tracking-wide text-faint">
          {top ? FACTOR_SHORT[top.key] ?? top.label : cheat.confidence < 0.5 ? "low data" : "clean"}
        </span>
      </span>
    </button>
  );
}

// ── one team's rotation habits: speed bar + trigger-mix bar ────────────────
function TeamRotateRow({
  label,
  hex,
  team,
  fastestName,
  maxResp,
}: {
  label: string;
  hex: string;
  team: TeamRotates;
  fastestName: string | null;
  maxResp: number; // shared scale so the two teams' speed bars compare
}) {
  const kinds = Object.entries(team.byTrigger).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  const kindTotal = kinds.reduce((s, [, n]) => s + (n ?? 0), 0);
  return (
    <div className="rounded-lg border border-line bg-panel/40 px-2 py-1.5">
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: hex }} />
        <span className="font-semibold text-ink">{label}</span>
        {team.blindCorrect > 0 && (
          <span className="rounded-full bg-bad/15 px-1.5 text-[9px] font-bold text-bad">
            {team.blindCorrect} pre-info
          </span>
        )}
        <span className="ml-auto tabular-nums text-[10px] text-faint">
          {team.total}× {fastestName && team.fastest ? `· ⚡ ${fastestName}` : ""}
        </span>
      </div>
      {team.avgResponseSec != null && (
        <div
          className="mt-1 flex items-center gap-1.5"
          title={`Average delay between information appearing and a player moving — shorter bar = faster team (fastest: ${fastestName ?? "—"})`}
        >
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(100, (team.avgResponseSec / maxResp) * 100)}%`, background: hex }}
            />
          </div>
          <span className="w-8 shrink-0 text-right text-[9px] tabular-nums text-muted">
            ~{team.avgResponseSec.toFixed(0)}s
          </span>
        </div>
      )}
      {kindTotal > 0 && (
        <div className="mt-1 flex items-center gap-1.5">
          <div className="flex h-1.5 flex-1 gap-px overflow-hidden rounded-full">
            {kinds.map(([k, n]) => (
              <div
                key={k}
                style={{ width: `${((n ?? 0) / kindTotal) * 100}%`, background: KIND_HEX[k as TriggerKind] }}
                title={`${TRIGGER_LABEL[k as TriggerKind]}: ${n} of ${kindTotal} informed rotations`}
              />
            ))}
          </div>
          <span className="flex w-8 shrink-0 items-center justify-end gap-0.5">
            {kinds.slice(0, 2).map(([k]) => (
              <span key={k} style={{ color: KIND_HEX[k as TriggerKind] }} title={TRIGGER_LABEL[k as TriggerKind]}>
                <KindIcon kind={k as TriggerKind} className="h-2.5 w-2.5" />
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}

// short verdict labels for the evidence rail (the map + tooltip say the rest)
const VERDICT_RAIL: Record<RotateEvent["verdict"], { label: string; cls: string }> = {
  "blind-correct": { label: "PRE-INFO", cls: "bg-bad/15 text-bad" },
  "blind-wrong": { label: "wrong", cls: "bg-good/15 text-good" },
  hunch: { label: "read", cls: "bg-panel text-muted" },
  informed: { label: "normal", cls: "bg-panel text-faint" },
};

// ── one selectable evidence row (rotation or flagged kill) ─────────────────
function EvidenceRow({
  e,
  active,
  onSelect,
  onHover,
  onLeave,
  onWatch,
}: {
  e: Evidence;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
  onLeave: () => void;
  onWatch: () => void;
}) {
  const inner =
    e.kind === "rot" ? (
      <>
        <span className="font-bold tabular-nums text-ink">R{e.ev.roundN}</span>
        <span className="tabular-nums text-faint">{mmss(e.ev.t0)}</span>
        <span className="truncate font-semibold text-muted">
          {e.ev.from} → {e.ev.to}
        </span>
        {e.ev.trigger && (
          <span className="flex shrink-0 items-center" style={{ color: KIND_HEX[e.ev.trigger.kind] }} title={e.ev.trigger.label}>
            <KindIcon kind={e.ev.trigger.kind} className="h-2.5 w-2.5" />
          </span>
        )}
        <span className={`ml-auto shrink-0 rounded-full px-1.5 text-[9px] font-bold ${VERDICT_RAIL[e.ev.verdict].cls}`}>
          {VERDICT_RAIL[e.ev.verdict].label}
        </span>
      </>
    ) : (
      <>
        <span
          className="grid h-4 w-7 shrink-0 place-items-center rounded text-[8px] font-black"
          style={{ background: `${e.m.weaponColor}22`, color: e.m.weaponColor }}
        >
          {e.m.weaponLabel.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase()}
        </span>
        <span className="font-bold tabular-nums text-ink">R{e.m.roundN}</span>
        <span className="truncate text-muted">→ {e.m.victim}</span>
        {e.m.hs && <span className="shrink-0 text-bad" title="headshot">⌖</span>}
        {(e.m.extraKills ?? 0) > 0 && (
          <span className="shrink-0 text-[9px] font-bold text-faint" title="More flagged kills this round">
            +{e.m.extraKills}
          </span>
        )}
        <span className="ml-auto shrink-0 truncate rounded-full bg-panel px-1.5 text-[9px] font-medium text-faint">
          {e.m.tags[0] ?? ""}
        </span>
      </>
    );
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(k) => k.key === "Enter" && onSelect()}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] transition ${
        active ? "border-brand/50 bg-brand/10" : "border-line bg-panel/40 hover:bg-panel/70"
      }`}
    >
      {inner}
      <button
        type="button"
        onClick={(evt) => {
          evt.stopPropagation();
          onWatch();
        }}
        title="Watch in the Replay tab"
        className="shrink-0 rounded-md border border-brand/40 bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand transition hover:bg-brand/20"
      >
        ▶
      </button>
    </div>
  );
}

// ── the two-pane evidence explorer: big map left, evidence rail right ──────
function EvidenceExplorer({
  rotEvents,
  moments,
  rotReason,
  aimBacked,
  proj,
  radar,
  anchors,
  playerIdx,
  playerName,
  rounds,
  onWatch,
}: {
  rotEvents: RotateEvent[];
  moments: CheatMoment[];
  rotReason?: string;
  aimBacked: boolean;
  proj: Projection;
  radar: string | null;
  anchors: { a: { x: number; y: number; label: string }; b: { x: number; y: number; label: string } } | null;
  playerIdx: number;
  playerName: string;
  rounds: ReplayRound[];
  onWatch: (round: number, t: number, player: number | null) => void;
}) {
  const list: Evidence[] = useMemo(
    () => [
      ...rotEvents.map((ev) => ({ kind: "rot" as const, ev })),
      ...moments.map((m) => ({ kind: "kill" as const, m })),
    ],
    [rotEvents, moments],
  );
  const [pin, setPin] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const selIdx = hover ?? Math.min(pin, Math.max(0, list.length - 1));
  const sel = list[selIdx] ?? null;

  // pre-kill trace for tracked kills: both players' 1 Hz paths over the 8 s
  // before the kill, from the frames we already store
  const trace = useMemo(() => {
    if (sel?.kind !== "kill" || sel.m.trkPct == null) return null;
    const r = rounds[sel.m.roundIdx];
    if (!r) return null;
    const killer: KillTrace["killer"] = [];
    const victim: KillTrace["victim"] = [];
    for (const f of r.frames ?? []) {
      if (f.t < sel.m.t - 8 || f.t > sel.m.t) continue;
      for (const p of f.p) {
        if (p.i === playerIdx) killer.push({ x: p.x, y: p.y, z: p.z, d: p.d, t: f.t });
        else if (p.i === sel.m.victimIdx) victim.push({ x: p.x, y: p.y, z: p.z, t: f.t });
      }
    }
    return killer.length && victim.length ? { killer, victim } : null;
  }, [sel, rounds, playerIdx]);

  if (list.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[11px] text-faint">
        {rotReason ? `Rotation analysis unavailable — ${rotReason}. ` : ""}
        {aimBacked
          ? "No standout kills or rotations — nothing this player did reads as anomalous."
          : "No per-round aim data (older parse) — re-parse the demo to surface reviewable evidence."}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
      {/* the map pane — the selected evidence, drawn big (capped so the
          caption + timeline stay in view on wide screens) */}
      <div className="w-full max-w-115 lg:w-[46%] lg:shrink-0">
        <EvidenceMap sel={sel} proj={proj} radar={radar} anchors={anchors} playerName={playerName} trace={trace} />
        {sel?.kind === "rot" && (
          <>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${VERDICT_UI[sel.ev.verdict].cls}`}>
                {VERDICT_UI[sel.ev.verdict].label}
              </span>
              <span className="text-muted">
                R{sel.ev.roundN} · left {sel.ev.from} for {sel.ev.to}
              </span>
              {sel.ev.trigger && (
                <span className="flex items-center gap-1 text-faint" style={{ color: KIND_HEX[sel.ev.trigger.kind] }}>
                  <KindIcon kind={sel.ev.trigger.kind} className="h-2.5 w-2.5" />
                  {sel.ev.trigger.label}
                </span>
              )}
            </div>
            <EvidenceTimeline ev={sel.ev} />
          </>
        )}
        {sel?.kind === "kill" && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px]">
            <span className="font-bold tabular-nums text-ink">R{sel.m.roundN}</span>
            <span className="tabular-nums text-faint">{mmss(sel.m.t)}</span>
            <span className="text-muted">
              <span className="text-brand">●</span> him → <span className="text-bad">✕</span> {sel.m.victim}
            </span>
            {sel.m.tags.slice(0, 4).map((tg, i) => (
              <span key={i} className="rounded-full bg-panel px-1.5 text-[9px] font-medium text-faint">
                {tg}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* the rail — hover previews on the map, click pins, ▶ watches */}
      <div className="min-w-0 flex-1 space-y-1" onMouseLeave={() => setHover(null)}>
        {rotEvents.length > 0 && (
          <div className="stat-label pb-0.5">Rotations · {rotEvents.length}</div>
        )}
        {rotReason && rotEvents.length === 0 && (
          <div className="pb-0.5 text-[10px] text-faint">Rotations n/a — {rotReason}.</div>
        )}
        {moments.length === 0 && (
          <div className="flex items-center gap-1.5 pb-0.5 pt-1 text-[10px] text-good">
            <span className="h-1.5 w-1.5 rounded-full bg-good" />
            no flagged kills — every kill reads like normal aim
          </div>
        )}
        {list.map((e, i) => (
          <div key={e.kind === "rot" ? `r${e.ev.roundIdx}-${e.ev.t0}` : `k${e.m.roundIdx}-${e.m.t}`}>
            {e.kind === "kill" && (i === 0 || list[i - 1].kind === "rot") && (
              <div className="pb-0.5 pt-1 first:pt-0">
                <span className="stat-label">Flagged kills · {moments.length}</span>
              </div>
            )}
            <EvidenceRow
              e={e}
              active={selIdx === i}
              onSelect={() => setPin(i)}
              onHover={() => setHover(i)}
              onLeave={() => setHover((h) => (h === i ? null : h))}
              onWatch={() =>
                e.kind === "rot"
                  ? onWatch(e.ev.roundIdx, Math.max(0, e.ev.t0 - 3), playerIdx)
                  : onWatch(e.m.roundIdx, e.m.t, playerIdx)
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── the case file for one selected suspect ─────────────────────────────────
// "Seen before" — this steamId's track record across the OTHER demos in the
// library: one suspicious game reads very differently when the same player ran
// a 70% meter three weeks ago too. Cache-first (lib/demo/opponents).
function SeenBefore({
  steamId,
  demoId,
  currentScore,
  currentBand,
}: {
  steamId: string;
  demoId: string;
  currentScore: number;
  currentBand: keyof typeof BAND_HEX;
}) {
  const [rows, setRows] = useState<OpponentSighting[] | null>(null);
  useEffect(() => {
    let alive = true;
    setRows(null);
    // shouldContinue lets the pipeline loop stop the moment this case file
    // unmounts or the suspect changes — no wasted multi-demo re-analysis
    void opponentHistory(steamId, demoId, () => alive).then((r) => {
      if (alive) setRows(r);
    });
    return () => {
      alive = false;
    };
  }, [steamId, demoId]);
  if (!rows || rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-line bg-panel/30 px-3 py-2 lg:shrink-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="stat-label">Seen before · {rows.length} other demo{rows.length === 1 ? "" : "s"}</span>
        <span className="flex items-center gap-1" title="CheatMeter per demo, oldest → newest · ● = this demo">
          {rows.map((r) => (
            <span
              key={r.demoId}
              className="h-2 w-2 rounded-full"
              style={{ background: BAND_HEX[r.cheatBand as keyof typeof BAND_HEX] ?? "#7f8ea3", opacity: 0.9 }}
              title={`${new Date(r.savedAt).toLocaleDateString()} · ${r.cheatScore.toFixed(0)}%`}
            />
          ))}
          <span className="h-2.5 w-2.5 rounded-full ring-1 ring-white/60" style={{ background: BAND_HEX[currentBand] }} title={`this demo · ${currentScore.toFixed(0)}%`} />
        </span>
      </div>
      <div className="space-y-0.5">
        {rows.slice(-4).map((r) => (
          <Link
            key={r.demoId}
            href={`/demos/${r.demoId}?tab=verdict`}
            className="flex items-center gap-2 rounded px-1 py-0.5 text-[11px] transition hover:bg-panel/60"
            title={`open ${r.demoName}`}
          >
            <span className="w-16 shrink-0 tabular-nums text-faint">{new Date(r.savedAt).toLocaleDateString()}</span>
            <span className="w-16 shrink-0 truncate capitalize text-muted">{mapLabel(r.map)}</span>
            <span className="min-w-0 flex-1 truncate text-faint">
              {r.kills}-{r.deaths} · {r.adr.toFixed(0)} ADR
              {r.name && <span className="text-faint"> · as “{r.name}”</span>}
            </span>
            <span
              className="shrink-0 font-bold tabular-nums"
              style={{ color: BAND_HEX[r.cheatBand as keyof typeof BAND_HEX] ?? "#7f8ea3" }}
              title={r.confidence < 0.6 ? "low-confidence read (older parse)" : undefined}
            >
              {r.cheatScore.toFixed(0)}%
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

const STEP_METRIC_LABEL: Record<StepChange["metric"], string> = {
  reaction: "Reaction time",
  preaim: "Pre-aim offset",
  accuracy: "Accuracy",
};
// per-metric value formatting, shared by the sparklines and the AI prompt —
// integer-rounding pre-aim degrees would send the model "2→2" for a real step
const STEP_FMT: Record<StepChange["metric"], (v: number) => string> = {
  reaction: (v) => `${v.toFixed(0)}ms`,
  preaim: (v) => `${v.toFixed(1)}°`,
  accuracy: (v) => `${v.toFixed(0)}%`,
};

/** One consistency sparkline: a per-round series with the flagged step (if any)
 *  shaded. Single series, so no legend — the row label names it. */
function Spark({
  label,
  pts,
  totalRounds,
  step,
  fmt,
}: {
  label: string;
  pts: SeriesPoint[];
  totalRounds: number;
  step: StepChange | null; // only when THIS metric carries the flagged step
  fmt: (v: number) => string;
}) {
  const W = 260;
  const H = 30;
  if (pts.length < 4) {
    return (
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-[9px] font-bold uppercase tracking-wide text-faint">{label}</span>
        <span className="text-[10px] text-faint">not enough rounds with samples</span>
      </div>
    );
  }
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  const pad = Math.max((hi - lo) * 0.15, 1e-3);
  const x = (round: number) => (totalRounds <= 1 ? 0 : ((round - 1) / (totalRounds - 1)) * W);
  const y = (v: number) => H - 3 - ((v - lo + pad) / (hi - lo + 2 * pad)) * (H - 6);
  const line = pts.map((p) => `${x(p.round).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const mean = pts.reduce((s, p) => s + p.v, 0) / pts.length;
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[9px] font-bold uppercase tracking-wide text-faint">{label}</span>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-7.5 min-w-0 flex-1" aria-label={`${label} per round`}>
        {step && (
          <>
            {/* the "after" regime — where the numbers changed */}
            <rect x={x(step.atRound)} y={0} width={Math.max(0, W - x(step.atRound))} height={H} fill="#ff5c5c" opacity={0.08} />
            <line x1={x(step.atRound)} y1={0} x2={x(step.atRound)} y2={H} stroke="#ff5c5c" strokeWidth={1} strokeDasharray="3 2" />
          </>
        )}
        <polyline points={line} fill="none" stroke={step ? "#c95560" : "#7f8ea3"} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
        {/* invisible per-sample hover columns — hit target far bigger than the mark */}
        {pts.map((p) => (
          <rect key={p.round} x={x(p.round) - W / (2 * totalRounds)} y={0} width={W / totalRounds} height={H} fill="transparent">
            <title>{`R${p.round} · ${fmt(p.v)}`}</title>
          </rect>
        ))}
      </svg>
      <span className={`w-21.5 shrink-0 text-right text-[10px] tabular-nums ${step ? "font-bold text-bad" : "text-muted"}`}>
        {step ? `${fmt(step.before)} → ${fmt(step.after)}` : `avg ${fmt(mean)}`}
      </span>
    </div>
  );
}

function CaseFile({
  p,
  cheat,
  rot,
  rotReason,
  anchors,
  meta,
  rounds,
  view,
  demoId,
  autoRunAccount,
  onWatch,
}: {
  p: PlayerInsight;
  cheat: DemoCheat;
  rot: PlayerRotates | null;
  rotReason?: string;
  anchors: { a: { x: number; y: number; label: string }; b: { x: number; y: number; label: string } } | null;
  meta: ReplayMeta;
  rounds: ReplayRound[];
  view: DemoView;
  demoId: string;
  autoRunAccount: boolean;
  onWatch: (round: number, t: number, player: number | null) => void;
}) {
  const hex = teamHex(p.team);
  const tend = useMemo(() => computeTendencies(meta, rounds), [meta, rounds]);
  const tendLines = useMemo(() => playstyleSummary(p, tend.get(p.steamId)), [p, tend]);
  const moments = useMemo(() => cheatMoments(meta, rounds, p.i), [meta, rounds, p.i]);
  // uncapped set for the round timeline — the rail's top-12 cap must not make
  // additionally-flagged rounds render as clean cells
  const allMoments = useMemo(() => cheatMoments(meta, rounds, p.i, 1000), [meta, rounds, p.i]);
  const aimBacked = useMemo(() => hasAimData(rounds), [rounds]);
  const consist = useMemo(() => aimConsistency(rounds, p.i), [rounds, p.i]);
  // the bundled sample match uses fake ids — no profile page or account data exists
  const sampleId = p.steamId.startsWith("sample-");

  const rotEvents = useMemo(
    () =>
      (rot?.events ?? [])
        .slice()
        .sort(
          (a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || a.roundN - b.roundN,
        )
        .slice(0, 8),
    [rot],
  );
  const proj = useMemo(() => buildProjection(meta.map, rounds), [meta, rounds]);
  const radar = hasCalibration(meta.map) ? radarImage(meta.map) : null;

  const cheatFactors = cheat.factors.slice(0, 4).map((f) => `${f.label} ${f.display}`).join(", ");
  const matchStats = `${p.kills}-${p.deaths} (K/D ${p.kd.toFixed(2)}, ${p.kpr.toFixed(2)} KPR), ${p.hsPct.toFixed(0)}% HS, ${p.adr.toFixed(0)} ADR${
    p.shots >= 40 ? `, acc ${p.accuracy.toFixed(0)}%/HS-acc ${p.hsAccuracy.toFixed(0)}%` : ""
  }${p.aimSamples >= 6 ? `, reaction ${p.reactionMs.toFixed(0)}ms, snap ${p.snapRate.toFixed(0)}%` : ""}`;

  return (
    <div className="scroll-slim card-2 flex flex-col gap-3 px-4 py-3 lg:h-full lg:min-h-0 lg:gap-2.5 lg:overflow-y-auto">
      {/* identity */}
      <div className="flex items-center gap-2 lg:shrink-0">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-black" style={{ background: `${hex}22`, color: hex }}>
          {(p.name || "?").slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="truncate text-base font-extrabold">{p.name}</div>
          <div className="text-[11px] tabular-nums text-faint">
            {p.team || "—"} · {p.kills}-{p.deaths} · {p.adr.toFixed(0)} ADR · {p.hsPct.toFixed(0)}% HS
          </div>
        </div>
        {!sampleId && (
          <Link
            href={`/profiles/${p.steamId}`}
            className="ml-auto shrink-0 rounded border border-line px-2 py-1 text-[11px] text-muted transition hover:bg-panel/50 hover:text-ink"
          >
            Profile →
          </Link>
        )}
      </div>

      {/* CheatMeter headline + factor breakdown */}
      <div className="rounded-lg border border-line bg-panel/30 px-3 py-2.5 lg:shrink-0">
        <div className="flex items-end justify-between">
          <div>
            <div className="stat-label">In-match CheatMeter</div>
            <div className="text-[10px] text-faint">aim + information anomalies — never fragging volume · not proof</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-extrabold leading-none tabular-nums" style={{ color: BAND_HEX[cheat.band] }}>
              {cheat.score.toFixed(0)}%
            </div>
            <div className="text-[10px] font-bold uppercase" style={{ color: BAND_HEX[cheat.band] }}>
              {BAND_LABEL[cheat.band]}
            </div>
          </div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel">
          <div className="h-full rounded-full" style={{ width: `${cheat.score}%`, background: BAND_HEX[cheat.band] }} />
        </div>
        {cheat.confidence < 0.6 && (
          <div className="mt-1 text-[10px] text-mid">
            Low confidence ({(cheat.confidence * 100).toFixed(0)}%) — re-parse the demo for full aim data.
          </div>
        )}
        {cheat.factors.length > 0 ? (
          <div className="mt-2 grid grid-cols-2 gap-1.5 border-t border-line pt-2 min-[480px]:grid-cols-3">
            {cheat.factors.map((f) => (
              <div key={f.key} title={FACTOR_HINT[f.key]} className="rounded-md bg-panel/60 px-2 py-1">
                <div className="flex items-center justify-between gap-1 text-[10px]">
                  <span className="truncate text-muted">{f.label}</span>
                  <span className="shrink-0 font-semibold tabular-nums" style={{ color: BAND_HEX[f.band] }}>
                    {f.display}
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-panel">
                  <div className="h-full rounded-full" style={{ width: `${f.score}%`, background: BAND_HEX[f.band] }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 border-t border-line pt-2 text-[11px] text-faint">
            No aim tells captured — re-parse for snap/accuracy data.
          </div>
        )}
      </div>

      {/* cross-demo track record for this steamId (skips the sample demo) */}
      {!sampleId && (
        <SeenBefore steamId={p.steamId} demoId={demoId} currentScore={cheat.score} currentBand={cheat.band} />
      )}

      {/* consistency — the toggle signature. Legit aim wanders around a personal
          mean; a sharp sustained mid-match improvement is worth a manual look. */}
      {(consist.reaction.length >= 4 || consist.accuracy.length >= 4) && (
        <div className="rounded-lg border border-line bg-panel/30 px-3 py-2.5 lg:shrink-0">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="stat-label">Consistency by round</span>
            <span className="text-[10px] text-faint">hover a column for the round&apos;s number</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Spark
              label="Reaction"
              pts={consist.reaction}
              totalRounds={rounds.length}
              step={consist.step?.metric === "reaction" ? consist.step : null}
              fmt={STEP_FMT.reaction}
            />
            <Spark
              label="Pre-aim"
              pts={consist.preaim}
              totalRounds={rounds.length}
              step={consist.step?.metric === "preaim" ? consist.step : null}
              fmt={STEP_FMT.preaim}
            />
            <Spark
              label="Accuracy"
              pts={consist.accuracy}
              totalRounds={rounds.length}
              step={consist.step?.metric === "accuracy" ? consist.step : null}
              fmt={STEP_FMT.accuracy}
            />
          </div>
          {consist.step ? (
            <div className="mt-2 border-t border-line pt-1.5 text-[10px] text-bad">
              ⚠ {STEP_METRIC_LABEL[consist.step.metric]} stepped sharply at R{consist.step.atRound} and stayed
              there — a mid-match jump like this is the classic toggle pattern. Worth watching those rounds.
              Not proof, and it does not change the CheatMeter score.
            </div>
          ) : (
            <div className="mt-1.5 text-[10px] text-faint">
              No sharp mid-match step — aim quality wanders normally round to round.
            </div>
          )}
        </div>
      )}

      {/* suspect timeline — anomalies vs the scoreline. A cheater who toggles
          when losing shows as markers clustering on red cells. */}
      <div className="lg:shrink-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="stat-label">Round timeline</span>
          <span className="text-[10px] text-faint">
            green = his team won · <span className="text-bad">●</span> flagged kill ·{" "}
            <span className="text-bad">▲</span> pre-info rotate · ▽ other rotate · click = watch
          </span>
        </div>
        <div className="flex gap-0.5">
          {rounds.map((r, ri) => {
            const side = r.ct?.includes(p.i) ? "CT" : r.t?.includes(p.i) ? "T" : "";
            const won = side !== "" && r.winner === side;
            const kills = allMoments.filter((m) => m.roundIdx === ri);
            const rots = (rot?.events ?? []).filter((e) => e.roundIdx === ri);
            const bc = rots.some((e) => e.verdict === "blind-correct");
            const bits = [
              ...kills.map((m) => m.tags[0]),
              ...rots.map((e) => `${e.from}→${e.to} (${VERDICT_RAIL[e.verdict].label})`),
            ].join(" · ");
            return (
              <button
                key={ri}
                type="button"
                onClick={() => onWatch(ri, kills[0]?.t ?? Math.max(0, (rots[0]?.t0 ?? 3) - 3), p.i)}
                title={`R${r.n} · ${won ? "won" : side ? "lost" : "—"}${bits ? ` · ${bits}` : ""}`}
                className={`flex h-6 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-sm transition hover:brightness-150 ${
                  won ? "bg-good/15" : side ? "bg-bad/10" : "bg-panel"
                }`}
              >
                <span className="flex items-center gap-px leading-none">
                  {kills.length > 0 && (
                    // rows merge per round, so "more kills" lives in extraKills
                    <span
                      className="rounded-full bg-bad"
                      style={{
                        width: (kills[0]?.extraKills ?? 0) > 0 ? 7 : 5,
                        height: (kills[0]?.extraKills ?? 0) > 0 ? 7 : 5,
                        opacity: 0.55 + Math.min(0.45, (kills[0]?.weight ?? 0) / 20),
                      }}
                    />
                  )}
                  {rots.length > 0 && (
                    <span className={`text-[7px] leading-none ${bc ? "text-bad" : "text-faint"}`}>
                      {bc ? "▲" : "▽"}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* evidence — one big map, everything reviewable drawn on it */}
      <div className="lg:shrink-0">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="stat-label">Evidence map</span>
          <span className="truncate text-[10px] text-faint">
            hover/click a row to draw it · ▶ to watch it
          </span>
        </div>
        {rot && rot.total > 0 && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1 px-1">
            {rot.blindCorrect === 0 && rot.blindWrong === 0 && rot.hunch === 0 && (
              <span className="flex items-center gap-1.5 text-[10px] text-good" title="Every rotation followed real information — normal map sense">
                <span className="h-1.5 w-1.5 rounded-full bg-good" />
                all after info — no radar tell
              </span>
            )}
            {Object.entries(rot.byTrigger)
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) => (
                <span
                  key={k}
                  className="flex items-center gap-1 rounded-full bg-panel px-1.5 py-0.5 text-[9px] font-semibold"
                  style={{ color: KIND_HEX[k as TriggerKind] }}
                  title={`${TRIGGER_LABEL[k as TriggerKind]} triggered ${n} rotation${n > 1 ? "s" : ""}`}
                >
                  <KindIcon kind={k as TriggerKind} className="h-2.5 w-2.5" />
                  ×{n}
                </span>
              ))}
            {rot.avgResponseSec != null && (
              <span className="rounded-full bg-panel px-1.5 py-0.5 text-[9px] font-semibold text-muted" title="Typical delay between the information appearing and this player moving">
                info → move ~{rot.avgResponseSec.toFixed(0)}s
              </span>
            )}
            {rot.hunch > 0 && (
              <span className="rounded-full bg-panel px-1.5 py-0.5 text-[9px] font-semibold text-faint" title="Rotations with no information and no enemy commit — pure reads/guesses">
                {rot.hunch} read{rot.hunch > 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}
        <EvidenceExplorer
          rotEvents={rotEvents}
          moments={moments}
          rotReason={rotReason}
          aimBacked={aimBacked}
          proj={proj}
          radar={radar}
          anchors={anchors}
          playerIdx={p.i}
          playerName={p.name}
          rounds={rounds}
          onWatch={onWatch}
        />
      </div>

      {/* tendencies */}
      {tendLines.length > 0 && (
        <div className="lg:shrink-0">
          <div className="stat-label mb-1">Tendencies</div>
          <div className="space-y-0.5">
            {tendLines.map((l, i) => (
              <div key={i} className="text-[11px] leading-snug text-muted">
                {l}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* account check + AI read (session-cached, demo-scoped) */}
      <div className="lg:shrink-0">
        {sampleId ? (
          <div className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-[11px] text-faint">
            Account checks aren&apos;t available for the sample match — its players are anonymized.
          </div>
        ) : (
          <AccountCheck
            steamId={p.steamId}
            name={p.name}
            matchScore={cheat.score}
            matchStats={matchStats}
            cheatFactors={cheatFactors}
            tendencyLines={tendLines}
            aiKey={`player:${demoId}:${p.steamId}`}
            autoRun={autoRunAccount ? 0 : null}
          />
        )}
      </div>
    </div>
  );
}

/**
 * MatchVerdict — the "Cheat / AI" tab, rebuilt as an investigation console:
 * a lobby verdict + a suspicion leaderboard on the left, and a deep case file
 * on the right whose flagged moments jump straight to the Replay. The
 * CheatMeter is aim-anomaly only (not fragging volume) and is always a
 * "look here", never proof. Reads are match-wide (aim needs samples), honoring
 * only the side filter.
 */
export default function MatchVerdict({
  meta,
  rounds,
  view,
  demoId,
  onWatch,
}: {
  meta: ReplayMeta;
  rounds: ReplayRound[];
  view: DemoView;
  demoId: string;
  onWatch: (round: number, t: number, player: number | null) => void;
}) {
  const data = useMemo(() => computeInsights(meta, rounds), [meta, rounds]);
  const rotReport = useMemo(() => analyzeRotations(meta, rounds), [meta, rounds]);

  const players = useMemo(
    () =>
      data.players
        .filter((p) => view.side === "all" || p.team === view.side)
        .map((p) => ({
          p,
          rot: rotReport.byPlayer.get(p.i) ?? null,
          cheat: demoCheat(p, rotReport.byPlayer.get(p.i) ?? null),
        }))
        .sort((a, b) => b.cheat.score - a.cheat.score),
    [data, rotReport, view.side],
  );

  const [selId, setSelId] = useState<string | null>(null);
  const selected = players.find((x) => x.p.steamId === selId) ?? players[0] ?? null;
  useEffect(() => {
    if (players.length && !players.some((x) => x.p.steamId === selId)) setSelId(players[0].p.steamId);
  }, [players, selId]);

  const flaggedCount = players.filter((x) => isFlagged(x.cheat)).length;

  // lobby-level rotation read — one line proving the check ran and what it found
  const rotTotals = useMemo(
    () => ({
      total: rotReport.events.length,
      bc: rotReport.events.filter((e) => e.verdict === "blind-correct").length,
    }),
    [rotReport],
  );

  // team rotation styles — keyed by STARTING roster (halftime swaps don't
  // split a team's profile), independent of the side filter
  const teamRot = useMemo(() => {
    if (!rotReport.available) return null;
    const ct = aggregateTeamRotates(rotReport, data.players.filter((p) => p.team === "CT").map((p) => p.i));
    const t = aggregateTeamRotates(rotReport, data.players.filter((p) => p.team === "T").map((p) => p.i));
    return ct || t ? { ct, t } : null;
  }, [rotReport, data]);
  const fastestName = (tr: TeamRotates | null) =>
    tr?.fastest ? (meta.players[tr.fastest.playerIdx]?.name ?? null) : null;

  // "Check all" prefetches every player's account scores (staggered + deduped)
  // so the AI match read is enriched and any case file opens instantly.
  const [checkAll, setCheckAll] = useState(false);
  useEffect(() => {
    if (!checkAll) return;
    const timers = players
      .filter((x) => !x.p.steamId.startsWith("sample-")) // anonymized sample ids have no accounts
      .map((x, idx) =>
        setTimeout(() => {
          void fetchAccountScores(x.p.steamId);
        }, idx * 350),
      );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkAll, players.length]);
  // Reads are match-wide (aim needs samples), so the AI cache is scope-
  // INDEPENDENT — keying it by round scope would re-bill an identical prompt on
  // every scope change. The match read still depends on `side` (it filters the
  // player set); a per-player read depends on neither.
  const matchKey = `match:${demoId}:${view.side}`;
  const cachedMatchAi = getAiRead(matchKey);
  const [matchAi, setMatchAi] = useState<"idle" | "loading" | "done" | "error">(cachedMatchAi ? "done" : "idle");
  const [matchAiText, setMatchAiText] = useState(cachedMatchAi ?? "");
  const [matchAiErr, setMatchAiErr] = useState("");
  const [matchAiOpen, setMatchAiOpen] = useState(!!cachedMatchAi);
  const matchKeyRef = useRef(matchKey);
  useEffect(() => {
    matchKeyRef.current = matchKey;
    const hit = getAiRead(matchKey);
    setMatchAiText(hit ?? "");
    setMatchAi(hit ? "done" : "idle");
    setMatchAiOpen(!!hit);
    setMatchAiErr("");
  }, [matchKey]);

  const runMatchAi = async () => {
    if (matchAi === "loading") return;
    const key = matchKey;
    const hit = getAiRead(key);
    if (hit) {
      setMatchAiText(hit);
      setMatchAi("done");
      setMatchAiOpen(true);
      return;
    }
    setMatchAi("loading");
    setMatchAiErr("");
    setMatchAiOpen(true);
    const lines = players.map(({ p, cheat, rot }) => {
      const acct = cachedAccountScores(p.steamId);
      const acctBits = acct
        ? `${acct.banned ? ", BAN on record" : ""}${acct.trust != null ? `, trust ${acct.trust.toFixed(0)}/100` : ""}`
        : "";
      const tells = cheat.factors.slice(0, 2).map((f) => `${f.label} ${f.display}`).join(", ");
      const rotBits =
        rot && rot.blindCorrect + rot.blindWrong > 0
          ? `, blind rotates ${rot.blindCorrect}✓/${rot.blindWrong}✗`
          : "";
      const step = aimConsistency(rounds, p.i).step;
      const stepBit = step
        ? `, MID-MATCH STEP: ${STEP_METRIC_LABEL[step.metric].toLowerCase()} ${STEP_FMT[step.metric](step.before)}→${STEP_FMT[step.metric](step.after)} from R${step.atRound}`
        : "";
      const rotStyle =
        rot && rot.informed > 0 && rot.avgResponseSec != null
          ? `, rotates ~${rot.avgResponseSec.toFixed(0)}s after info (${Object.entries(rot.byTrigger)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 2)
              .map(([k]) => TRIGGER_LABEL[k as TriggerKind])
              .join(", ")})`
          : "";
      return `- ${safeName(p.name)} (${p.team || "?"}): ${p.kills}-${p.deaths}, ADR ${p.adr.toFixed(0)}, HS ${p.hsPct.toFixed(0)}%, CheatMeter ${cheat.score.toFixed(0)}%${tells ? ` (${tells})` : ""}${rotBits}${stepBit}${rotStyle}${acctBits}`;
    });
    const teamStyleLine = (label: string, tr: TeamRotates | null) => {
      if (!tr || tr.informed === 0) return null;
      const mix = Object.entries(tr.byTrigger)
        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
        .slice(0, 2)
        .map(([k]) => TRIGGER_LABEL[k as TriggerKind])
        .join(", ");
      return `- TEAM ${label} rotation style: ${tr.total} rotations${
        tr.avgResponseSec != null ? `, moves ~${tr.avgResponseSec.toFixed(0)}s after info` : ""
      }${mix ? `, reads ${mix}` : ""}${tr.blindCorrect ? `, ${tr.blindCorrect} PRE-INFO rotate(s)` : ""}`;
    };
    const summary = [
      `MATCH-LEVEL read: a ${rounds.length}-round game on ${meta.map} with ${players.length} players (in-match CheatMeter covers aim anomalies plus information anomalies — "blind rotates" are cross-map rotations made before any info existed, ✓ correct / ✗ wrong; not proof; account data included where already checked). Assess the LOBBY: which players (if any) warrant a closer look and why, who reads clean, and one overall line. Be measured and concrete.`,
      ...[teamStyleLine("CT-start", teamRot?.ct ?? null), teamStyleLine("T-start", teamRot?.t ?? null)].filter(
        (x): x is string => x != null,
      ),
      ...lines,
    ].join("\n");
    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ summary }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || `AI request failed (${res.status})`);
      }
      const { text } = (await res.json()) as { text: string };
      setAiRead(key, text);
      if (matchKeyRef.current !== key) return;
      setMatchAiText(text);
      setMatchAi("done");
    } catch (e) {
      if (matchKeyRef.current !== key) return;
      setMatchAiErr(e instanceof Error ? e.message : "failed");
      setMatchAi("error");
    }
  };

  if (players.length === 0) {
    return <div className="card-2 px-4 py-6 text-sm text-muted">No player data in this scope.</div>;
  }

  const lobbyRead =
    flaggedCount === 0
      ? "No standout aim anomalies — this lobby reads clean"
      : `${flaggedCount} player${flaggedCount > 1 ? "s" : ""} worth a closer look`;

  return (
    <div className="lg:flex lg:h-full lg:min-h-0 lg:flex-col">
      {/* lobby verdict header */}
      <div className="mb-3 flex flex-col gap-2 rounded-lg border border-line bg-panel/40 px-4 py-2.5 lg:mb-2 lg:shrink-0 lg:flex-row lg:items-center lg:px-3 lg:py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: flaggedCount ? BAND_HEX[players[0].cheat.band] : "#46d369" }}
            />
            <span className="text-sm font-bold">{lobbyRead}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted">
            CheatMeter scores aim anomalies (snap kills, accuracy, reaction) and information anomalies
            (rotations before any info existed) — never fragging volume. Pick a player for their case file;
            ▶ a moment to watch it. Signals from public data — not proof.
          </p>
          <div className="mt-1 flex items-center gap-1.5 text-[10px]">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                !rotReport.available ? "bg-faint/40" : rotTotals.bc ? "bg-bad" : "bg-good"
              }`}
            />
            <span className="min-w-0 truncate text-faint" title="Cross-map rotations vs. the information that could justify them — the radar-hack read">
              {!rotReport.available
                ? `Rotation read unavailable — ${rotReport.reason}.`
                : rotTotals.total === 0
                  ? "Rotation read: no cross-map rotations this match."
                  : `Rotation read: ${rotTotals.total} rotation${rotTotals.total > 1 ? "s" : ""} analyzed · ${
                      rotTotals.bc
                        ? `${rotTotals.bc} began before any info — review in the case files`
                        : "every one followed real information"
                    }`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={() => setCheckAll(true)}
            disabled={checkAll}
            title="Run the Smurf/Boosted/Trust account check for every player"
            className="rounded-md border border-line px-2.5 py-1 text-[11px] font-medium text-muted transition hover:bg-panel/60 hover:text-ink disabled:opacity-50"
          >
            {checkAll ? "Checks queued ✓" : "Check all accounts"}
          </button>
          <button
            type="button"
            onClick={runMatchAi}
            disabled={matchAi === "loading"}
            title="One AI write-up for the whole lobby"
            className="rounded-md border border-brand/40 bg-brand/10 px-2.5 py-1 text-[11px] font-semibold text-brand transition hover:bg-brand/20 disabled:opacity-50"
          >
            {matchAi === "loading" ? "Analysing…" : "✨ AI match read"}
          </button>
        </div>
      </div>

      {matchAiOpen && matchAi !== "idle" && (
        <div className="scroll-slim mb-3 rounded-lg border border-brand/30 bg-brand/5 px-4 py-2.5 lg:mb-2 lg:max-h-36 lg:shrink-0 lg:overflow-y-auto lg:px-3 lg:py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="stat-label">AI match read</span>
            <button type="button" onClick={() => setMatchAiOpen(false)} className="text-xs text-faint transition hover:text-ink">
              ✕
            </button>
          </div>
          {matchAi === "loading" && <div className="mt-1 text-[11px] text-faint">Reading the lobby…</div>}
          {matchAi === "error" && <div className="mt-1 text-[11px] text-bad">AI couldn&apos;t run — {matchAiErr}</div>}
          {matchAi === "done" && <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-muted">{matchAiText}</p>}
        </div>
      )}

      {/* leaderboard | case file */}
      <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] lg:gap-3">
        <div className="card-2 flex flex-col px-3 py-2.5 lg:min-h-0 lg:px-2.5 lg:py-2">
          <div className="mb-1.5 flex items-center justify-between lg:shrink-0">
            <span className="stat-label">Suspicion ranking</span>
            <span className="text-[10px] text-faint">aim + info anomaly ↓</span>
          </div>
          <div className="scroll-slim space-y-0.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-0.5">
            {players.map(({ p, cheat }, idx) => (
              <SuspectRow
                key={p.steamId}
                p={p}
                cheat={cheat}
                rank={idx + 1}
                selected={selected?.p.steamId === p.steamId}
                onSelect={() => setSelId(p.steamId)}
              />
            ))}
          </div>
          {teamRot && (
            <div className="mt-2 border-t border-line pt-2 lg:shrink-0">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="stat-label">Team rotation styles</span>
                <span
                  className="text-[10px] text-faint"
                  title="How each starting roster rotates: what information they respond to and how quickly they move after it appears"
                >
                  info → move
                </span>
              </div>
              <div className="space-y-1.5">
                {(() => {
                  const maxResp = Math.max(
                    teamRot.ct?.avgResponseSec ?? 0,
                    teamRot.t?.avgResponseSec ?? 0,
                    20,
                  );
                  return (
                    <>
                      {teamRot.ct && (
                        <TeamRotateRow label="CT start" hex={CT} team={teamRot.ct} fastestName={fastestName(teamRot.ct)} maxResp={maxResp} />
                      )}
                      {teamRot.t && (
                        <TeamRotateRow label="T start" hex={T} team={teamRot.t} fastestName={fastestName(teamRot.t)} maxResp={maxResp} />
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </div>

        {selected && (
          <CaseFile
            key={selected.p.steamId}
            p={selected.p}
            cheat={selected.cheat}
            rot={selected.rot}
            rotReason={rotReport.available ? undefined : rotReport.reason}
            anchors={
              rotReport.anchorA && rotReport.anchorB
                ? {
                    a: { ...rotReport.anchorA, label: rotReport.siteA },
                    b: { ...rotReport.anchorB, label: rotReport.siteB },
                  }
                : null
            }
            meta={meta}
            rounds={rounds}
            view={view}
            demoId={demoId}
            autoRunAccount={checkAll}
            onWatch={onWatch}
          />
        )}
      </div>
    </div>
  );
}
