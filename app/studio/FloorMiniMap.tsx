"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Footprints, LocateFixed, Minus, Plus, X } from "lucide-react";

import {
  floorPlateBounds,
  floorPlateLevels,
  floorPlateSvgDataUrl,
  formatFeetInches,
  type ConvertResult,
  type DerivedRoomResult,
  type RoomReviewState,
} from "../../lib/reviter";
import { acceptedRoomLabels, useArchitecturalPlan } from "./use-architectural-plan.ts";

type Point2 = [number, number];

function tuple(value: string | undefined): [number, number, number] | null {
  if (!value) return null;
  const parts = value.split(",").map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? parts as [number, number, number] : null;
}

export function FloorMiniMap({
  result, selectedLevelId, onSelectedLevelId, showDerivedRooms, onShowDerivedRooms,
  derivedRooms, roomReview, onClose, isolateLevel = false, onIsolateLevel, selectedPoint,
  onWalkTo, embedded = false,
}: {
  result: ConvertResult;
  selectedLevelId: number | null;
  onSelectedLevelId: (levelId: number) => void;
  showDerivedRooms: boolean;
  onShowDerivedRooms: (visible: boolean) => void;
  derivedRooms: DerivedRoomResult | null;
  roomReview?: RoomReviewState;
  onClose: () => void;
  isolateLevel?: boolean;
  onIsolateLevel?: (isolated: boolean) => void;
  selectedPoint?: Point2 | null;
  onWalkTo?: (point: Point2, elevation: number) => void;
  embedded?: boolean;
}) {
  const levels = useMemo(() => floorPlateLevels(result), [result]);
  const selectedIndex = Math.max(0, levels.findIndex((level) => level.levelId === selectedLevelId));
  const selected = levels[selectedIndex] ?? null;
  const selectedDerivedRooms = derivedRooms?.levelId === selected?.levelId ? derivedRooms : null;
  const roomLabels = useMemo(
    () => acceptedRoomLabels(selectedDerivedRooms, roomReview),
    [roomReview, selectedDerivedRooms],
  );
  const planParts = useMemo(() => selected ? {
    levelId: selected.levelId,
    connectedLevelIds: [selected.levelId],
    rotationQuarterTurns: 0,
    derivedRooms: selectedDerivedRooms,
    roomLabels,
  } : null, [roomLabels, selected, selectedDerivedRooms]);
  const prewarm = useMemo(
    () => [levels[selectedIndex + 1], levels[selectedIndex - 1]]
      .filter((level) => level != null)
      .map((level) => ({ levelId: level.levelId, connectedLevelIds: [level.levelId] })),
    [levels, selectedIndex],
  );
  const { svg, building } = useArchitecturalPlan(result, planParts, prewarm);
  const imageUrl = svg == null ? null : floorPlateSvgDataUrl(svg);
  // The drawing frame the SVG actually rendered (plan bounds plus padding and
  // the sheet-furniture footer), so map clicks and the camera marker land on
  // exact world coordinates instead of assuming the raw floor-plate extents.
  const bounds = useMemo(() => {
    if (svg) {
      const attr = (name: string) => {
        const match = svg.match(new RegExp(`data-plan-${name}-feet="([^"]+)"`, "u"));
        return match ? Number(match[1]) : Number.NaN;
      };
      const frame = {
        minX: attr("min-x"), minY: attr("min-y"),
        maxX: attr("max-x"), maxY: attr("max-y"),
        footerFeet: attr("footer"),
      };
      if (Object.values(frame).every(Number.isFinite)) return frame;
    }
    const plate = selected ? floorPlateBounds(result, selected.levelId) : null;
    return plate ? { ...plate, footerFeet: 0 } : null;
  }, [result, selected, svg]);
  const mapRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeMap = useEffectEvent(onClose);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [camera, setCamera] = useState<{ position: [number, number, number]; direction: [number, number, number]; walking: boolean } | null>(null);
  const [followCamera, setFollowCamera] = useState(true);
  // While walking, keep the map on the storey the camera is actually on, the
  // way storey-view minimaps do; zoom and pan are left alone so the switch
  // never yanks the view around.
  const followCameraFloor = useEffectEvent((position: [number, number, number], walking: boolean) => {
    if (!followCamera || !walking || !levels.length) return;
    const nearest = levels.reduce((closest, level) =>
      Math.abs(level.elevation - position[2]) < Math.abs(closest.elevation - position[2]) ? level : closest, levels[0]!);
    if (nearest.levelId !== selectedLevelId) onSelectedLevelId(nearest.levelId);
  });

  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closeMap(); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const mapTrigger = document.querySelector<HTMLElement>('[aria-controls="floor-navigation-map"]')
        ?? document.querySelector<HTMLElement>('.workspace-switcher button[aria-pressed="true"]');
      (mapTrigger ?? restoreFocusRef.current)?.focus?.();
    };
  }, []);

  useEffect(() => {
    const read = () => {
      const canvas = document.querySelector<HTMLCanvasElement>("canvas.model-canvas");
      const position = tuple(canvas?.dataset.modelCameraPositionFeet);
      const direction = tuple(canvas?.dataset.modelCameraDirection);
      setCamera(position && direction ? { position, direction, walking: canvas?.dataset.navigationState === "walk" } : null);
      if (position) followCameraFloor(position, canvas?.dataset.navigationState === "walk");
    };
    read(); const timer = window.setInterval(read, 160); return () => window.clearInterval(timer);
  }, []);

  if (!selected || !bounds) return null;
  if (!imageUrl) {
    return (
      <section ref={mapRef} id="floor-navigation-map" className={`floor-mini-map${embedded ? " embedded" : ""}`} aria-label="Floor navigation map">
        <header><span><h2>Floor navigation map</h2><small role="status">Assembling floor plan…</small></span><button ref={closeRef} type="button" className="rv-icon-button" aria-label="Close floor navigation map" onClick={onClose}><X size={14} aria-hidden /></button></header>
      </section>
    );
  }
  const width = Math.max(1, bounds.maxX - bounds.minX);
  // The rendered image is taller than the plan by the sheet-furniture footer;
  // all fit math must use the image's aspect, not the bare plan extents.
  const height = Math.max(1, bounds.maxY - bounds.minY + bounds.footerFeet);
  const currentFloor = camera ? levels.reduce((nearest, level) => Math.abs(level.elevation - camera.position[2]) < Math.abs(nearest.elevation - camera.position[2]) ? level : nearest, levels[0]!) : null;
  const marker = camera ? { x: camera.position[0] - bounds.minX, y: bounds.maxY - camera.position[1], dx: camera.direction[0], dy: -camera.direction[1] } : null;
  const selectedMarker = selectedPoint ? { x: selectedPoint[0] - bounds.minX, y: bounds.maxY - selectedPoint[1] } : null;
  const choose = (index: number) => { const level = levels[index]; if (level) { onSelectedLevelId(level.levelId); setZoom(1); setPan({ x: 0, y: 0 }); } };
  // Zoom keeps the point under the cursor (or the viewport centre, for the
  // buttons) fixed, instead of scaling about the map's top-left corner.
  const applyZoom = (value: number, focus?: { x: number; y: number }) => {
    const bounded = Math.max(1, Math.min(8, value));
    if (bounded === zoom) return;
    if (bounded === 1) { setZoom(1); setPan({ x: 0, y: 0 }); return; }
    const rect = canvasRef.current?.getBoundingClientRect();
    const focusX = focus?.x ?? (rect ? rect.width / 2 : 0);
    const focusY = focus?.y ?? (rect ? rect.height / 2 : 0);
    setPan({
      x: focusX - ((focusX - pan.x) / zoom) * bounded,
      y: focusY - ((focusY - pan.y) / zoom) * bounded,
    });
    setZoom(bounded);
  };
  const mapPoint = (clientX: number, clientY: number): Point2 | null => {
    const node = canvasRef.current; if (!node) return null; const rect = node.getBoundingClientRect();
    const fitted = Math.min(rect.width / width, rect.height / height); const imageWidth = width * fitted; const imageHeight = height * fitted;
    const localX = (clientX - rect.left - pan.x) / zoom; const localY = (clientY - rect.top - pan.y) / zoom;
    const x = localX - (rect.width - imageWidth) / 2; const y = localY - (rect.height - imageHeight) / 2;
    if (x < 0 || y < 0 || x > imageWidth || y > imageHeight) return null;
    // Ignore clicks in the sheet-furniture footer below the plan content.
    if (y / fitted > bounds.maxY - bounds.minY) return null;
    return [bounds.minX + x / fitted, bounds.maxY - y / fitted];
  };
  const locateCamera = () => {
    if (!marker || !canvasRef.current) return; const rect = canvasRef.current.getBoundingClientRect(); const fitted = Math.min(rect.width / width, rect.height / height); const nextZoom = 3;
    const x = (rect.width - width * fitted) / 2 + marker.x * fitted; const y = (rect.height - height * fitted) / 2 + marker.y * fitted;
    setZoom(nextZoom); setPan({ x: rect.width / 2 - x * nextZoom, y: rect.height / 2 - y * nextZoom });
  };

  return (
    <section ref={mapRef} id="floor-navigation-map" className={`floor-mini-map${embedded ? " embedded" : ""}`} aria-label="Floor navigation map">
      <header><span><h2>Floor navigation map</h2><small>{formatFeetInches(selected.elevation)} · camera {currentFloor ? formatFeetInches(currentFloor.elevation) : "unavailable"}</small></span>{!embedded && <button ref={closeRef} type="button" className="rv-icon-button" aria-label="Close floor navigation map" onClick={onClose}><X size={14} aria-hidden /></button>}</header>
      <div className="floor-mini-map-controls">
        <button type="button" className="rv-icon-button" aria-label="Previous map floor" disabled={selectedIndex === 0} onClick={() => choose(selectedIndex - 1)}><ChevronLeft size={14} aria-hidden /></button>
        <select aria-label="Floor navigation map level" value={selected.levelId} onChange={(event) => choose(levels.findIndex((level) => level.levelId === Number(event.target.value)))}>{levels.map((level) => <option key={level.levelId} value={level.levelId}>{formatFeetInches(level.elevation)} · {level.floorCount} slab{level.floorCount === 1 ? "" : "s"}</option>)}</select>
        <button type="button" className="rv-icon-button" aria-label="Next map floor" disabled={selectedIndex === levels.length - 1} onClick={() => choose(selectedIndex + 1)}><ChevronRight size={14} aria-hidden /></button>
      </div>
      <div className="floor-mini-map-zoom" role="group" aria-label="Map zoom"><button type="button" aria-label="Zoom map out" onClick={() => applyZoom(zoom / 1.5)}><Minus size={13} /></button><button type="button" aria-label="Fit whole floor" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Fit</button><button type="button" aria-label="Zoom map in" onClick={() => applyZoom(zoom * 1.5)}><Plus size={13} /></button><button type="button" aria-label="Locate camera on map" disabled={!marker} onClick={locateCamera}><LocateFixed size={13} /></button><button type="button" aria-label="Walk to the selected object" disabled={!selectedMarker || !onWalkTo} onClick={() => { if (selectedPoint && onWalkTo) onWalkTo(selectedPoint, selected.elevation); }}><Footprints size={13} /></button></div>
      <figure aria-describedby="floor-map-caption">
        <div ref={canvasRef} className="floor-mini-map-canvas" onWheel={(event) => { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); applyZoom(zoom * (event.deltaY < 0 ? 1.18 : 0.85), { x: event.clientX - rect.left, y: event.clientY - rect.top }); }} onPointerDown={(event) => { dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { const drag = dragRef.current; if (!drag) return; const dx = event.clientX - drag.x; const dy = event.clientY - drag.y; if (Math.hypot(dx, dy) > 3) drag.moved = true; setPan({ x: drag.panX + dx, y: drag.panY + dy }); }} onPointerUp={(event) => { const drag = dragRef.current; dragRef.current = null; if (!drag?.moved && onWalkTo) { const point = mapPoint(event.clientX, event.clientY); if (point) onWalkTo(point, selected.elevation); } }}>
          <div className="floor-mini-map-content" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="" />
            <svg viewBox={`0 0 ${width} ${height}`} aria-hidden preserveAspectRatio="xMidYMid meet">{marker && <g className={`map-camera-marker${camera?.walking ? " walking" : ""}`} transform={`translate(${marker.x} ${marker.y})`}><circle r={Math.max(width, height) / 95 / zoom} /><path d={`M 0 0 L ${marker.dx * Math.max(width, height) / 28 / zoom} ${marker.dy * Math.max(width, height) / 28 / zoom}`} /></g>}{selectedMarker && <circle className="map-selection-marker" cx={selectedMarker.x} cy={selectedMarker.y} r={Math.max(width, height) / 120 / zoom} />}</svg>
          </div>
          <span className="floor-map-north" aria-hidden>N ↑</span>
          <span className="floor-map-hint">{building ? "Assembling floor plan…" : "Drag/scroll · click to walk"}</span>
        </div>
        <figcaption id="floor-map-caption" className="sr-only">Interactive architectural plan assembled from recovered Revit floors, walls, openings, windows, stairs, and columns. The teal arrow is the live camera and the pink marker is the selected object.</figcaption>
      </figure>
      <footer><label><input type="checkbox" checked={showDerivedRooms} onChange={(event) => onShowDerivedRooms(event.target.checked)} />Derived floor regions</label><label><input type="checkbox" checked={followCamera} onChange={(event) => setFollowCamera(event.target.checked)} />Follow camera floor</label>{onIsolateLevel && <label><input type="checkbox" checked={isolateLevel} onChange={(event) => onIsolateLevel(event.target.checked)} />Isolate 3D floor</label>}{showDerivedRooms && selectedDerivedRooms && <span>{selectedDerivedRooms.rooms.length} regions <em>Inferred</em></span>}</footer>
      <span className="sr-only" role="status" aria-live="polite">Map level {selected.elevation.toFixed(1)} feet. {selectedDerivedRooms ? `${selectedDerivedRooms.rooms.length} inferred floor regions.` : ""}</span>
    </section>
  );
}
