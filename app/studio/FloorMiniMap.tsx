"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Box, ChevronLeft, ChevronRight, Footprints, LocateFixed, Minus, MoreHorizontal, Plus, X } from "lucide-react";

import {
  connectedFloorPlanGroups,
  floorPlateBounds,
  floorPlateLevels,
  floorPlateSvgDataUrl,
  formatFeetInches,
  type ConvertResult,
  type DerivedRoomResult,
  type RoomReviewState,
} from "../../lib/reviter";
import { acceptedRoomLabels, useArchitecturalPlan } from "./use-architectural-plan.ts";
import { useTheme } from "./use-theme.ts";

type Point2 = [number, number];

/**
 * Head height above a storey's top slab. Anything under this is still that
 * floor — a normal floor-to-floor is about ten feet, and an eye is six up.
 */
const STOREY_HEAD_FEET = 14;

function tuple(value: string | undefined): [number, number, number] | null {
  if (!value) return null;
  const parts = value.split(",").map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? parts as [number, number, number] : null;
}

export function FloorMiniMap({
  result, selectedLevelId, onSelectedLevelId, showDerivedRooms, onShowDerivedRooms,
  derivedRooms, roomReview, onClose, isolateLevel = false, onIsolateLevel, selectedPoint,
  onWalkTo, onFocusStorey, embedded = false,
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
  /** Put the 3D camera on the storey this map is showing. */
  onFocusStorey?: () => void;
  embedded?: boolean;
}) {
  const theme = useTheme();
  const levels = useMemo(() => floorPlateLevels(result), [result]);
  /**
   * A storey, not a Revit level. Asking for one level id drew only the slabs
   * filed under it, so a split-level building — a wing half a flight up, a
   * ramped entry, a mezzanine edge — lost the rest of its floor off the side
   * of the drawing. The Floors workspace already composed these; the map now
   * uses the same groups, so both surfaces answer "what is this floor" alike.
   */
  const plans = useMemo(() => {
    const groups = connectedFloorPlanGroups(result);
    return groups.length
      ? [...groups].sort((left, right) => left.minElevation - right.minElevation)
      : levels.map((level) => ({
        primaryLevelId: level.levelId,
        levelIds: [level.levelId],
        levels: [level],
        floorCount: level.floorCount,
        minElevation: level.elevation,
        maxElevation: level.elevation,
        connections: [],
      }));
  }, [levels, result]);
  const selectedIndex = Math.max(0, plans.findIndex(
    (plan) => selectedLevelId != null && plan.levelIds.includes(selectedLevelId),
  ));
  const selectedPlan = plans[selectedIndex] ?? null;
  const selected = useMemo(
    () => levels.find((level) => level.levelId === selectedPlan?.primaryLevelId) ?? null,
    [levels, selectedPlan],
  );
  const planLevelIds = useMemo(
    () => selectedPlan?.levelIds ?? (selected ? [selected.levelId] : []),
    [selected, selectedPlan],
  );
  const selectedDerivedRooms = derivedRooms && planLevelIds.includes(derivedRooms.levelId)
    ? derivedRooms
    : null;
  const roomLabels = useMemo(
    () => acceptedRoomLabels(selectedDerivedRooms, roomReview),
    [roomReview, selectedDerivedRooms],
  );
  const planParts = useMemo(() => selected ? {
    levelId: selected.levelId,
    connectedLevelIds: planLevelIds,
    rotationQuarterTurns: 0,
    derivedRooms: selectedDerivedRooms,
    roomLabels,
    theme,
  } : null, [planLevelIds, roomLabels, selected, selectedDerivedRooms, theme]);
  const prewarm = useMemo(
    () => [plans[selectedIndex + 1], plans[selectedIndex - 1]]
      .filter((plan) => plan != null)
      .map((plan) => ({ levelId: plan.primaryLevelId, connectedLevelIds: plan.levelIds, theme })),
    [plans, selectedIndex, theme],
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
  const [camera, setCamera] = useState<{
    position: [number, number, number];
    direction: [number, number, number];
    /** What the orbit camera is looking at; absent when it cannot be mapped. */
    target: [number, number, number] | null;
    walking: boolean;
  } | null>(null);
  const [followCamera, setFollowCamera] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // While walking, keep the map on the storey the camera is actually on, the
  // way storey-view minimaps do; zoom and pan are left alone so the switch
  // never yanks the view around.
  //
  // Deliberately Walk only. Orbiting is how you look at a building from
  // outside, and switching storey under every drag would take away holding the
  // map on one floor while you circle the whole model. Orbit says where it is
  // looking in the header instead — "looking 8'-2" below" — rather than moving
  // the map out from under you.
  const followCameraFloor = useEffectEvent((position: [number, number, number], walking: boolean) => {
    if (!followCamera || !walking || !levels.length) return;
    const nearest = levels.reduce((closest, level) =>
      Math.abs(level.elevation - position[2]) < Math.abs(closest.elevation - position[2]) ? level : closest, levels[0]!);
    if (nearest.levelId !== selectedLevelId) onSelectedLevelId(nearest.levelId);
  });

  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.('[aria-label="Map options"]')) return;
      setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closeMap(); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Back to whatever opened the map. Hunting the page for a trigger instead
      // matched nothing — no element declares `aria-controls` for this map —
      // and fell through to the workspace switcher, a status-bar control that
      // never opened it and is not where the reviewer was.
      const opener = restoreFocusRef.current;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    const read = () => {
      const canvas = document.querySelector<HTMLCanvasElement>("canvas.model-canvas");
      const position = tuple(canvas?.dataset.modelCameraPositionFeet);
      const direction = tuple(canvas?.dataset.modelCameraDirection);
      const target = tuple(canvas?.dataset.modelCameraTargetFeet);
      const walking = canvas?.dataset.navigationState === "walk";
      setCamera(position && direction ? { position, direction, target, walking } : null);
      // The point that means something: your feet while walking, and what you
      // are looking at while orbiting, because in Orbit the eye is outside the
      // building and its own height says nothing about the storey in view.
      // Only Walk acts on it — see followCameraFloor.
      const floorPoint = walking ? position : target ?? position;
      if (floorPoint) followCameraFloor(floorPoint, walking);
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
  /**
   * Where you are on this floor.
   *
   * Walking, that is the eye: you are standing in the building and the arrow is
   * the way you face. Orbiting, the eye is outside and usually well off the
   * sheet, so the useful point is what the camera is looking *at* — the middle
   * of your view — with the arrow pointing back the way you are looking from.
   * A point that still falls outside the drawing is pinned to the frame edge
   * rather than dropped, so the map keeps saying which way the model is.
   */
  const markerPointFeet = camera
    ? (camera.walking ? camera.position : camera.target ?? camera.position)
    : null;
  const marker = (() => {
    if (!camera || !markerPointFeet) return null;
    const rawX = markerPointFeet[0] - bounds.minX;
    const rawY = bounds.maxY - markerPointFeet[1];
    const planHeight = bounds.maxY - bounds.minY;
    const inset = Math.max(width, planHeight) / 60;
    const x = Math.min(Math.max(rawX, inset), width - inset);
    const y = Math.min(Math.max(rawY, inset), planHeight - inset);
    return {
      x, y,
      // Orbiting, the arrow shows the direction you are looking from, so it
      // reads as a view cone rather than a heading.
      dx: camera.walking ? camera.direction[0] : -camera.direction[0],
      dy: camera.walking ? -camera.direction[1] : camera.direction[1],
      offPlan: Math.abs(x - rawX) > 0.01 || Math.abs(y - rawY) > 0.01,
    };
  })();
  /**
   * How far outside this storey the camera is, and zero when it is inside it.
   *
   * Measured against the storey's whole band rather than its lowest slab: a
   * composed split level spans several feet on its own, and standing on it puts
   * your eye a further five or six up, which read as "nine feet above" the
   * floor you were plainly standing on.
   */
  const cameraStoreyOffsetFeet = camera && selectedPlan
    ? (() => {
      const z = (camera.walking ? camera.position : camera.target ?? camera.position)[2];
      const floor = selectedPlan.minElevation - 2;
      const head = selectedPlan.maxElevation + STOREY_HEAD_FEET;
      if (z >= floor && z <= head) return 0;
      return z > head ? z - head : z - floor;
    })()
    : null;
  const selectedMarker = selectedPoint ? { x: selectedPoint[0] - bounds.minX, y: bounds.maxY - selectedPoint[1] } : null;
  const choose = (index: number) => { const plan = plans[index]; if (plan) { onSelectedLevelId(plan.primaryLevelId); setZoom(1); setPan({ x: 0, y: 0 }); } };
  /** "0'-0"" for one elevation, "0'-0"–4'-6"" for a composed split level. */
  const planLabel = (plan: typeof plans[number]) => plan.minElevation === plan.maxElevation
    ? formatFeetInches(plan.minElevation)
    : `${formatFeetInches(plan.minElevation)}–${formatFeetInches(plan.maxElevation)}`;
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
  const cameraReadout = (() => {
    if (!camera) return "camera unavailable";
    if (camera.walking) {
      if (!cameraStoreyOffsetFeet) return "you are on this floor";
      return `you are ${formatFeetInches(Math.abs(cameraStoreyOffsetFeet))} ${cameraStoreyOffsetFeet > 0 ? "above" : "below"}`;
    }
    if (!camera.target) return `camera ${currentFloor ? formatFeetInches(currentFloor.elevation) : "unavailable"}`;
    // With Follow camera floor off, the map can be showing one storey while the
    // camera looks at another; say so rather than claiming the view is here.
    if (cameraStoreyOffsetFeet) {
      return `looking ${formatFeetInches(Math.abs(cameraStoreyOffsetFeet))} ${cameraStoreyOffsetFeet > 0 ? "above" : "below"}`;
    }
    return marker?.offPlan ? "looking off this floor" : "viewing here";
  })();
  const locateCamera = () => {
    if (!marker || !canvasRef.current) return; const rect = canvasRef.current.getBoundingClientRect(); const fitted = Math.min(rect.width / width, rect.height / height); const nextZoom = 3;
    const x = (rect.width - width * fitted) / 2 + marker.x * fitted; const y = (rect.height - height * fitted) / 2 + marker.y * fitted;
    setZoom(nextZoom); setPan({ x: rect.width / 2 - x * nextZoom, y: rect.height / 2 - y * nextZoom });
  };

  return (
    <section ref={mapRef} id="floor-navigation-map" className={`floor-mini-map${embedded ? " embedded" : ""}`} aria-label="Floor navigation map">
      {/* The panel is the drawing. Everything that acts on it lives behind the
          menu, so a map small enough to sit over the model is not four rows of
          chrome and a sliver of plan. */}
      <div className="floor-map-bar">
        <button
          type="button"
          className="rv-icon-button"
          aria-label="Map options"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          title="Map options"
          onClick={() => setMenuOpen((open) => !open)}
        ><MoreHorizontal size={15} aria-hidden /></button>
        {!embedded && <button ref={closeRef} type="button" className="rv-icon-button" aria-label="Close floor navigation map" onClick={onClose}><X size={14} aria-hidden /></button>}
      </div>

      {menuOpen && (
        <div className="floor-map-menu" ref={menuRef} role="menu" aria-label="Floor navigation map options">
          <h2>Floor navigation map</h2>
          <div className="floor-mini-map-controls">
            <button type="button" className="rv-icon-button" aria-label="Previous map floor" disabled={selectedIndex === 0} onClick={() => choose(selectedIndex - 1)}><ChevronLeft size={14} aria-hidden /></button>
            <select aria-label="Floor navigation map level" value={selectedPlan?.primaryLevelId ?? selected.levelId} onChange={(event) => choose(plans.findIndex((plan) => plan.primaryLevelId === Number(event.target.value)))}>{plans.map((plan) => <option key={plan.primaryLevelId} value={plan.primaryLevelId}>{planLabel(plan)} · {plan.floorCount} slab{plan.floorCount === 1 ? "" : "s"}{plan.levelIds.length > 1 ? ` · ${plan.levelIds.length} elevations` : ""}</option>)}</select>
            <button type="button" className="rv-icon-button" aria-label="Next map floor" disabled={selectedIndex === plans.length - 1} onClick={() => choose(selectedIndex + 1)}><ChevronRight size={14} aria-hidden /></button>
          </div>
          <div className="floor-mini-map-zoom" role="group" aria-label="Map zoom"><button type="button" aria-label="Zoom map out" onClick={() => applyZoom(zoom / 1.5)}><Minus size={13} /></button><button type="button" aria-label="Fit whole floor" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Fit</button><button type="button" aria-label="Zoom map in" onClick={() => applyZoom(zoom * 1.5)}><Plus size={13} /></button><button type="button" aria-label="Locate camera on map" disabled={!marker} onClick={locateCamera}><LocateFixed size={13} /></button><button type="button" aria-label="Focus this floor in the 3D view" title="Focus this floor in the 3D view" disabled={!onFocusStorey} onClick={() => { onFocusStorey?.(); setMenuOpen(false); }}><Box size={13} /></button><button type="button" aria-label="Walk to the selected object" disabled={!selectedMarker || !onWalkTo} onClick={() => { if (selectedPoint && onWalkTo) { onWalkTo(selectedPoint, selected.elevation); setMenuOpen(false); } }}><Footprints size={13} /></button></div>
          <div className="floor-map-menu-toggles">
            <label><input type="checkbox" checked={showDerivedRooms} onChange={(event) => onShowDerivedRooms(event.target.checked)} />Derived floor regions</label>
            <label><input type="checkbox" checked={followCamera} onChange={(event) => setFollowCamera(event.target.checked)} />Follow camera floor</label>
            {onIsolateLevel && <label><input type="checkbox" checked={isolateLevel} onChange={(event) => onIsolateLevel(event.target.checked)} />Isolate 3D floor</label>}
          </div>
          {showDerivedRooms && selectedDerivedRooms && <p>{selectedDerivedRooms.rooms.length} inferred regions</p>}
        </div>
      )}
      <figure aria-describedby="floor-map-caption">
        <div ref={canvasRef} className="floor-mini-map-canvas" onWheel={(event) => { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); applyZoom(zoom * (event.deltaY < 0 ? 1.18 : 0.85), { x: event.clientX - rect.left, y: event.clientY - rect.top }); }} onPointerDown={(event) => { dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { const drag = dragRef.current; if (!drag) return; const dx = event.clientX - drag.x; const dy = event.clientY - drag.y; if (Math.hypot(dx, dy) > 3) drag.moved = true; setPan({ x: drag.panX + dx, y: drag.panY + dy }); }} onPointerUp={(event) => { const drag = dragRef.current; dragRef.current = null; if (!drag?.moved && onWalkTo) { const point = mapPoint(event.clientX, event.clientY); if (point) onWalkTo(point, selected.elevation); } }}>
          <div className="floor-mini-map-content" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="" />
            <svg viewBox={`0 0 ${width} ${height}`} aria-hidden preserveAspectRatio="xMidYMid meet">{marker && <g className={`map-camera-marker${camera?.walking ? " walking" : ""}${marker.offPlan ? " off-plan" : ""}`} transform={`translate(${marker.x} ${marker.y})`}><circle r={Math.max(width, height) / 95 / zoom} /><path d={`M 0 0 L ${marker.dx * Math.max(width, height) / 28 / zoom} ${marker.dy * Math.max(width, height) / 28 / zoom}`} /></g>}{selectedMarker && <circle className="map-selection-marker" cx={selectedMarker.x} cy={selectedMarker.y} r={Math.max(width, height) / 120 / zoom} />}</svg>
          </div>
          <span className="floor-map-north" aria-hidden>N ↑</span>
          <span className="floor-map-hint">{building ? "Assembling floor plan…" : "Drag/scroll · click to walk"}</span>
        </div>
        <figcaption id="floor-map-caption" className="sr-only">Interactive architectural plan assembled from recovered Revit floors, walls, openings, windows, stairs, and columns. The teal arrow is the live camera and the pink marker is the selected object.</figcaption>
      </figure>
      <div className="floor-map-status">
        <span className="floor-map-status-floor">
          <b>{selectedPlan ? planLabel(selectedPlan) : formatFeetInches(selected.elevation)}</b>
          {selectedPlan && selectedPlan.levelIds.length > 1 ? <i>{selectedPlan.levelIds.length} elev</i> : null}
          {isolateLevel && <em>Isolated</em>}
        </span>
        <span className="floor-map-status-camera">{cameraReadout}</span>
      </div>
      <span className="sr-only" role="status" aria-live="polite">Map level {selected.elevation.toFixed(1)} feet. {selectedDerivedRooms ? `${selectedDerivedRooms.rooms.length} inferred floor regions.` : ""}</span>
    </section>
  );
}
