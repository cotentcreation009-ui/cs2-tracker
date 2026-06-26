"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { hasCalibration, radarImage } from "@/lib/maps/calibration";
import {
  loadZones,
  newZoneId,
  saveZones,
  ZONE_COLOR,
  type Zone,
  type ZoneKind,
} from "@/lib/maps/zones";
import { mapLabel } from "@/lib/format";

const SIZE = 720;
const POOL = [
  "de_dust2", "de_mirage", "de_inferno", "de_nuke", "de_overpass",
  "de_ancient", "de_anubis", "de_vertigo", "de_train", "de_cache",
];
const KINDS: ZoneKind[] = ["A", "B", "Mid", "other"];

export default function ZonesPage() {
  const [map, setMap] = useState(POOL[0]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<{ x: number; y: number }[]>([]);
  const [naming, setNaming] = useState(false);
  const [pName, setPName] = useState("");
  const [pKind, setPKind] = useState<ZoneKind>("A");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const imgOk = useRef(false);

  useEffect(() => {
    setZones(loadZones(map));
    setDrafting(false);
    setDraft([]);
    setNaming(false);
  }, [map]);

  const redraw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    if (imgOk.current && imgRef.current) {
      ctx.drawImage(imgRef.current, 0, 0, SIZE, SIZE);
    } else {
      ctx.fillStyle = "#0a1020";
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.strokeStyle = "rgba(56,214,255,0.07)";
      for (let g = 0; g <= SIZE; g += SIZE / 16) {
        ctx.beginPath();
        ctx.moveTo(g, 0);
        ctx.lineTo(g, SIZE);
        ctx.moveTo(0, g);
        ctx.lineTo(SIZE, g);
        ctx.stroke();
      }
    }
    const drawPoly = (pts: { x: number; y: number }[], color: string, fill: boolean) => {
      if (!pts.length) return;
      ctx.beginPath();
      pts.forEach((p, i) => {
        const x = p.x * SIZE;
        const y = p.y * SIZE;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (fill) {
        ctx.closePath();
        ctx.fillStyle = color + "33";
        ctx.fill();
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    };
    for (const z of zones) {
      drawPoly(z.points, ZONE_COLOR[z.kind], true);
      if (z.points.length) {
        const cx = (z.points.reduce((s, p) => s + p.x, 0) / z.points.length) * SIZE;
        const cy = (z.points.reduce((s, p) => s + p.y, 0) / z.points.length) * SIZE;
        ctx.fillStyle = "#fff";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(z.name, cx, cy);
        ctx.textAlign = "left";
      }
    }
    if (draft.length) {
      drawPoly(draft, "#38d6ff", false);
      for (const p of draft) {
        ctx.fillStyle = "#38d6ff";
        ctx.beginPath();
        ctx.arc(p.x * SIZE, p.y * SIZE, 3, 0, 7);
        ctx.fill();
      }
    }
  }, [zones, draft]);

  useEffect(() => {
    imgOk.current = false;
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      imgOk.current = true;
      redraw();
    };
    img.onerror = () => {
      imgOk.current = false;
      redraw();
    };
    img.src = radarImage(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drafting || naming) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setDraft((d) => [...d, { x, y }]);
  };

  const persist = (next: Zone[]) => {
    setZones(next);
    saveZones(map, next);
  };

  const finish = () => {
    if (draft.length < 3) return;
    setNaming(true);
  };
  const save = () => {
    const z: Zone = {
      id: newZoneId(),
      name: pName.trim() || pKind,
      kind: pKind,
      points: draft,
    };
    persist([...zones, z]);
    setDraft([]);
    setDrafting(false);
    setNaming(false);
    setPName("");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/demos" className="text-xs text-muted hover:text-ink">
            ← Demos
          </Link>
          <h1 className="text-xl font-extrabold tracking-tight">Zone editor</h1>
        </div>
        <select
          value={map}
          onChange={(e) => setMap(e.target.value)}
          className="rounded-lg border border-line bg-panel px-3 py-1.5 text-sm capitalize"
        >
          {POOL.map((m) => (
            <option key={m} value={m}>
              {mapLabel(m)}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
        <canvas
          ref={canvasRef}
          width={SIZE}
          height={SIZE}
          onClick={onClick}
          className={`aspect-square w-full max-w-[640px] rounded-xl border border-line bg-panel2 ${
            drafting ? "cursor-crosshair" : ""
          }`}
        />

        <div className="space-y-3">
          <div className="card px-4 py-3">
            {!drafting ? (
              <button
                type="button"
                onClick={() => {
                  setDrafting(true);
                  setDraft([]);
                }}
                className="btn btn-primary w-full text-sm"
              >
                + Draw a zone
              </button>
            ) : naming ? (
              <div className="space-y-2">
                <input
                  autoFocus
                  value={pName}
                  onChange={(e) => setPName(e.target.value)}
                  placeholder="Zone name (e.g. A site, Banana)"
                  className="w-full rounded-lg border border-line bg-panel px-3 py-1.5 text-sm"
                />
                <div className="flex rounded-lg border border-line bg-panel p-0.5">
                  {KINDS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setPKind(k)}
                      className={`flex-1 rounded-md px-2 py-0.5 text-xs font-medium transition ${
                        pKind === k ? "bg-brand/15 text-brand" : "text-muted hover:text-ink"
                      }`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={save} className="btn btn-primary flex-1 text-xs">
                    Save zone
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNaming(false);
                    }}
                    className="btn btn-ghost text-xs"
                  >
                    Back
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs text-muted">
                  Click the map to add points ({draft.length}).
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={finish}
                    disabled={draft.length < 3}
                    className="btn btn-primary flex-1 text-xs disabled:opacity-40"
                  >
                    Finish ({draft.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft((d) => d.slice(0, -1))}
                    className="btn btn-ghost text-xs"
                  >
                    Undo
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDrafting(false);
                      setDraft([]);
                    }}
                    className="btn btn-ghost text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="card px-4 py-3">
            <div className="stat-label mb-2">Zones · {map.replace("de_", "")}</div>
            {zones.length === 0 ? (
              <div className="text-xs text-muted">None yet.</div>
            ) : (
              <ul className="space-y-1.5">
                {zones.map((z) => (
                  <li key={z.id} className="flex items-center gap-2 text-sm">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: ZONE_COLOR[z.kind] }}
                    />
                    <span className="truncate">{z.name}</span>
                    <span className="text-xs text-faint">{z.kind}</span>
                    <button
                      type="button"
                      onClick={() => persist(zones.filter((x) => x.id !== z.id))}
                      className="ml-auto text-xs text-faint hover:text-bad"
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!hasCalibration(map) && (
            <div className="card px-4 py-3 text-xs text-mid">
              {mapLabel(map)} isn&apos;t calibrated yet — you can still draw zones,
              but position→zone classification needs calibration.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
