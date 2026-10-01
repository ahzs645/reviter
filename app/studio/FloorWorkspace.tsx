"use client";

import { Box } from "lucide-react";
import { useState } from "react";

import type { ConvertResult, DerivedRoomResult, RoomReviewState } from "../../lib/reviter";
import { FloorBrowser } from "./FloorBrowser.tsx";
import { BuildingDirectory } from "./BuildingDirectory.tsx";
import type { DirectoryModelFloor } from "./directory-model.ts";

/**
 * A first-class plan workspace. Floor geometry is inspection/navigation work,
 * not a recovery-report detail, so it gets the same amount of room as the 3D
 * model and a direct route back into that model's synchronized navigation map.
 */
export function FloorWorkspace({
  result,
  roomFile,
  modelFile,
  onImportProject,
  selectedLevelId,
  onSelectedLevelId,
  showDerivedRooms,
  onShowDerivedRooms,
  derivedRooms,
  roomReview,
  onRoomReview,
  onModel,
  onOpenModelMap,
  onShowDirectoryModel,
  directoryRoomRequest,
}: {
  result: ConvertResult;
  roomFile?: File | null;
  modelFile?: File | null;
  onImportProject?: () => void;
  selectedLevelId: number | null;
  onSelectedLevelId: (levelId: number) => void;
  showDerivedRooms: boolean;
  onShowDerivedRooms: (visible: boolean) => void;
  derivedRooms: DerivedRoomResult | null;
  roomReview: RoomReviewState;
  onRoomReview: (review: RoomReviewState) => void;
  onModel: () => void;
  onOpenModelMap: () => void;
  onShowDirectoryModel: (floor: DirectoryModelFloor) => void;
  directoryRoomRequest: {key: string; sequence: number} | null;
}) {
  const [view, setView] = useState<"plan" | "directory">(roomFile ? "directory" : "plan");
  const [handledRoomRequest, setHandledRoomRequest] = useState(directoryRoomRequest);
  if (directoryRoomRequest !== handledRoomRequest) {
    setHandledRoomRequest(directoryRoomRequest);
    if (directoryRoomRequest) setView("directory");
  }
  return (
    <section className="floor-workspace" aria-labelledby="floor-workspace-title">
      <header className="floor-workspace-header">
        <div>
          <span>Floor workspace</span>
          <h1 id="floor-workspace-title">Revit Floors</h1>
          <p>Read each level as an architectural map assembled from native slabs, walls, openings, windows, stairs, and columns.</p>
        </div>
        <div className="floor-workspace-actions">
          <button type="button" className="rv-button" aria-pressed={view === "plan"} onClick={() => setView("plan")}>Floor plan</button>
          <button type="button" className="rv-button" aria-pressed={view === "directory"} onClick={() => setView("directory")}>Building directory</button>
          <button type="button" className="rv-button rv-button-quiet" onClick={onModel}>
            <Box size={14} aria-hidden /> Back to model
          </button>
        </div>
      </header>

      <div className="floor-workspace-body">
        <div hidden={view !== "directory"} className="floor-directory-view"><BuildingDirectory modelFile={modelFile} onImportProject={onImportProject} result={result} initialRoomFile={roomFile} onShowModel={onShowDirectoryModel} roomRequest={directoryRoomRequest} /></div>
        <div hidden={view !== "plan"} className="floor-plan-view">
        <FloorBrowser
          result={result}
          selectedLevelId={selectedLevelId}
          onSelectedLevelId={onSelectedLevelId}
          showDerivedRooms={showDerivedRooms}
          onShowDerivedRooms={onShowDerivedRooms}
          derivedRooms={derivedRooms}
          roomReview={roomReview}
          onRoomReview={onRoomReview}
          onOpenModelMap={onOpenModelMap}
        />
        </div>
      </div>
    </section>
  );
}
