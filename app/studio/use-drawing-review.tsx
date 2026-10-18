"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { DecodedDwg } from "./decode-dwg.ts";
import { dwgSectionSvg, entitiesWithin, type DwgBounds } from "../../lib/reviter/dwg-plan.ts";
import { downloadBlob } from "../../lib/reviter/export-naming.ts";
import { DrawingSnapIndex, constrainedPoint, drawingPointAt, type DrawingPoint, type SnapKind } from "./drawing-precision.ts";
import { dimensionLabel, type DimensionMode, type ReviewDimension } from "./review-session.ts";
import { useReviewSession } from "./use-review-session.ts";
import { CommandPalette } from "./CommandPalette.tsx";
import { executeCommand, isEditingTarget, type StudioCommand } from "./commands.ts";

const xml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[character]!));
export function drawingAnnotationSvg(dimensions: readonly ReviewDimension[], bounds: DwgBounds): string {
  const size = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 80;
  return `<g class="review-dimensions" fill="none" stroke="#007a98" stroke-width="${size / 15}" font-family="system-ui,sans-serif" font-size="${size}">${dimensions.filter(d => d.source === "drawing").map(d => {
    const points = d.points.map(p => `${p[0]},${-p[1]}`).join(" ");
    const at = d.points.reduce((sum, p) => [sum[0]! + p[0] / d.points.length, sum[1]! - p[1] / d.points.length], [0, 0]);
    return `<${d.mode === "area" || d.mode === "perimeter" ? "polygon" : "polyline"} points="${points}"/><text x="${at[0]}" y="${at[1]! - size / 2}" stroke="none" fill="#007a98" text-anchor="middle">${xml(dimensionLabel(d))}</text>`;
  }).join("")}</g>`;
}

