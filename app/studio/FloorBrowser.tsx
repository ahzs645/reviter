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
} from "lucide-react";

import {
  architecturalPlanSummary,
  downloadBlob,
  floorPlateLevels,
  floorPlateSvgDataUrl,
  makeArchitecturalFloorSvg,
  outputName,
  type ConvertResult,
  type DerivedRoomResult,
} from "../../lib/reviter";

export function FloorBrowser({
  result,
  selectedLevelId,
  onSelectedLevelId,
  showDerivedRooms,
  onShowDerivedRooms,
  derivedRooms,
  onOpenModelMap,
}: {
  result: ConvertResult;
  selectedLevelId: number | null;
  onSelectedLevelId: (levelId: number) => void;
  showDerivedRooms: boolean;
  onShowDerivedRooms: (visible: boolean) => void;
  derivedRooms: DerivedRoomResult | null;
  onOpenModelMap: () => void;
}) {
  const [downloadStatus, setDownloadStatus] = useState("");
  const [zoom, setZoom] = useState(1);
  const [rotationQuarterTurns, setRotationQuarterTurns] = useState(0);
  const levels = useMemo(() => floorPlateLevels(result), [result]);
  const selectedIndex = Math.max(0, levels.findIndex(
    (level) => level.levelId === selectedLevelId,
  ));
  const selected = levels[selectedIndex] ?? null;
  const planSummary = useMemo(
    () => selected ? architecturalPlanSummary(result, selected.levelId) : null,
    [result, selected],
  );
  const selectedDerivedRooms = derivedRooms?.levelId === selected?.levelId
    ? derivedRooms
    : null;
  useEffect(() => {
    if (selected && selected.levelId !== selectedLevelId) {
      onSelectedLevelId(selected.levelId);
    }
  }, [onSelectedLevelId, selected, selectedLevelId]);
  const svg = useMemo(
    () => selected
      ? makeArchitecturalFloorSvg(result, selected.levelId, {
        derivedRooms: selectedDerivedRooms ?? false,
        rotationQuarterTurns,
      })
      : null,
    [result, rotationQuarterTurns, selected, selectedDerivedRooms],
  );
  const imageUrl = svg == null ? null : floorPlateSvgDataUrl(svg);

  if (!selected || !svg || !imageUrl) {
    return (
      <div className="floor-browser-empty">
        <strong>No recovered Revit floor plates</strong>
        <span>This model does not expose a `Floors` sketch on a persisted Revit level.</span>
      </div>
    );
  }

  const choose = (index: number) => {
    const level = levels[index];
    if (level) {
      setZoom(1);
      setRotationQuarterTurns(0);
      onSelectedLevelId(level.levelId);
    }
  };
  const download = () => downloadBlob(
    new Blob([svg], { type: "image/svg+xml" }),
    outputName(
      result.fileName,
      `architectural-floor-${selected.levelId}${rotationQuarterTurns ? `-rotated-${rotationQuarterTurns * 90}` : ""}${showDerivedRooms ? "-derived-regions" : ""}.svg`,
    ),
  );

  return (
    <div className="floor-browser">
      <aside className="floor-browser-sidebar">
        <div className="floor-browser-heading">
          <span>
            <strong>Revit Floors</strong>
            <small>{levels.length} levels with slab geometry</small>
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
              disabled={selectedIndex === levels.length - 1}
              onClick={() => choose(selectedIndex + 1)}
            ><ChevronRight size={15} aria-hidden /></button>
          </div>
        </div>

        <label>
          <span>Floor elevation</span>
          <select
            aria-label="Browse Revit floor level"
            value={selected.levelId}
            onChange={(event) => {
              setZoom(1);
              setRotationQuarterTurns(0);
              onSelectedLevelId(Number(event.target.value));
            }}
          >
            {levels.map((level) => (
              <option key={level.levelId} value={level.levelId}>
                {level.elevation.toFixed(1)}′ · {level.floorCount} slab{level.floorCount === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </label>

        <dl>
          <div><dt>Revit level ID</dt><dd>{selected.levelId}</dd></div>
          <div><dt>Elevation</dt><dd>{selected.elevation.toFixed(3)}′</dd></div>
          <div><dt>Floor plates</dt><dd>{selected.floorCount}</dd></div>
          <div><dt>Plan cut</dt><dd>{planSummary?.cutElevation.toFixed(1)}′</dd></div>
          <div><dt>Walls</dt><dd>{planSummary?.walls.toLocaleString() ?? 0}</dd></div>
          <div><dt>Doors / windows</dt><dd>{planSummary?.doors.toLocaleString() ?? 0} / {planSummary?.windows.toLocaleString() ?? 0}</dd></div>
          <div><dt>Stairs / columns</dt><dd>{planSummary?.stairs.toLocaleString() ?? 0} / {planSummary?.columns.toLocaleString() ?? 0}</dd></div>
          <div><dt>Source</dt><dd>Recovered RVT geometry</dd></div>
          {selectedDerivedRooms && (
            <>
              <div><dt>Derived regions</dt><dd>{selectedDerivedRooms.rooms.length}</dd></div>
              <div><dt>Barrier inputs</dt><dd>{selectedDerivedRooms.barrierElementCount}</dd></div>
              <div><dt>Plan cut</dt><dd>{selectedDerivedRooms.planCutElevationFeet.toFixed(1)}′</dd></div>
              <div><dt>Grid resolution</dt><dd>{selectedDerivedRooms.cellSizeFeet.toFixed(1)}′</dd></div>
            </>
          )}
        </dl>

        <div className="floor-plan-legend" aria-label="Architectural map legend">
          <span><i className="wall" />Walls</span>
          <span><i className="door" />Doors</span>
          <span><i className="window" />Windows</span>
          <span><i className="stair" />Stairs</span>
        </div>

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
              ? `${selectedDerivedRooms.rooms.length} approximate floor region${selectedDerivedRooms.rooms.length === 1 ? "" : "s"} closed by recovered walls or curtain boundaries.`
              : "No regions are fully enclosed by recovered vertical barriers at the plan cut."}
          </p>
        )}

        {selectedDerivedRooms?.rooms.length ? (
          <details className="floor-browser-region-list">
            <summary>Region list</summary>
            <ol>{selectedDerivedRooms.rooms.map((region) => (
              <li key={region.id}><span>F{region.id}</span><span>{Math.round(region.areaSquareFeet).toLocaleString()} ft² approx.</span></li>
            ))}</ol>
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

      <figure className="floor-browser-preview">
        <div className="floor-browser-preview-toolbar" role="group" aria-label="Floor map view controls">
          <button type="button" aria-label="Zoom floor map out" disabled={zoom <= 1} onClick={() => setZoom((value) => Math.max(1, value / 1.5))}><Minus size={13} /></button>
          <button type="button" aria-label="Fit whole floor map" onClick={() => setZoom(1)}><Maximize2 size={13} /> Fit</button>
          <button type="button" aria-label="Zoom floor map in" disabled={zoom >= 6} onClick={() => setZoom((value) => Math.min(6, value * 1.5))}><Plus size={13} /></button>
          <button type="button" aria-label="Rotate floor map counter-clockwise" onClick={() => setRotationQuarterTurns((value) => (value + 3) % 4)}><RotateCcw size={13} /></button>
          <button type="button" aria-label="Rotate floor map clockwise" onClick={() => setRotationQuarterTurns((value) => (value + 1) % 4)}><RotateCw size={13} /></button>
          <span>{Math.round(zoom * 100)}% · {rotationQuarterTurns * 90}°</span>
        </div>
        <div className="floor-browser-plan-scroll">
          {/* The data URL is generated entirely from bounded numeric RVT geometry. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
            alt={`Architectural floor map at ${selected.elevation.toFixed(1)} feet with recovered walls, doors, windows, stairs, and columns`}
          />
        </div>
        <figcaption>
          Architectural plan assembled from recovered RVT geometry. Door swings are indicative because the persisted opening does not always expose Revit&apos;s swing side.
          {selectedDerivedRooms
            ? " F-labels are approximate floor regions partitioned by recovered vertical barriers—not Revit Rooms."
            : " Turn on Derived floor regions to inspect approximate barrier partitions."}
        </figcaption>
      </figure>
    </div>
  );
}
