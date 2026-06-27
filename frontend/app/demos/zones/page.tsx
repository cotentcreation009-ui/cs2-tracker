"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hasCalibration, radarImage } from "@/lib/maps/calibration";
import {
  allZoneSets,
  defaultZoneSet,
  loadActiveSetId,
  loadCustomSets,
  newZoneId,
  saveActiveSetId,
  saveCustomSets,
  DEFAULT_SET_ID,
  ZONE_COLOR,
  type Zone,
  type ZoneKind,
  type ZoneSet,
} from "@/lib/maps/zones";
import { mapLabel } from "@/lib/format";

const SIZE = 720;
const POOL = [
  "de_dust2", "de_mirage", "de_inferno", "de_nuke", "de_overpass",
  "de_ancient", "de_anubis", "de_vertigo", "de_train", "de_cache",
];
const KINDS: ZoneKind[] = ["A", "B", "Mid", "other"];
type Tool = "none" | "anchor" | "polygon";

export default function ZonesPage() {
  const [map, setMap] = useState(POOL[0]);
  const [sets, setSets] = useState<ZoneSet[]>([]);
  const [activeId, setActiveId] = useState<string>(DEFAULT_SET_ID);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("none");
  const [draft, setDraft] = useState<{ x: number; y: number }[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const imgOk = useRef(false);

  useEffect(() => {
    setSets(loadCustomSets(map));
    setActiveId(loadActiveSetId(map));
    setEditingId(null);
    setTool("none");
    setDraft([]);
  }, [map]);

  const defaults = useMemo(() => defaultZoneSet(map), [map]);
  const editing = editingId ? sets.find((s) => s.id === editingId) ?? null : null;
  const shown = editing ? editing.zones : allZoneSets(map).find((s) => s.id === activeId)?.zones ?? defaults.zones;

  const persist = useCallback((next: ZoneSet[]) => {
    setSets(next);
    saveCustomSets(map, next);
  }, [map]);

  const updateEditing = (zones: Zone[]) => {
    if (!editingId) return;
    persist(sets.map((s) => (s.id === editingId ? { ...s, zones } : s)));
  };

  const makeActive = (id: string) => {
    setActiveId(id);
    saveActiveSetId(map, id);
  };

  const newFromDefault = () => {
    const id = newZoneId();
    const set: ZoneSet = {
      id,
      name: "My callouts",
      zones: defaults.zones.map((z) => ({ ...z, id: newZoneId(), points: z.points.map((p) => ({ ...p })) })),
    };
    persist([...sets, set]);
    setEditingId(id);
    makeActive(id);
  };
  const newEmpty = () => {
    const id = newZoneId();
    persist([...sets, { id, name: "New set", zones: [] }]);
    setEditingId(id);
    makeActive(id);
  };
  const deleteSet = (id: string) => {
    persist(sets.filter((s) => s.id !== id));
    if (editingId === id) setEditingId(null);
    if (activeId === id) makeActive(DEFAULT_SET_ID);
  };
  const renameSet = (id: string, name: string) =>
    persist(sets.map((s) => (s.id === id ? { ...s, name } : s)));

  // --- canvas ---
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
        ctx.moveTo(g, 0); ctx.lineTo(g, SIZE);
        ctx.moveTo(0, g); ctx.lineTo(SIZE, g);
        ctx.stroke();
      }
    }

    for (const z of shown) {
      const col = ZONE_COLOR[z.kind] ?? "#8a7dff";
      if (z.points.length >= 3) {
        ctx.beginPath();
        z.points.forEach((p, i) => {
          const x = p.x * SIZE, y = p.y * SIZE;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fillStyle = col + "26";
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (z.points.length === 1) {
        const p = z.points[0];
        ctx.beginPath();
        ctx.arc(p.x * SIZE, p.y * SIZE, 5, 0, 7);
        ctx.fillStyle = col;
        ctx.fill();
        ctx.strokeStyle = "#04060e";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      const cx = (z.points.reduce((s, p) => s + p.x, 0) / z.points.length) * SIZE;
      const cy = (z.points.reduce((s, p) => s + p.y, 0) / z.points.length) * SIZE;
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      ctx.strokeText(z.name, cx, cy - 8);
      ctx.fillStyle = "#fff";
      ctx.fillText(z.name, cx, cy - 8);
      ctx.textAlign = "left";
    }

    if (draft.length) {
      ctx.beginPath();
      draft.forEach((p, i) => {
        const x = p.x * SIZE, y = p.y * SIZE;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = "#38d6ff";
      ctx.lineWidth = 2;
      ctx.stroke();
      for (const p of draft) {
        ctx.beginPath();
        ctx.arc(p.x * SIZE, p.y * SIZE, 3, 0, 7);
        ctx.fillStyle = "#38d6ff";
        ctx.fill();
      }
    }
  }, [shown, draft]);

  useEffect(() => {
    imgOk.current = false;
    const img = new Image();
    img.onload = () => { imgRef.current = img; imgOk.current = true; redraw(); };
    img.onerror = () => { imgOk.current = false; redraw(); };
    img.src = radarImage(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  useEffect(() => { redraw(); }, [redraw]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!editing || tool === "none") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (tool === "anchor") {
      updateEditing([
        ...editing.zones,
        { id: newZoneId(), name: `Zone ${editing.zones.length + 1}`, kind: "other", points: [{ x, y }] },
      ]);
    } else {
      setDraft((d) => [...d, { x, y }]);
    }
  };
  const finishPolygon = () => {
    if (!editing || draft.length < 3) return;
    updateEditing([
      ...editing.zones,
      { id: newZoneId(), name: `Zone ${editing.zones.length + 1}`, kind: "other", points: draft },
    ]);
    setDraft([]);
    setTool("none");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/demos" className="text-xs text-muted hover:text-ink">← Demos</Link>
          <h1 className="text-xl font-extrabold tracking-tight">Call-out zones</h1>
          <p className="text-xs text-muted">
            Built-in callouts ship for every map. Make your own set (in your language) or draw one from scratch — the active set labels positions &amp; utility everywhere.
          </p>
        </div>
        <select
          value={map}
          onChange={(e) => setMap(e.target.value)}
          className="rounded-lg border border-line bg-panel px-3 py-1.5 text-sm capitalize"
        >
          {POOL.map((m) => <option key={m} value={m}>{mapLabel(m)}</option>)}
        </select>
      </div>

      <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
        <canvas
          ref={canvasRef}
          width={SIZE}
          height={SIZE}
          onClick={onClick}
          className={`aspect-square w-full max-w-160 rounded-xl border border-line bg-panel2 ${
            editing && tool !== "none" ? "cursor-crosshair" : ""
          }`}
        />

        <div className="space-y-3">
          {!editing ? (
            <>
              {/* set picker */}
              <div className="card px-4 py-3">
                <div className="stat-label mb-2">Active set</div>
                <div className="space-y-1.5">
                  <SetRow
                    name={`${defaults.name} (${defaults.zones.length})`}
                    active={activeId === DEFAULT_SET_ID}
                    onActivate={() => makeActive(DEFAULT_SET_ID)}
                    onEdit={newFromDefault}
                    editLabel="Duplicate to edit"
                  />
                  {sets.map((s) => (
                    <SetRow
                      key={s.id}
                      name={`${s.name} (${s.zones.length})`}
                      active={activeId === s.id}
                      onActivate={() => makeActive(s.id)}
                      onEdit={() => setEditingId(s.id)}
                      onDelete={() => deleteSet(s.id)}
                      editLabel="Edit"
                    />
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={newFromDefault} className="btn btn-primary flex-1 text-xs">
                    + New from default
                  </button>
                  <button type="button" onClick={newEmpty} className="btn btn-ghost flex-1 text-xs">
                    + Empty set
                  </button>
                </div>
              </div>
              {!hasCalibration(map) && (
                <div className="card px-4 py-3 text-xs text-mid">
                  {mapLabel(map)} isn&apos;t calibrated — you can draw zones, but position→zone
                  classification needs calibration.
                </div>
              )}
            </>
          ) : (
            <>
              {/* editing a set */}
              <div className="card px-4 py-3">
                <div className="mb-2 flex items-center gap-2">
                  <input
                    value={editing.name}
                    onChange={(e) => renameSet(editing.id, e.target.value)}
                    className="flex-1 rounded-lg border border-line bg-panel px-2.5 py-1 text-sm font-semibold"
                  />
                  <button type="button" onClick={() => { setEditingId(null); setTool("none"); setDraft([]); }} className="btn btn-ghost text-xs">
                    Done
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => { setTool(tool === "anchor" ? "none" : "anchor"); setDraft([]); }}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${tool === "anchor" ? "border-brand/50 bg-brand/15 text-brand" : "border-line text-muted hover:text-ink"}`}
                  >
                    + Anchor (click)
                  </button>
                  <button
                    type="button"
                    onClick={() => { setTool(tool === "polygon" ? "none" : "polygon"); setDraft([]); }}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${tool === "polygon" ? "border-brand/50 bg-brand/15 text-brand" : "border-line text-muted hover:text-ink"}`}
                  >
                    Draw polygon
                  </button>
                  {tool === "polygon" && (
                    <>
                      <button type="button" onClick={finishPolygon} disabled={draft.length < 3} className="btn btn-primary text-xs disabled:opacity-40">Finish ({draft.length})</button>
                      <button type="button" onClick={() => setDraft((d) => d.slice(0, -1))} className="btn btn-ghost text-xs">Undo</button>
                    </>
                  )}
                  {activeId !== editing.id && (
                    <button type="button" onClick={() => makeActive(editing.id)} className="btn btn-ghost text-xs">Make active</button>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-faint">
                  {tool === "anchor" ? "Click the map to drop a named point." : tool === "polygon" ? "Click points, then Finish." : "Pick a tool, or edit zones below."}
                </p>
              </div>

              <div className="card flex max-h-128 flex-col px-4 py-3">
                <div className="stat-label mb-2">Zones ({editing.zones.length})</div>
                {editing.zones.length === 0 ? (
                  <div className="text-xs text-muted">None yet — add an anchor or draw a polygon.</div>
                ) : (
                  <div className="flex-1 space-y-1 overflow-y-auto pr-1">
                    {editing.zones.map((z) => (
                      <div key={z.id} className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ZONE_COLOR[z.kind] }} />
                        <input
                          value={z.name}
                          onChange={(e) => updateEditing(editing.zones.map((x) => (x.id === z.id ? { ...x, name: e.target.value } : x)))}
                          className="min-w-0 flex-1 rounded border border-line bg-panel px-2 py-0.5 text-xs"
                        />
                        <select
                          value={z.kind}
                          onChange={(e) => updateEditing(editing.zones.map((x) => (x.id === z.id ? { ...x, kind: e.target.value as ZoneKind } : x)))}
                          className="rounded border border-line bg-panel px-1 py-0.5 text-[11px]"
                        >
                          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                        </select>
                        <span className="text-[10px] text-faint">{z.points.length === 1 ? "pt" : "poly"}</span>
                        <button type="button" onClick={() => updateEditing(editing.zones.filter((x) => x.id !== z.id))} className="text-xs text-faint hover:text-bad">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SetRow({
  name,
  active,
  onActivate,
  onEdit,
  onDelete,
  editLabel,
}: {
  name: string;
  active: boolean;
  onActivate: () => void;
  onEdit: () => void;
  onDelete?: () => void;
  editLabel: string;
}) {
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${active ? "border-brand/50 bg-brand/5" : "border-line"}`}>
      <button type="button" onClick={onActivate} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${active ? "border-brand" : "border-line2"}`}>
          {active && <span className="h-2 w-2 rounded-full bg-brand" />}
        </span>
        <span className="truncate text-sm">{name}</span>
        {active && <span className="ml-auto shrink-0 text-[10px] font-bold uppercase tracking-wider text-brand">active</span>}
      </button>
      <button type="button" onClick={onEdit} className="shrink-0 text-[11px] text-muted hover:text-ink">{editLabel}</button>
      {onDelete && <button type="button" onClick={onDelete} className="shrink-0 text-[11px] text-faint hover:text-bad">delete</button>}
    </div>
  );
}
