"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, MapPinned } from "lucide-react";

import {
  downloadBlob,
  floorPlateLevels,
  floorPlateSvgDataUrl,
  makeFloorPlateSvg,
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
  sideMapOpen,
  onSideMap,
}: {
  result: ConvertResult;
  selectedLevelId: number | null;
  onSelectedLevelId: (levelId: number) => void;
  showDerivedRooms: boolean;
  onShowDerivedRooms: (visible: boolean) => void;
  derivedRooms: DerivedRoomResult | null;
  sideMapOpen: boolean;
  onSideMap: () => void;
}) {
  const [downloadStatus, setDownloadStatus] = useState("");
  const levels = useMemo(() => floorPlateLevels(result), [result]);
  const selectedIndex = Math.max(0, levels.findIndex(
    (level) => level.levelId === selectedLevelId,
  ));
  const selected = levels[selectedIndex] ?? null;
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
      ? makeFloorPlateSvg(result, selected.levelId, { derivedRooms: selectedDerivedRooms ?? false })
      : null,
    [result, selected, selectedDerivedRooms],
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
    if (level) onSelectedLevelId(level.levelId);
  };
  const download = () => downloadBlob(
    new Blob([svg], { type: "image/svg+xml" }),
    outputName(
      result.fileName,
      `floor-plates-${selected.levelId}${showDerivedRooms ? "-derived-rooms" : ""}.svg`,
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
            onChange={(event) => onSelectedLevelId(Number(event.target.value))}
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
          <div><dt>Source</dt><dd>Native sketch loops</dd></div>
          {selectedDerivedRooms && (
            <>
              <div><dt>Derived regions</dt><dd>{selectedDerivedRooms.rooms.length}</dd></div>
              <div><dt>Barrier inputs</dt><dd>{selectedDerivedRooms.barrierElementCount}</dd></div>
              <div><dt>Plan cut</dt><dd>{selectedDerivedRooms.planCutElevationFeet.toFixed(1)}′</dd></div>
              <div><dt>Grid resolution</dt><dd>{selectedDerivedRooms.cellSizeFeet.toFixed(1)}′</dd></div>
            </>
          )}
        </dl>

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

        <button type="button" className="rv-button floor-browser-side-map" aria-expanded={sideMapOpen} aria-controls="floor-navigation-map" onClick={onSideMap}>
          <MapPinned size={14} aria-hidden />
          {sideMapOpen ? "Close side sub-map" : "Open side sub-map"}
        </button>

        <button type="button" className="rv-button floor-browser-download" onClick={() => { download(); setDownloadStatus("Floor SVG download started"); }}>
          <Download size={14} aria-hidden /> Download this floor SVG
        </button>
        <span className="sr-only" role="status" aria-live="polite">{downloadStatus}</span>
      </aside>

      <figure className="floor-browser-preview">
        {/* The data URL is generated entirely from bounded numeric RVT geometry. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={`Actual Revit floor plates at ${selected.elevation.toFixed(1)} feet`}
        />
        <figcaption>
          Actual `Floors` slab boundaries and openings.
          {selectedDerivedRooms
            ? " Orange F-labels are approximate floor regions partitioned by recovered vertical barriers—not Revit Rooms."
            : " Turn on Derived floor regions to inspect approximate barrier partitions."}
        </figcaption>
      </figure>
    </div>
  );
}
