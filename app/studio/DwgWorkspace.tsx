"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, FolderOpen, Maximize, Minus, Plus, Printer, Shapes, X } from "lucide-react";
import { decodeDwg, type DecodedDwg } from "./decode-dwg.ts";
import { useTheme } from "./use-theme.ts";
import { DwgInspector } from "./DwgInspector.tsx";
import { dwgDisplaySvg } from "./dwg-display.ts";
import { dwgBoundsOverlap, dwgHighlightSvg } from "../../lib/reviter/dwg-inspection.ts";
import { DWG_PAPER_SIZES, dwgPrintSvg, type DwgPaperSize } from "../../lib/reviter/dwg-print.ts";

/** A drawing can be inspected on its own, without constructing a Revit model. */
export function DwgWorkspace({ files, onOpen, onClose, onTheme, themeIcon, error }: {
  files: readonly File[];
  onOpen: () => void;
  onClose: () => void;
  onTheme: () => void;
  themeIcon: ReactNode;
  error: string | null;
}) {
  const [fileIndex, setFileIndex] = useState(0);
  const file = files[fileIndex] ?? files[0]!;
  const [drawing, setDrawing] = useState<DecodedDwg | null>(null);
  const [status, setStatus] = useState("Reading the drawing…");
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState("");
  const [zoom, setZoom] = useState(1);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [matchIndex, setMatchIndex] = useState(0);
  const [showAllMatches, setShowAllMatches] = useState(true);
  const [printPreview, setPrintPreview] = useState(false);
  const [paper, setPaper] = useState<DwgPaperSize>("Tabloid");
  const [landscape, setLandscape] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const views = useRef(new Map<string, { zoom: number; left: number; top: number }>());
  const tabPrefix = useId();
  const theme = useTheme();

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const bytes = await file.arrayBuffer();
        if (controller.signal.aborted) return;
        const decoded = await decodeDwg(bytes, setStatus, controller.signal);
        if (!controller.signal.aborted) {
          setDrawing(decoded);
          setStatus(`${decoded.entityCount.toLocaleString()} entities · ${decoded.layerNames.length} layers · ${decoded.sheets.length} named plans`);
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setDecodeError(caught instanceof Error ? caught.message : "This DWG could not be read.");
        }
      }
    })();
    return () => controller.abort();
  }, [file]);

  const sheet = drawing?.sheets.find(item => String(item.id) === sheetId);
  const svg = sheet?.svg ?? drawing?.svg;
  const bounds = sheet?.bounds ?? drawing?.bounds;
  const groups = useMemo(() => bounds ? (drawing?.inspection ?? []).map(group => ({
    ...group, instances: group.instances.filter(instance => dwgBoundsOverlap(instance.bounds, bounds)),
  })).filter(group => group.instances.length > 0 && (group.kind === "block" || group.instances.length > 1)) : [], [bounds, drawing]);
  const selectedGroup = groups.find(group => group.id === selectedGroupId);
  const selectedMatch = selectedGroup?.instances[matchIndex];
  const highlightedSvg = useMemo(() => svg && selectedGroup ? dwgHighlightSvg(svg,
    showAllMatches ? selectedGroup.instances : selectedMatch ? [selectedMatch] : []) : svg, [svg, selectedGroup, selectedMatch, showAllMatches]);
  // Only the SVG's display stylesheet changes; the decoded drawing and every
  // path, label, layer and viewport retain their original coordinates.
  const displaySvg = useMemo(() => highlightedSvg ? dwgDisplaySvg(highlightedSvg, theme) : undefined, [highlightedSvg, theme]);
  const printSvg = useMemo(() => svg ? dwgPrintSvg(svg, paper, landscape) : null, [svg, paper, landscape]);
  const printUrl = useMemo(() => printSvg ? URL.createObjectURL(new Blob([printSvg], { type: "image/svg+xml" })) : null, [printSvg]);
  useEffect(() => () => { if (printUrl) URL.revokeObjectURL(printUrl); }, [printUrl]);
  const imageUrl = useMemo(() => svg
    ? URL.createObjectURL(new Blob([displaySvg!], { type: "image/svg+xml" })) : null, [svg, displaySvg]);
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl]);
  const plans = useMemo(() => [
    { id: "", name: "Whole drawing" },
    ...(drawing?.sheets.map(item => ({ id: String(item.id), name: item.name })) ?? []),
  ], [drawing]);

  useEffect(() => {
    const view = views.current.get(sheetId);
    scroll.current?.scrollTo(view?.left ?? 0, view?.top ?? 0);
    const revealSelected = () => tabs.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
    revealSelected();
    const observer = new ResizeObserver(revealSelected);
    if (tabs.current) observer.observe(tabs.current);
    return () => observer.disconnect();
  }, [sheetId, drawing]);

  const choosePlan = (id: string) => {
    if (id === sheetId) return;
    views.current.set(sheetId, { zoom, left: scroll.current?.scrollLeft ?? 0, top: scroll.current?.scrollTop ?? 0 });
    setSheetId(id);
    setSelectedGroupId(null); setMatchIndex(0);
    setZoom(views.current.get(id)?.zoom ?? 1);
  };

  const fit = () => {
    setZoom(1);
    scroll.current?.scrollTo(0, 0);
  };

  const selectGroup = (id: string | null) => {
    setSelectedGroupId(id); setMatchIndex(0); setShowAllMatches(true);
  };

  const pageDimensions = DWG_PAPER_SIZES[paper];
  const pageWidth = pageDimensions[landscape ? 1 : 0], pageHeight = pageDimensions[landscape ? 0 : 1];

  return (
    <section className="dwg-workspace" aria-label="DWG drawing viewer" data-drawing-theme={theme}>
      <header className="dwg-header">
        <strong>Reviter</strong>
        <b title={file.name}>{file.name}</b>
        <button type="button" className="rv-button" onClick={onOpen}><FolderOpen size={14} aria-hidden /> Open</button>
        <button type="button" className="rv-icon-button bordered" onClick={onTheme} aria-label="Toggle theme">{themeIcon}</button>
        <button type="button" className="rv-icon-button bordered" onClick={onClose} aria-label="Close drawing"><X size={16} aria-hidden /></button>
      </header>
      <div className="dwg-controls">
        {files.length > 1 && <label>Drawing
          <select value={fileIndex} onChange={event => {
            const nextIndex = Number(event.target.value);
            if (nextIndex === fileIndex) return;
            setFileIndex(nextIndex);
            setDrawing(null); setDecodeError(null); setSheetId("");
            setSelectedGroupId(null); setMatchIndex(0); setPrintPreview(false);
            views.current.clear();
            setStatus("Reading the drawing…"); fit();
          }}>
            {files.map((item, index) => <option key={index} value={index}>{item.name}</option>)}
          </select>
        </label>}
        {drawing && <span className="dwg-current-plan">{sheet?.name ?? "Whole drawing"}</span>}
        <button type="button" className="rv-button" disabled={!drawing} aria-pressed={inspectorOpen && !printPreview} onClick={() => { setInspectorOpen(value => printPreview || !value); setPrintPreview(false); }}><Shapes size={14} aria-hidden /> Blocks & Detect</button>
        <button type="button" className="rv-button" disabled={!drawing} aria-pressed={printPreview} onClick={() => { setPrintPreview(value => !value); setZoom(1); }}><Printer size={14} aria-hidden /> Print preview</button>
        <div className="dwg-zoom" role="group" aria-label="Drawing zoom">
          <button type="button" className="rv-icon-button bordered" aria-label="Zoom drawing out" disabled={!drawing || zoom <= 1} onClick={() => setZoom(value => Math.max(1, value / 1.5))}><Minus size={15} aria-hidden /></button>
          <output>{Math.round(zoom * 100)}%</output>
          <button type="button" className="rv-icon-button bordered" aria-label="Zoom drawing in" disabled={!drawing || zoom >= 24} onClick={() => setZoom(value => Math.min(24, value * 1.5))}><Plus size={15} aria-hidden /></button>
          <button type="button" className="rv-icon-button bordered" aria-label="Fit drawing" disabled={!drawing} onClick={fit}><Maximize size={15} aria-hidden /></button>
        </div>
      </div>
      {printPreview && <div className="dwg-print-settings" role="group" aria-label="Print settings">
        <label>Paper<select value={paper} onChange={event => setPaper(event.target.value as DwgPaperSize)}>{Object.keys(DWG_PAPER_SIZES).map(name => <option key={name}>{name}</option>)}</select></label>
        <label>Orientation<select value={landscape ? "landscape" : "portrait"} onChange={event => setLandscape(event.target.value === "landscape")}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
        <span>Fit to page · 12 mm border · selected plan</span>
        <button type="button" className="rv-button" onClick={() => window.print()}><Printer size={14} aria-hidden /> Print / Save PDF</button>
        <p>Preview uses recovered 2D linework. AutoCAD plot styles, hatches and linked content are not reproduced. Use no browser headers or extra margins when printing.</p>
      </div>}
      {(error || decodeError) && <p className="empty-error dwg-error" role="alert">{error || decodeError}</p>}
      <p className="floor-reference-status" role="status">{decodeError ? "Drawing could not be opened." : status}</p>
      <div className="dwg-view-body">
      {inspectorOpen && !printPreview && <DwgInspector groups={groups} selectedId={selectedGroupId} matchIndex={matchIndex}
        showAllMatches={showAllMatches} onAllMatches={() => setShowAllMatches(true)}
        onSelect={selectGroup} onMatch={index => { setMatchIndex(index); setShowAllMatches(false); }} onClose={() => setInspectorOpen(false)} />}
      <div ref={scroll} className={`dwg-scroll${printPreview ? " dwg-print-preview" : ""}`} aria-busy={!drawing && !decodeError}
        role={drawing ? "tabpanel" : undefined} id={`${tabPrefix}-panel`}
        aria-labelledby={drawing ? `${tabPrefix}-tab-${sheetId || "whole"}` : undefined} tabIndex={0}>
        {imageUrl && drawing ? <div className="dwg-image" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={printPreview ? printUrl! : imageUrl} alt={`${printPreview ? "Print preview · " : ""}${file.name} · ${sheet?.name ?? "Whole drawing"}`} onClick={event => {
            if (!inspectorOpen || printPreview || !bounds) return;
            const image = event.currentTarget; const rect = image.getBoundingClientRect();
            const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
            const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
            const fx = (event.clientX - rect.left - (rect.width - width) / 2) / width;
            const fy = (event.clientY - rect.top - (rect.height - height) / 2) / height;
            if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
            const x = bounds.minX + fx * (bounds.maxX - bounds.minX), y = bounds.maxY - fy * (bounds.maxY - bounds.minY);
            const hits = groups.flatMap(group => group.instances.map((instance, index) => ({ group, index, box: instance.bounds })))
              .filter(({ box }) => x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY)
              .sort((a, b) => (a.box.maxX - a.box.minX) * (a.box.maxY - a.box.minY) - (b.box.maxX - b.box.minX) * (b.box.maxY - b.box.minY));
            if (hits[0]) { setSelectedGroupId(hits[0].group.id); setMatchIndex(hits[0].index); setShowAllMatches(false); }
          }} />
        </div> : <div className="floor-browser-empty">{decodeError ? "Choose another drawing or close to return home." : "Opening your DWG…"}</div>}
      </div>
      </div>
      {printUrl && <div className="dwg-print-output">
        <style media="print">{`@page{size:${pageWidth}mm ${pageHeight}mm;margin:0}`}</style>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={printUrl} alt={`Printed plan ${sheet?.name ?? file.name}`} style={{ width: `${pageWidth}mm`, height: `${pageHeight}mm` }} />
      </div>}
      {drawing && <div className="dwg-plan-tabs">
        {plans.length > 1 && <button type="button" className="dwg-tab-scroll" aria-label="Scroll plan tabs left"
          onClick={() => tabs.current?.scrollBy({ left: -300, behavior: "smooth" })}><ChevronLeft size={16} aria-hidden /></button>}
        <div ref={tabs} className="dwg-tab-list" role="tablist" aria-label="Plans in this drawing" onKeyDown={event => {
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
          const index = buttons.indexOf(event.target as HTMLButtonElement);
          if (index < 0) return;
          const next = event.key === "ArrowRight" ? (index + 1) % buttons.length
            : event.key === "ArrowLeft" ? (index - 1 + buttons.length) % buttons.length
            : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : null;
          if (next == null) return;
          event.preventDefault();
          buttons[next]!.focus(); buttons[next]!.click();
        }}>
          {plans.map(plan => <button type="button" role="tab" key={plan.id}
            id={`${tabPrefix}-tab-${plan.id || "whole"}`} aria-controls={`${tabPrefix}-panel`}
            aria-selected={sheetId === plan.id} tabIndex={sheetId === plan.id ? 0 : -1}
            onClick={() => choosePlan(plan.id)}>{plan.name}</button>)}
        </div>
        {plans.length > 1 && <button type="button" className="dwg-tab-scroll" aria-label="Scroll plan tabs right"
          onClick={() => tabs.current?.scrollBy({ left: 300, behavior: "smooth" })}><ChevronRight size={16} aria-hidden /></button>}
      </div>}
    </section>
  );
}
