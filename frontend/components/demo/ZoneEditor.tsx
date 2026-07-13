"use client";

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
  pointInPolygon,
  type Zone,
  type ZoneKind,
  type ZoneSet,
} from "@/lib/maps/zones";
import { mapLabel } from "@/lib/format";

const SIZE = 720;
const KINDS: ZoneKind[] = ["A", "B", "Mid", "other"];
type Tool = "none" | "anchor" | "polygon";

/**
 * Call-out zone viewer/editor for one map. Shows the active set's zones over
 * the radar; users can duplicate the built-in defaults (or start empty),
 * rename zones, drop anchors, draw polygons and drag points. The active set is
 * what classifyPosition labels positions & utility with everywhere.
 *
 * `fit` — render for the viewport-locked analyzer pane (map square sized by
 * pane height, editor rail scrolls internally). Without it, normal page flow
 * (the standalone /demos/zones page).
 */
export function ZoneEditor({ map, fit = false }: { map: string; fit?: boolean }) {
  const [sets, setSets] = useState<ZoneSet[]>([]);
  const [activeId, setActiveId] = useState<string>(DEFAULT_SET_ID);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("none");
  const [draft, setDraft] = useState<{ x: number; y: number }[]>([]);
  const [drag, setDrag] = useState<{ zoneId: string; idx: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const imgOk = useRef(false);
  const setsRef = useRef<ZoneSet[]>([]);
  // whole-zone move (drag a zone's interior); null unless a move is in progress
  const moveRef = useRef<{ zoneId: string; sx: number; sy: number; orig: { x: number; y: number }[][] } | null>(null);
  const movedRef = useRef(false); // distinguish a click (select) from a drag (move)
  const nameInputs = useRef(new Map<string, HTMLInputElement>());
  const focusNext = useRef(false); // true when a selection should grab the rename field

  useEffect(() => {
    setSets(loadCustomSets(map));
    setActiveId(loadActiveSetId(map));
    setEditingId(null);
    setTool("none");
    setDraft([]);
    setDrag(null);
    setSelectedId(null);
    setQuery("");
  }, [map]);

  // when a zone is selected from the MAP (or an "edit" click), scroll its list
  // row in and focus its name field. Hover-highlighting doesn't set focusNext,
  // so it only highlights and never steals focus mid-type.
  useEffect(() => {
    if (!selectedId || !focusNext.current) return;
    focusNext.current = false;
    const el = nameInputs.current.get(selectedId);
    if (el) {
      el.scrollIntoView({ block: "nearest" });
      el.focus();
      el.select();
    }
  }, [selectedId]);

  useEffect(() => {
    setsRef.current = sets;
  }, [sets]);

  const defaults = useMemo(() => defaultZoneSet(map), [map]);
  const editing = editingId ? sets.find((s) => s.id === editingId) ?? null : null;
  const shown = editing
    ? editing.zones
    : allZoneSets(map).find((s) => s.id === activeId)?.zones ?? defaults.zones;

  const persist = useCallback(
    (next: ZoneSet[]) => {
      setSets(next);
      saveCustomSets(map, next);
    },
    [map],
  );

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

  // One-click "edit this callout": jump straight into editing with a zone
  // selected. If the active set is the read-only default, fork it first (so the
  // user never has to think about "duplicate to edit"); then select the zone by
  // name so its rename field is focused.
  const editZoneByName = (zoneName: string) => {
    focusNext.current = !!zoneName;
    if (activeId !== DEFAULT_SET_ID) {
      const set = sets.find((s) => s.id === activeId);
      if (set) {
        setEditingId(activeId);
        setSelectedId(set.zones.find((z) => z.name === zoneName)?.id ?? null);
        return;
      }
    }
    // fork the default into an editable set
    const id = newZoneId();
    const zones = defaults.zones.map((z) => ({ ...z, id: newZoneId(), points: z.points.map((p) => ({ ...p })) }));
    persist([...sets, { id, name: "My callouts", zones }]);
    makeActive(id);
    setEditingId(id);
    setSelectedId(zones.find((z) => z.name === zoneName)?.id ?? null);
  };

  // smallest polygon (or nearest anchor within grab radius) under a point
  const hitZone = (nx: number, ny: number): string | null => {
    if (!editing) return null;
    let best: string | null = null;
    let bestArea = Infinity;
    for (const z of editing.zones) {
      if (z.points.length >= 3 && pointInPolygon({ x: nx, y: ny }, z.points)) {
        let a = 0;
        for (let i = 0, j = z.points.length - 1; i < z.points.length; j = i++) {
          a += (z.points[j].x + z.points[i].x) * (z.points[j].y - z.points[i].y);
        }
        a = Math.abs(a) / 2;
        if (a < bestArea) { bestArea = a; best = z.id; }
      }
    }
    if (best) return best;
    const R = 14 / SIZE;
    for (const z of editing.zones) {
      if (z.points.length === 1 && Math.abs(z.points[0].x - nx) < R && Math.abs(z.points[0].y - ny) < R) return z.id;
    }
    return null;
  };

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
      const sel = editingId != null && z.id === selectedId;
      if (z.points.length >= 3) {
        ctx.beginPath();
        z.points.forEach((p, i) => {
          const x = p.x * SIZE, y = p.y * SIZE;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fillStyle = col + (sel ? "44" : "26");
        ctx.fill();
        ctx.strokeStyle = sel ? "#fff" : col;
        ctx.lineWidth = sel ? 3.5 : 2;
        ctx.stroke();
      } else if (z.points.length === 1) {
        const p = z.points[0];
        ctx.beginPath();
        ctx.arc(p.x * SIZE, p.y * SIZE, sel ? 7 : 5, 0, 7);
        ctx.fillStyle = col;
        ctx.fill();
        ctx.strokeStyle = sel ? "#fff" : "#04060e";
        ctx.lineWidth = sel ? 2.5 : 1.5;
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

      // draggable handles while editing this set
      if (editingId) {
        for (const p of z.points) {
          ctx.beginPath();
          ctx.arc(p.x * SIZE, p.y * SIZE, 4.5, 0, 7);
          ctx.fillStyle = "#fff";
          ctx.fill();
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
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
  }, [shown, draft, editingId, selectedId]);

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

  // --- drag to reposition existing points (select mode: no tool active) ---
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const posOf = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  };
  const hitPoint = (nx: number, ny: number): { zoneId: string; idx: number } | null => {
    if (!editing) return null;
    const R = 10 / SIZE; // ~10px grab radius in normalized space
    for (const z of editing.zones) {
      for (let i = 0; i < z.points.length; i++) {
        if (Math.abs(z.points[i].x - nx) < R && Math.abs(z.points[i].y - ny) < R) {
          return { zoneId: z.id, idx: i };
        }
      }
    }
    return null;
  };
  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!editing || tool !== "none") return; // only select/drag when no draw tool is active
    const { x, y } = posOf(e);
    const hit = hitPoint(x, y);
    if (hit) {
      // grabbing a vertex reshapes; also select that zone
      setDrag(hit);
      setSelectedId(hit.zoneId);
      e.preventDefault();
      return;
    }
    const zoneId = hitZone(x, y);
    if (zoneId) {
      // click selects the zone (and focuses its rename field); dragging its
      // interior moves the whole shape
      const z = editing.zones.find((zz) => zz.id === zoneId);
      movedRef.current = false;
      moveRef.current = z ? { zoneId, sx: x, sy: y, orig: [z.points.map((p) => ({ ...p }))] } : null;
      focusNext.current = true;
      setSelectedId(zoneId);
      e.preventDefault();
    } else {
      setSelectedId(null);
    }
  };
  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // whole-zone move
    if (moveRef.current && editingId) {
      const mv = moveRef.current;
      const { x, y } = posOf(e);
      const dx = x - mv.sx;
      const dy = y - mv.sy;
      if (Math.abs(dx) > 2 / SIZE || Math.abs(dy) > 2 / SIZE) movedRef.current = true;
      const next = setsRef.current.map((s) =>
        s.id === editingId
          ? {
              ...s,
              zones: s.zones.map((z) =>
                z.id === mv.zoneId
                  ? { ...z, points: mv.orig[0].map((p) => ({ x: clamp01(p.x + dx), y: clamp01(p.y + dy) })) }
                  : z,
              ),
            }
          : s,
      );
      setsRef.current = next;
      setSets(next);
      return;
    }
    if (!drag || !editingId) return;
    const { x, y } = posOf(e);
    const cx = clamp01(x);
    const cy = clamp01(y);
    const next = setsRef.current.map((s) =>
      s.id === editingId
        ? {
            ...s,
            zones: s.zones.map((z) =>
              z.id === drag.zoneId
                ? { ...z, points: z.points.map((p, i) => (i === drag.idx ? { x: cx, y: cy } : p)) }
                : z,
            ),
          }
        : s,
    );
    setsRef.current = next;
    setSets(next); // re-render only; persist once on release
  };
  const endDrag = () => {
    if (moveRef.current) {
      if (movedRef.current) saveCustomSets(map, setsRef.current);
      moveRef.current = null;
      return;
    }
    if (!drag) return;
    saveCustomSets(map, setsRef.current);
    setDrag(null);
  };

  return (
    <div
      className={`grid gap-4 ${
        fit
          ? "lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1.25fr)_minmax(340px,1fr)] lg:items-stretch lg:gap-3"
          : "lg:grid-cols-[auto_1fr]"
      }`}
    >
      {/* map: in fit mode a size container so the square takes the pane height */}
      <div
        className={
          fit
            ? "min-w-0 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:items-center lg:justify-center lg:@container-size"
            : ""
        }
      >
        <canvas
          ref={canvasRef}
          width={SIZE}
          height={SIZE}
          onClick={onClick}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
          className={`aspect-square w-full max-w-160 rounded-xl border border-line bg-panel2 ${
            fit ? "lg:w-[min(100cqw,100cqh)] lg:max-w-none" : ""
          } ${
            editing && tool !== "none"
              ? "cursor-crosshair"
              : drag
                ? "cursor-grabbing"
                : editing
                  ? "cursor-grab"
                  : ""
          }`}
        />
      </div>

      <div
        className={`space-y-3 ${
          fit ? "scroll-slim lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:gap-2.5 lg:space-y-0 lg:overflow-y-auto" : ""
        }`}
      >
        {!editing ? (
          <>
            {/* set picker */}
            <div className="card px-4 py-3 lg:shrink-0">
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

            {/* the active zones — click any one to rename / reshape it */}
            <div className={`card flex flex-col px-4 py-3 ${fit ? "lg:min-h-0 lg:flex-1" : "max-h-128"}`}>
              <div className="mb-2 flex items-center justify-between gap-2 lg:shrink-0">
                <span className="stat-label">Call-outs ({shown.length})</span>
                <span className="text-[10px] text-faint">click one to rename</span>
              </div>
              <div className="scroll-slim flex-1 space-y-0.5 overflow-y-auto pr-1">
                {shown.map((z) => (
                  <button
                    key={z.id}
                    type="button"
                    onClick={() => editZoneByName(z.name)}
                    title={`Rename or reshape ${z.name}`}
                    className="group flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs transition hover:bg-panel/60"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ZONE_COLOR[z.kind] }} />
                    <span className="min-w-0 flex-1 truncate text-ink">{z.name}</span>
                    <span className="shrink-0 text-[10px] text-faint transition group-hover:text-brand">edit →</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 border-t border-line pt-2 text-[10px] text-faint lg:shrink-0">
                These label kills, positions &amp; utility — a smoke in a zone reads as
                &ldquo;smoked {shown[0]?.name ?? "…"}&rdquo;. Click a call-out (or{" "}
                <button type="button" onClick={() => editZoneByName("")} className="text-brand hover:underline">edit on the map</button>
                ) to change it — your copy is saved for next time.
              </p>
            </div>

            {!hasCalibration(map) && (
              <div className="card px-4 py-3 text-xs text-mid lg:shrink-0">
                {mapLabel(map)} isn&apos;t calibrated — you can draw zones, but position→zone
                classification needs calibration.
              </div>
            )}
          </>
        ) : (
          <>
            {/* editing a set */}
            <div className="card px-4 py-3 lg:shrink-0">
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
                  aria-pressed={tool === "anchor"}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${tool === "anchor" ? "border-brand/50 bg-brand/15 text-brand" : "border-line text-muted hover:text-ink"}`}
                >
                  + Anchor (click)
                </button>
                <button
                  type="button"
                  onClick={() => { setTool(tool === "polygon" ? "none" : "polygon"); setDraft([]); }}
                  aria-pressed={tool === "polygon"}
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
                {tool === "anchor"
                  ? "Click the map to drop a named point."
                  : tool === "polygon"
                    ? "Click points, then Finish."
                    : "Click a zone on the map to select it (then rename below) · drag its inside to move it · drag a white dot to reshape."}
              </p>
            </div>

            <div className={`card flex flex-col px-4 py-3 ${fit ? "lg:min-h-0 lg:flex-1" : "max-h-128"}`}>
              <div className="mb-2 flex items-center gap-2 lg:shrink-0">
                <span className="stat-label">Zones ({editing.zones.length})</span>
                {editing.zones.length > 6 && (
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search…"
                    className="ml-auto w-28 rounded border border-line bg-panel px-2 py-0.5 text-[11px]"
                  />
                )}
              </div>
              {editing.zones.length === 0 ? (
                <div className="text-xs text-muted">None yet — add an anchor or draw a polygon.</div>
              ) : (
                <div className="scroll-slim flex-1 space-y-1 overflow-y-auto pr-1">
                  {editing.zones
                    .filter((z) => !query || z.name.toLowerCase().includes(query.toLowerCase()))
                    .map((z) => (
                    <div
                      key={z.id}
                      onMouseEnter={() => setSelectedId(z.id)}
                      className={`flex items-center gap-1.5 rounded px-1 py-0.5 transition ${
                        z.id === selectedId ? "bg-brand/10 ring-1 ring-brand/40" : ""
                      }`}
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ZONE_COLOR[z.kind] }} />
                      <input
                        ref={(el) => {
                          if (el) nameInputs.current.set(z.id, el);
                          else nameInputs.current.delete(z.id);
                        }}
                        value={z.name}
                        onFocus={() => setSelectedId(z.id)}
                        onChange={(e) => updateEditing(editing.zones.map((x) => (x.id === z.id ? { ...x, name: e.target.value } : x)))}
                        className="min-w-0 flex-1 rounded border border-line bg-panel px-2 py-0.5 text-xs"
                      />
                      <select
                        value={z.kind}
                        onChange={(e) => updateEditing(editing.zones.map((x) => (x.id === z.id ? { ...x, kind: e.target.value as ZoneKind } : x)))}
                        className="rounded border border-line bg-panel px-1 py-0.5 text-[11px]"
                        title="Colour group"
                      >
                        {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                      <span className="text-[10px] text-faint">{z.points.length === 1 ? "pt" : "poly"}</span>
                      <button type="button" onClick={() => { updateEditing(editing.zones.filter((x) => x.id !== z.id)); if (selectedId === z.id) setSelectedId(null); }} title="Delete call-out" className="text-xs text-faint hover:text-bad">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
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
      <button type="button" onClick={onActivate} aria-pressed={active} className="flex min-w-0 flex-1 items-center gap-2 text-left">
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