export function useDrawingReview(file: File, drawing: DecodedDwg | null, bounds: DwgBounds | undefined, sheetId: string, extraCommands: StudioCommand[] = []) {
  const review = useReviewSession(file);
  const [mode, setMode] = useState<DimensionMode | "off">("off");
  const [pending, setPending] = useState<DrawingPoint[]>([]);
  const [preview, setPreview] = useState<{ point: DrawingPoint; kind: string } | null>(null);
  const [hiddenLayers, setHiddenLayers] = useState<ReadonlySet<string>>(new Set());
  const [history, setHistory] = useState<ReadonlySet<string>[]>([]);
  const [filter, setFilter] = useState("");
  const [snapModes, setSnapModes] = useState<ReadonlySet<SnapKind>>(new Set(["endpoint", "midpoint", "centre"]));
  const [constraint, setConstraint] = useState<"free" | "ortho" | "polar">("free");
  const [unit, setUnit] = useState<"feet" | "metres" | "drawing">("feet");
  const [unitChoice, setUnitChoice] = useState("file");
  const [numeric, setNumeric] = useState({ x: "", y: "", length: "", angle: "0" });
  const [message, setMessage] = useState("");
  const [undo, setUndo] = useState<ReviewDimension[][]>([]);
  const [redo, setRedo] = useState<ReviewDimension[][]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [style, setStyle] = useState<Record<string, { color: string; opacity: number }>>({});
  const unitFactors: Record<string, number> = { feet: 1, inches: 1 / 12, millimetres: 1 / 304.8, metres: 1 / 0.3048 };
  const feetPerUnit = unitChoice === "file" ? drawing?.feetPerUnit ?? null : unitFactors[unitChoice] ?? null;
  useEffect(() => { queueMicrotask(() => { setPending([]); setPreview(null); }); }, [sheetId]);
  useEffect(() => {
    queueMicrotask(() => { setHiddenLayers(new Set()); setHistory([]); setStyle({}); setUnitChoice("file"); setUndo([]); setRedo([]); setPending([]); setMode("off"); });
  }, [file]);
  const layerNames = useMemo(() => [...new Set([...(drawing?.layerNames ?? []), ...(drawing?.entities.map(e => e.layer) ?? [])])].sort(), [drawing]);
  const within = useMemo(() => drawing && bounds ? entitiesWithin(drawing.entities, bounds) : [], [drawing, bounds]);
  const index = useMemo(() => bounds ? new DrawingSnapIndex(within, bounds) : null, [within, bounds]);
  const visible = useMemo(() => within.filter(entity => !hiddenLayers.has(entity.layer)), [within, hiddenLayers]);
  const svg = useMemo(() => {
    if (!bounds || !drawing) return undefined;
    const rendered = dwgSectionSvg(visible, bounds);
    const selector = (layer: string) => layer.replace(/[^a-zA-Z0-9_-]/g, character => `\\${character.codePointAt(0)!.toString(16)} `);
    const rules = Object.entries(style).map(([layer, value]) => `[data-dwg-layer="${selector(layer)}"]{stroke:${value.color};opacity:${value.opacity}}.dwg-text [data-dwg-layer="${selector(layer)}"]{fill:${value.color};stroke:none}`).join("");
    return rendered.replace("</svg>", `<style>${rules}</style></svg>`);
  }, [visible, bounds, drawing, style]);
  const changeDimensions = useCallback((next: ReviewDimension[]) => {
    if (!review.session) { setMessage("Source identity is still being checked."); return; }
    try {
      review.update(value => ({ ...value, dimensions: next }));
      setUndo(current => [...current.slice(-29), review.session!.dimensions]); setRedo([]);
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : String(caught)); }
  }, [review]);
  const dimensions = review.session?.dimensions ?? [];
  const commit = (points: readonly DrawingPoint[], currentMode = mode) => {
    if (currentMode === "off") return;
    const record: ReviewDimension = { id: crypto.randomUUID(), mode: currentMode, points: points.map(p => [p[0], p[1], 0]),
      space: "drawing-units", source: "drawing", unit: feetPerUnit === null ? "drawing" : unit,
      feetPerUnit, calibration: 1, provenance: "Recovered DWG linework · fixed review anchors", createdAt: new Date().toISOString() };
    changeDimensions([...dimensions, record]); setPending([]); setPreview(null); setMessage(`Saved ${currentMode}: ${dimensionLabel(record)}.`);
  };
  const addPoint = (point: DrawingPoint) => {
    if (mode === "off") return;
    const next = [...pending, point];
    const needed = mode === "coordinates" ? 1 : mode === "angle" ? 3 : mode === "area" || mode === "perimeter" ? Infinity : 2;
    if (next.length === needed) { commit(next); }
    else setPending(next);
  };
  const setTool = (tool: DimensionMode | "off") => { setMode(tool); setPending([]); setPreview(null); };
  const remember = () => setHistory(current => [...current.slice(-29), new Set(hiddenLayers)]);
  const restoreVisibility = () => { const previous = history.at(-1); if (previous) { setHiddenLayers(previous); setHistory(current => current.slice(0, -1)); } };
  const toggleLayer = (name: string) => { remember(); setHiddenLayers(current => { const next = new Set(current); if (!next.delete(name)) next.add(name); return next; }); };
  const findPoint = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!bounds) return null;
    const at = drawingPointAt([event.clientX, event.clientY], event.currentTarget.getBoundingClientRect(), bounds);
    if (!at) return null;
    const snap = event.altKey ? null : index?.snap(at.point, at.unitsPerPixel * 12, snapModes, hiddenLayers);
    const base = snap?.point ?? at.point;
    const point = pending.length ? constrainedPoint(pending.at(-1)!, base, constraint) : base;
    const constrained = point[0] !== base[0] || point[1] !== base[1];
    return { point, kind: constrained ? constraint : snap?.kind ?? "free point" };
  };
  const pointerStart = useRef<DrawingPoint | null>(null);
  const commands: StudioCommand[] = [
    ...extraCommands,
    ...(["distance", "angle", "area", "perimeter", "coordinates"] as DimensionMode[]).map(tool => ({ id: `drawing.${tool}`, label: `Measure ${tool}`, run: () => setTool(tool) })),
    { id: "drawing.cancel", label: "Cancel drawing measurement", run: () => setTool("off") },
    { id: "drawing.restore", label: "Restore previous layer visibility", reason: history.length ? null : "No previous layer state", run: restoreVisibility },
    { id: "drawing.showAll", label: "Show all layers", run: () => { remember(); setHiddenLayers(new Set()); } },
    { id: "review.export", label: "Export drawing dimensions", reason: review.session ? null : "Source identity is still being checked", run: () => downloadBlob(new Blob([JSON.stringify(review.session, null, 2)], { type: "application/json" }), `${file.name}.review.json`) },
  ];
  const commandRef = useRef(commands);
  useEffect(() => { commandRef.current = commands; });
  const run = useCallback(async (id: string, argument = "") => {
    try { const label = await executeCommand(commandRef.current, id, argument); setMessage(`${label} complete.`); return true; }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : String(caught)); return false; }
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (isEditingTarget(event.target)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen(value => !value); }
      if (event.key === "Escape") { event.preventDefault(); setMode("off"); setPending([]); setPreview(null); }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, []);
  const size = bounds ? Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 80 : 1;
  const overlay = bounds ? <svg className={`dwg-precision-overlay${mode === "off" ? "" : " measuring"}`} aria-label="Drawing measurement surface"
    viewBox={`${bounds.minX} ${-bounds.maxY} ${bounds.maxX - bounds.minX} ${bounds.maxY - bounds.minY}`} preserveAspectRatio="xMidYMid meet"
    onPointerMove={event => { if (mode !== "off") setPreview(findPoint(event)); }} onPointerLeave={() => setPreview(null)}
    onPointerDown={event => { if (event.button === 0 && mode !== "off") { pointerStart.current = [event.clientX, event.clientY]; event.currentTarget.setPointerCapture(event.pointerId); } }}
    onPointerUp={event => {
      const start = pointerStart.current; pointerStart.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (start && Math.hypot(event.clientX - start[0], event.clientY - start[1]) < 6 && mode !== "off") { const point = findPoint(event); if (point) addPoint(point.point); }
    }} onPointerCancel={() => { pointerStart.current = null; }}>
    <g fill="none" stroke="#007a98" strokeWidth={size / 15} fontSize={size} fontFamily="system-ui,sans-serif">
      {dimensions.map(d => {
        const at = d.points.reduce((sum, p) => [sum[0]! + p[0] / d.points.length, sum[1]! - p[1] / d.points.length], [0, 0]);
        const points = d.points.map(p => `${p[0]},${-p[1]}`).join(" ");
        return <g key={d.id}>{d.mode === "area" || d.mode === "perimeter" ? <polygon points={points} /> : <polyline points={points} />}<text x={at[0]} y={at[1]! - size / 2} fill="#007a98" stroke="none" textAnchor="middle">{dimensionLabel(d)}</text></g>;
      })}
      <polyline points={[...pending, ...(preview ? [preview.point] : [])].map(p => `${p[0]},${-p[1]}`).join(" ")} strokeDasharray={`${size / 3} ${size / 4}`} />
      {pending.map((p, i) => <circle key={i} cx={p[0]} cy={-p[1]} r={size / 5} fill="#007a98" />)}
      {preview && <rect x={preview.point[0] - size / 4} y={-preview.point[1] - size / 4} width={size / 2} height={size / 2} stroke="#e56a00" />}
    </g>
  </svg> : null;
  const controls = <div className="drawing-review-tools">
    {paletteOpen && <CommandPalette message={message} commands={commands} onRun={run} onClose={() => setPaletteOpen(false)} />}
    <div className="review-quick-actions">
      <button type="button" onClick={() => setPaletteOpen(true)}>Commands <kbd>Ctrl/⌘ K</kbd></button>
      <label>Measure<select aria-label="Drawing measurement mode" value={mode} disabled={!drawing || !review.session} onChange={event => { const next = event.target.value as typeof mode; void run(next === "off" ? "drawing.cancel" : `drawing.${next}`); }}>
        <option value="off">Off</option><option value="distance">Distance</option><option value="angle">Angle</option><option value="area">Area</option><option value="perimeter">Perimeter</option><option value="coordinates">Coordinates</option>
      </select></label>
      <label>Drawing units<select aria-label="Drawing units" value={unitChoice} onChange={event => { setUnitChoice(event.target.value); setPending([]); }}>
        <option value="file">{drawing?.feetPerUnit ? "From file" : "Unspecified in file"}</option><option value="feet">Feet</option><option value="inches">Inches</option><option value="millimetres">Millimetres</option><option value="metres">Metres</option>
      </select></label>
      <label>Display<select aria-label="Dimension display units" value={unit} onChange={event => setUnit(event.target.value as typeof unit)}><option value="feet">Feet</option><option value="metres">Metres</option></select></label>
      <button type="button" onClick={() => { void run("drawing.restore"); }} disabled={!history.length}>Restore layers</button>
      <button type="button" onClick={() => { void run("drawing.showAll"); }}>Show all layers</button>
    </div>
    {mode !== "off" && <div className="drawing-precision-options">
      <span>{mode} · {pending.length} anchors · {preview?.kind ?? "Pick a point"} · {feetPerUnit ? "declared units" : "drawing units only"}</span>
      {(["endpoint", "midpoint", "centre", "intersection", "nearest"] as SnapKind[]).map(kind => <label key={kind}><input type="checkbox" checked={snapModes.has(kind)} onChange={() => setSnapModes(current => { const next = new Set(current); if (!next.delete(kind)) next.add(kind); return next; })} />{kind}</label>)}
      <label>Constraint<select aria-label="Drawing constraint" value={constraint} onChange={event => setConstraint(event.target.value as typeof constraint)}><option value="free">Free</option><option value="ortho">Ortho</option><option value="polar">Polar 45°</option></select></label>
      {(mode === "area" || mode === "perimeter") && <button type="button" disabled={pending.length < 3} onClick={() => { commit(pending); }}>Finish polygon</button>}
      <button type="button" onClick={() => { setPending([]); setPreview(null); }}>Restart anchors</button>
      <small>12 px snap radius · Alt bypass · recovered geometry · fixed anchors</small>
      <form className="review-actions" onSubmit={event => { event.preventDefault(); const x = Number(numeric.x), y = Number(numeric.y); if (numeric.x.trim() && numeric.y.trim() && Number.isFinite(x) && Number.isFinite(y)) addPoint([x, y]); }}>
        <label>X<input aria-label="Drawing anchor X" type="number" step="any" required value={numeric.x} onChange={event => setNumeric(current => ({ ...current, x: event.target.value }))} /></label>
        <label>Y<input aria-label="Drawing anchor Y" type="number" step="any" required value={numeric.y} onChange={event => setNumeric(current => ({ ...current, y: event.target.value }))} /></label>
        <button type="submit">Add coordinate</button><small>Original drawing units</small>
      </form>
      {pending.length > 0 && <form className="review-actions" onSubmit={event => {
        event.preventDefault(); const length = Number(numeric.length), angle = Number(numeric.angle) * Math.PI / 180;
        if (!(length > 0 && Number.isFinite(length) && Number.isFinite(angle))) return;
        const raw = feetPerUnit ? length * (unit === "metres" ? 1 / 0.3048 : 1) / feetPerUnit : length, anchor = pending.at(-1)!;
        addPoint([anchor[0] + raw * Math.cos(angle), anchor[1] + raw * Math.sin(angle)]);
      }}>
        <label>Distance ({feetPerUnit ? unit : "drawing units"})<input aria-label="Numeric drawing distance" type="number" min="0.000000001" step="any" required value={numeric.length} onChange={event => setNumeric(current => ({ ...current, length: event.target.value }))} /></label>
        <label>Angle °<input aria-label="Numeric drawing angle" type="number" step="any" required value={numeric.angle} onChange={event => setNumeric(current => ({ ...current, angle: event.target.value }))} /></label><button type="submit">Add distance</button>
      </form>}
    </div>}
    <details><summary>Layers & saved dimensions ({dimensions.length})</summary><div className="drawing-review-grid">
      <section aria-label="Drawing layer manager"><h3>Layers</h3><input type="search" aria-label="Search drawing layers" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Search layers" />
        <div className="review-scroll">{layerNames.filter(name => name.toLowerCase().includes(filter.toLowerCase())).map(name => <div className="review-list-row" key={name}>
          <label><input type="checkbox" checked={!hiddenLayers.has(name)} onChange={() => toggleLayer(name)} />{name}</label>
          <button type="button" onClick={() => { remember(); setHiddenLayers(new Set(layerNames.filter(layer => layer !== name))); }}>Isolate</button>
          <input type="color" aria-label={`Display colour for ${name}`} value={style[name]?.color ?? "#111827"} onChange={event => setStyle(current => ({ ...current, [name]: { color: event.target.value, opacity: current[name]?.opacity ?? 1 } }))} />
          <input type="range" aria-label={`Display opacity for ${name}`} min="0.1" max="1" step="0.1" value={style[name]?.opacity ?? 1} onChange={event => setStyle(current => ({ ...current, [name]: { color: current[name]?.color ?? "#111827", opacity: Number(event.target.value) } }))} />
        </div>)}</div>
      </section>
      <section aria-label="Drawing dimensions"><h3>Dimensions</h3>
        <div className="review-actions"><button type="button" disabled={!undo.length} onClick={() => { const previous = undo.at(-1)!; setUndo(current => current.slice(0, -1)); setRedo(current => [...current, dimensions]); review.update(value => ({ ...value, dimensions: previous })); }}>Undo</button>
          <button type="button" disabled={!redo.length} onClick={() => { const next = redo.at(-1)!; setRedo(current => current.slice(0, -1)); setUndo(current => [...current, dimensions]); review.update(value => ({ ...value, dimensions: next })); }}>Redo</button>
          <button type="button" disabled={!dimensions.length} onClick={() => changeDimensions([])}>Clear dimensions</button>
          <button type="button" disabled={!review.session} onClick={() => { void run("review.export"); }}>Export dimensions</button>
          <label className="review-file-button">Import dimensions<input type="file" accept=".json" disabled={!review.session} onChange={event => {
            const selected = event.target.files?.[0]; event.target.value = "";
            if (selected) void (async () => { try { if (selected.size > 8 * 1024 * 1024) throw new Error("Review exceeds the 8 MB limit."); review.importReview(await selected.text()); setUndo([]); setRedo([]); setMessage("Imported drawing dimensions."); } catch (caught) { setMessage(caught instanceof Error ? caught.message : String(caught)); } })();
          }} /></label>
        </div><div className="review-scroll">{dimensions.map(d => <div className="review-list-row" key={d.id}><span>{d.mode} · {dimensionLabel(d)}<small>{d.provenance}</small></span><button type="button" onClick={() => changeDimensions(dimensions.filter(entry => entry.id !== d.id))} aria-label={`Delete dimension ${dimensionLabel(d)}`}>Delete</button></div>)}</div>
      </section>
    </div></details>
    {(message || review.message) && <p role="status" className="review-status">{message || review.message}</p>}
  </div>;
  return { run, svg, overlay, controls, feetPerUnit, dimensions, hiddenLayers, layerNames, annotations: bounds ? drawingAnnotationSvg(dimensions, bounds) : "" };
}
