"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  MapPinned,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  TriangleAlert,
} from "lucide-react";

import {
  connectedFloorPlanGroups,
  downloadBlob,
  floorPlateLevels,
  floorPlateSvgDataUrl,
  formatFeetInches,
  makeArchitecturalFloorSvg,
  outputName,
  planDrawingFrame,
  planWorldPoint,
  type ConvertResult,
  type DerivedRoomResult,
  type ReviewedRoom,
  type RoomReviewState,
} from "../../lib/reviter";
import { FloorReferencePlan } from "./FloorReferencePlan.tsx";
import { acceptedRoomLabels, useArchitecturalPlan } from "./use-architectural-plan.ts";

export function FloorBrowser({
  result,
  selectedLevelId,
  onSelectedLevelId,
  showDerivedRooms,
  onShowDerivedRooms,
  derivedRooms,
  roomReview,
  onRoomReview,
  onOpenModelMap,
}: {
  result: ConvertResult;
  selectedLevelId: number | null;
  onSelectedLevelId: (levelId: number) => void;
  showDerivedRooms: boolean;
  onShowDerivedRooms: (visible: boolean) => void;
  derivedRooms: DerivedRoomResult | null;
  roomReview: RoomReviewState;
  onRoomReview: (review: RoomReviewState) => void;
  onOpenModelMap: () => void;
}) {
  const [downloadStatus, setDownloadStatus] = useState("");
  const [focusedRegionKey, setFocusedRegionKey] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotationQuarterTurns, setRotationQuarterTurns] = useState(0);
  const [combineConnectedLevels, setCombineConnectedLevels] = useState(true);
  const levels = useMemo(() => floorPlateLevels(result), [result]);
  const connectedPlans = useMemo(() => connectedFloorPlanGroups(result), [result]);
  const rawPlans = useMemo(() => levels.map((level) => ({
    primaryLevelId: level.levelId,
    levelIds: [level.levelId],
    levels: [level],
    floorCount: level.floorCount,
    minElevation: level.elevation,
    maxElevation: level.elevation,
    connections: [],
  })), [levels]);
  const plans = combineConnectedLevels ? connectedPlans : rawPlans;
  const selectedIndex = Math.max(0, plans.findIndex(
    (plan) => selectedLevelId != null && plan.levelIds.includes(selectedLevelId),
  ));
  const selectedPlan = plans[selectedIndex] ?? null;
  const selected = levels.find((level) => level.levelId === selectedPlan?.primaryLevelId) ?? null;
  const connected = Boolean(combineConnectedLevels && selectedPlan && selectedPlan.levelIds.length > 1);
  const maximumEdgeGap = connected
    ? Math.max(...selectedPlan!.connections.map((item) => item.edgeGapFeet))
    : 0;
  const maximumStackedPercent = connected
    ? Math.ceil(Math.max(...selectedPlan!.connections.map((item) => item.stackedFootprintRatio)) * 100)
    : 0;
  const visibleRoomLevelIds = useMemo(
    () => combineConnectedLevels ? selectedPlan?.levelIds ?? [] : selected ? [selected.levelId] : [],
    [combineConnectedLevels, selected, selectedPlan],
  );
  const selectedDerivedRooms = useMemo(() => {
    if (!derivedRooms || !selected || !derivedRooms.levelIds.includes(selected.levelId)) return null;
    const ids = new Set(visibleRoomLevelIds);
    return {
      ...derivedRooms,
      levelId: selected.levelId,
      levelIds: visibleRoomLevelIds,
      gaps: derivedRooms.gaps.filter((gap) => ids.has(gap.levelId)),
      rooms: derivedRooms.rooms.filter((room) => ids.has(room.levelId)),
    };
  }, [derivedRooms, selected, visibleRoomLevelIds]);
  const reviewedByCandidate = useMemo(
    () => new Map(roomReview.rooms.filter((room) => visibleRoomLevelIds.includes(room.levelId)).map((room) => [room.candidateKey, room])),
    [roomReview.rooms, visibleRoomLevelIds],
  );
  const updateRoom = (roomId: string, update: (room: ReviewedRoom) => ReviewedRoom) => {
    onRoomReview({
      ...roomReview,
      rooms: roomReview.rooms.map((room) => room.roomId === roomId
        ? { ...update(room), updatedAt: new Date().toISOString() }
        : room),
    });
  };
  const updateGap = (gapId: string, disposition: "unreviewed" | "treat-as-closed" | "dismissed") => {
    onRoomReview({
      ...roomReview,
      gaps: roomReview.gaps.map((gap) => gap.id === gapId
        ? { ...gap, disposition, updatedAt: new Date().toISOString() }
        : gap),
    });
  };
  useEffect(() => {
    if (selected && selected.levelId !== selectedLevelId) {
      onSelectedLevelId(selected.levelId);
    }
  }, [onSelectedLevelId, selected, selectedLevelId]);
  const roomLabels = useMemo(
    () => acceptedRoomLabels(selectedDerivedRooms, roomReview),
    [roomReview, selectedDerivedRooms],
  );
  const planParts = useMemo(
    () => selected ? {
      levelId: selected.levelId,
      connectedLevelIds: selectedPlan?.levelIds ?? [selected.levelId],
      rotationQuarterTurns,
      derivedRooms: selectedDerivedRooms,
      roomLabels,
    } : null,
    [roomLabels, rotationQuarterTurns, selected, selectedDerivedRooms, selectedPlan],
  );
  const prewarm = useMemo(
    () => [plans[selectedIndex + 1], plans[selectedIndex - 1]]
      .filter((plan) => plan != null)
      .map((plan) => ({ levelId: plan.primaryLevelId, connectedLevelIds: plan.levelIds })),
    [plans, selectedIndex],
  );
  const { svg, summary: planSummary, building } = useArchitecturalPlan(result, planParts, prewarm);
  const imageUrl = svg == null ? null : floorPlateSvgDataUrl(svg);

  if (!selected || (!building && (!svg || !imageUrl))) {
    return (
      <div className="floor-browser-empty">
        <strong>No recovered Revit floor plates</strong>
        <span>This model does not expose a `Floors` sketch on a persisted Revit level.</span>
      </div>
    );
  }
  if (!svg || !imageUrl) {
    return (
      <div className="floor-browser-empty" role="status" aria-live="polite">
        <strong>Assembling floor plan</strong>
        <span>Composing recovered walls, openings, and stairs off the main thread…</span>
      </div>
    );
  }

  const choose = (index: number) => {
    const plan = plans[index];
    if (plan) {
      setZoom(1);
      setRotationQuarterTurns(0);
      onSelectedLevelId(plan.primaryLevelId);
    }
  };
  // A click on the plan image hit-tests the visible derived regions in model
  // feet (even-odd across each region's loops, holes included) and focuses
  // that region's review card — plan-to-review navigation without an inline
  // SVG DOM.
  const focusRegionAt = (fraction: { x: number; y: number }) => {
    if (!svg || !selectedDerivedRooms?.rooms.length) return;
    const frame = planDrawingFrame(svg);
    const point = frame ? planWorldPoint(frame, fraction.x, fraction.y) : null;
    if (!point) return;
    const inRegion = (loops: readonly (readonly [number, number][])[]) => {
      let inside = false;
      for (const loop of loops) {
        for (let index = 0, previous = loop.length - 1; index < loop.length; previous = index, index += 1) {
          const [x, y] = loop[index]!; const [previousX, previousY] = loop[previous]!;
          if ((y > point[1]) !== (previousY > point[1]) &&
            point[0] < (previousX - x) * (point[1] - y) / (previousY - y) + x) inside = !inside;
        }
      }
      return inside;
    };
    const hit = [...selectedDerivedRooms.rooms]
      .sort((left, right) => left.areaSquareFeet - right.areaSquareFeet)
      .find((room) => inRegion(room.loops));
    if (!hit) return;
    setFocusedRegionKey(hit.key);
    document.querySelector(`[data-region-card="${CSS.escape(hit.key)}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const download = () => {
    // Downloads are for printing and records: render the paper-correct
    // document variant (ISO pens, overall dimension) rather than the
    // screen-optimised plan on display. Cached after the first click.
    const documentSvg = makeArchitecturalFloorSvg(result, selected.levelId, {
      connectedLevelIds: selectedPlan?.levelIds,
      rotationQuarterTurns,
      derivedRooms: selectedDerivedRooms ?? false,
      roomLabels: roomLabels ?? undefined,
      purpose: "document",
    });
    downloadBlob(
      new Blob([documentSvg], { type: "image/svg+xml" }),
      outputName(
        result.fileName,
        `architectural-floor-${connected ? `connected-${selectedPlan!.levelIds.join("-")}` : selected.levelId}${rotationQuarterTurns ? `-rotated-${rotationQuarterTurns * 90}` : ""}${showDerivedRooms ? "-derived-regions" : ""}.svg`,
      ),
    );
  };

  return (
    <div className="floor-browser">
      <aside className="floor-browser-sidebar">
        <div className="floor-browser-heading">
          <span>
            <strong>Revit Floors</strong>
            <small>{combineConnectedLevels
              ? `${plans.length} plans from ${levels.length} Revit elevations`
              : `${levels.length} raw Revit elevations`}</small>
          </span>
          <div>
            <button
              type="button"
              className="rv-icon-button"
              aria-label="Previous Revit floor"
              disabled={selectedIndex === 0}
              onClick={() => choose(selectedIndex - 1)}
            ><ChevronLeft size={15} aria-hidden /></button>
            <button
              type="button"
              className="rv-icon-button"
              aria-label="Next Revit floor"
              disabled={selectedIndex === plans.length - 1}
              onClick={() => choose(selectedIndex + 1)}
            ><ChevronRight size={15} aria-hidden /></button>
          </div>
        </div>

        <label>
          <span>{combineConnectedLevels ? "Architectural plan" : "Floor elevation"}</span>
          <select
            aria-label="Browse Revit floor level"
            value={selectedPlan?.primaryLevelId}
            onChange={(event) => {
              setZoom(1);
              setRotationQuarterTurns(0);
              onSelectedLevelId(Number(event.target.value));
            }}
          >
            {plans.map((plan) => (
              <option key={plan.primaryLevelId} value={plan.primaryLevelId}>
                {plan.minElevation === plan.maxElevation
                  ? formatFeetInches(plan.minElevation)
                  : `${formatFeetInches(plan.minElevation)}–${formatFeetInches(plan.maxElevation)}`}
                {` · ${plan.floorCount} slab${plan.floorCount === 1 ? "" : "s"}`}
              </option>
            ))}
          </select>
        </label>

        <dl className={building ? "floor-browser-stale" : undefined}>
          <div><dt>Revit level{connected ? "s" : " ID"}</dt><dd>{connected ? selectedPlan!.levelIds.join(", ") : selected.levelId}</dd></div>
          <div><dt>Elevation{connected ? " range" : ""}</dt><dd>{connected
            ? `${formatFeetInches(selectedPlan!.minElevation)}–${formatFeetInches(selectedPlan!.maxElevation)}`
            : formatFeetInches(selected.elevation)}</dd></div>
          <div><dt>Floor plates</dt><dd>{selectedPlan?.floorCount ?? selected.floorCount}</dd></div>
          <div><dt>Plan cut{connected ? "s" : ""}</dt><dd>{connected ? `${selectedPlan!.levels.length} local` : planSummary ? formatFeetInches(planSummary.cutElevation) : "—"}</dd></div>
          <div><dt>Walls</dt><dd>{planSummary?.walls.toLocaleString() ?? 0}</dd></div>
          <div><dt>Doors / windows</dt><dd>{planSummary?.doors.toLocaleString() ?? 0} / {planSummary?.windows.toLocaleString() ?? 0}</dd></div>
          <div><dt>Stairs / columns</dt><dd>{planSummary?.stairs.toLocaleString() ?? 0} / {planSummary?.columns.toLocaleString() ?? 0}</dd></div>
          <div><dt>Source</dt><dd>Recovered RVT geometry</dd></div>
          {selectedDerivedRooms && (
            <>
              <div><dt>Derived regions</dt><dd>{selectedDerivedRooms.rooms.length}</dd></div>
              <div><dt>Near-room gaps</dt><dd>{selectedDerivedRooms.gaps.length}</dd></div>
              <div><dt>Barrier inputs</dt><dd>{selectedDerivedRooms.barrierElementCount}</dd></div>
              <div><dt>Plan cut</dt><dd>{selectedDerivedRooms.planCutElevationFeet.toFixed(1)}′</dd></div>
              <div><dt>Grid resolution</dt><dd>{selectedDerivedRooms.cellSizeFeet.toFixed(1)}′</dd></div>
            </>
          )}
        </dl>

        <div className="floor-plan-legend" aria-label="Architectural map legend">
          <span><i className="wall" />Walls (cut)</span>
          <span><i className="door" />Doors</span>
          <span><i className="window" />Windows</span>
          <span><i className="stair" />Stairs</span>
          <span><i className="column" />Columns</span>
          <span><i className="open-end" />Open wall end</span>
          {showDerivedRooms && <span><i className="region" />Region <em>Inferred</em></span>}
        </div>

        <label className="floor-browser-room-toggle floor-browser-connected-toggle">
          <span>
            <input
              type="checkbox"
              checked={combineConnectedLevels}
              onChange={(event) => {
                setCombineConnectedLevels(event.target.checked);
                setZoom(1);
                setRotationQuarterTurns(0);
              }}
            />
            Combine adjoining split levels
          </span>
          <em>Geometry</em>
        </label>

        {connected && (
          <p className="floor-browser-room-note floor-browser-connected-note">
            {selectedPlan!.levels.length} elevations form one plan because their slab edges meet within {maximumEdgeGap.toFixed(1)}′ and {maximumStackedPercent
              ? `only ${maximumStackedPercent}% of the smaller footprints overlap vertically`
              : "their footprints do not stack vertically"}. Turn this off to inspect each Revit level separately.
          </p>
        )}

        <label className="floor-browser-room-toggle">
          <span>
            <input
              type="checkbox"
              checked={showDerivedRooms}
              onChange={(event) => onShowDerivedRooms(event.target.checked)}
            />
            Show derived floor regions
          </span>
          <em>Inferred</em>
        </label>

        {selectedDerivedRooms && (
          <p className="floor-browser-room-note">
            {selectedDerivedRooms.rooms.length
              ? `${selectedDerivedRooms.rooms.length} approximate floor region${selectedDerivedRooms.rooms.length === 1 ? "" : "s"}; ${selectedDerivedRooms.rooms.filter((room) => room.closure === "near-closed").length} require a proposed short-gap closure.`
              : "No regions are fully enclosed by recovered vertical barriers at the plan cut."}
          </p>
        )}

        {selectedDerivedRooms?.rooms.length ? (
          <details className="floor-browser-region-list floor-browser-room-review" open>
            <summary>Room review</summary>
            <ol>{selectedDerivedRooms.rooms.map((region) => {
              const review = reviewedByCandidate.get(region.key);
              const gaps = region.gapIds.map((gapId) => roomReview.gaps.find((gap) => gap.id === gapId)).filter(Boolean);
              return (
                <li key={region.key} data-region-card={region.key} className={`room-review-card ${region.closure}${focusedRegionKey === region.key ? " focused" : ""}`}>
                  <div className="room-review-card-heading">
                    <span>F{region.id}</span>
                    <span>{Math.round(region.areaSquareFeet).toLocaleString()} ft²</span>
                    <em>{region.closure === "near-closed" ? "Near room" : "Closed"}</em>
                  </div>
                  {region.closure === "near-closed" && (
                    <p><TriangleAlert size={13} aria-hidden /> This candidate appears only after testing {gaps.length} short opening{gaps.length === 1 ? "" : "s"}. Review each gap before accepting the room.</p>
                  )}
                  {review && (
                    <>
                      <div className="room-review-actions" role="group" aria-label={`Review floor region F${region.id}`}>
                        <button type="button" className={review.disposition === "accepted" ? "active" : ""} onClick={() => updateRoom(review.roomId, (room) => ({ ...room, disposition: "accepted", ifc: { ...room.ifc, export: true } }))}>Accept room</button>
                        <button type="button" className={review.disposition === "dismissed" ? "active" : ""} onClick={() => updateRoom(review.roomId, (room) => ({ ...room, disposition: "dismissed", ifc: { ...room.ifc, export: false } }))}>Dismiss</button>
                        {review.disposition !== "unreviewed" && <button type="button" onClick={() => updateRoom(review.roomId, (room) => ({ ...room, disposition: "unreviewed", ifc: { ...room.ifc, export: false } }))}>Reset</button>}
                      </div>
                      {gaps.map((gap) => gap && (
                        <div className="room-gap-review" key={gap.id}>
                          <span>{gap.widthFeet.toFixed(1)}′ possible gap</span>
                          <button type="button" className={gap.disposition === "treat-as-closed" ? "active" : ""} onClick={() => updateGap(gap.id, "treat-as-closed")}>Use boundary</button>
                          <button type="button" className={gap.disposition === "dismissed" ? "active" : ""} onClick={() => updateGap(gap.id, "dismissed")}>Intentional</button>
                        </div>
                      ))}
                      {review.disposition === "accepted" && (
                        <div className="room-detail-fields">
                          <label><span>Number</span><input value={review.details.number} onChange={(event) => updateRoom(review.roomId, (room) => ({ ...room, details: { ...room.details, number: event.target.value } }))} /></label>
                          <label><span>Name</span><input value={review.details.name} onChange={(event) => updateRoom(review.roomId, (room) => ({ ...room, details: { ...room.details, name: event.target.value } }))} /></label>
                          <label><span>Department</span><input value={review.details.department} onChange={(event) => updateRoom(review.roomId, (room) => ({ ...room, details: { ...room.details, department: event.target.value } }))} /></label>
                          <label><span>Occupancy</span><input value={review.details.occupancyType} onChange={(event) => updateRoom(review.roomId, (room) => ({ ...room, details: { ...room.details, occupancyType: event.target.value } }))} /></label>
                          <label><span>Accessibility</span><input value={review.details.accessibility} onChange={(event) => updateRoom(review.roomId, (room) => ({ ...room, details: { ...room.details, accessibility: event.target.value } }))} /></label>
                          <label><span>Height (ft)</span><input type="number" min="0" step="0.1" value={review.details.heightFeet ?? ""} onChange={(event) => updateRoom(review.roomId, (room) => ({ ...room, details: { ...room.details, heightFeet: event.target.value === "" ? null : Number(event.target.value) } }))} /></label>
                          <label className="room-detail-wide"><span>Description</span><textarea value={review.details.description} onChange={(event) => updateRoom(review.roomId, (room) => ({ ...room, details: { ...room.details, description: event.target.value } }))} /></label>
                          <label className="room-detail-export"><input type="checkbox" checked={review.ifc.export} onChange={(event) => updateRoom(review.roomId, (room) => ({ ...room, ifc: { ...room.ifc, export: event.target.checked } }))} /> Include as IfcSpace</label>
                        </div>
                      )}
                    </>
                  )}
                </li>
              );
            })}</ol>
          </details>
        ) : null}

        <button
          type="button"
          className="rv-button floor-browser-side-map"
          onClick={onOpenModelMap}
        >
          <MapPinned size={14} aria-hidden />
          Open over 3D model
        </button>

        <button type="button" className="rv-button floor-browser-download" onClick={() => { download(); setDownloadStatus("Floor SVG download started"); }}>
          <Download size={14} aria-hidden /> Download this floor SVG
        </button>
        <span className="sr-only" role="status" aria-live="polite">{downloadStatus}</span>
      </aside>

      <FloorReferencePlan
        rvtFileName={result.fileName}
        levelIds={selectedPlan?.levelIds ?? [selected.levelId]}
        planImageUrl={imageUrl}
        zoom={zoom}
        onPlanClick={showDerivedRooms ? focusRegionAt : undefined}
        planAlt={connected
          ? `Connected architectural floor map from ${selectedPlan!.minElevation.toFixed(1)} to ${selectedPlan!.maxElevation.toFixed(1)} feet with recovered walls, doors, windows, stairs, and columns`
          : `Architectural floor map at ${selected.elevation.toFixed(1)} feet with recovered walls, doors, windows, stairs, and columns`}
        toolbar={<div className="floor-browser-preview-toolbar" role="group" aria-label="Floor map view controls">
          <button type="button" aria-label="Zoom floor map out" disabled={zoom <= 1} onClick={() => setZoom((value) => Math.max(1, value / 1.5))}><Minus size={13} /></button>
          <button type="button" aria-label="Fit whole floor map" onClick={() => setZoom(1)}><Maximize2 size={13} /> Fit</button>
          <button type="button" aria-label="Zoom floor map in" disabled={zoom >= 6} onClick={() => setZoom((value) => Math.min(6, value * 1.5))}><Plus size={13} /></button>
          <button type="button" aria-label="Rotate floor map counter-clockwise" onClick={() => setRotationQuarterTurns((value) => (value + 3) % 4)}><RotateCcw size={13} /></button>
          <button type="button" aria-label="Rotate floor map clockwise" onClick={() => setRotationQuarterTurns((value) => (value + 1) % 4)}><RotateCw size={13} /></button>
          <span>{Math.round(zoom * 100)}% · {rotationQuarterTurns * 90}°</span>
          {building && <span className="floor-plan-building" role="status">Assembling…</span>}
        </div>}
        caption={<>
          Architectural plan assembled from recovered RVT geometry. Door swings are indicative because the persisted opening does not always expose Revit&apos;s swing side.
          {connected ? " Adjoining split-level slabs are composed at their own local plan cuts; vertically stacked storeys remain separate." : ""}
          {selectedDerivedRooms
            ? " F-labels are approximate floor regions partitioned by recovered vertical barriers—not Revit Rooms."
            : " Turn on Derived floor regions to inspect approximate barrier partitions."}
          {" Loaded references remain separate and do not alter the RVT."}
        </>}
      />
    </div>
  );
}
