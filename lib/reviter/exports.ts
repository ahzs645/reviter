/**
 * Open-format exports.
 *
 * This is a barrel; each format lives in its own module so a change to one
 * cannot disturb another. Import a single format directly when bundle size
 * matters.
 */
export { downloadBlob, outputName } from "./export-naming.ts";
export { makeGlb } from "./export-glb.ts";
export { makeDxf, makeObj } from "./export-mesh-text.ts";
export { floorPlateBounds, floorPlateLevels, floorPlateRecords, floorPlateSvgDataUrl, makeFloorPlateSvg, makePlanSvg, planSegments } from "./export-svg.ts";
export type { FloorPlateLevel, FloorPlateSvgOptions, PlanSvgOptions } from "./export-svg.ts";
export { architecturalPlanSummary, makeArchitecturalFloorSvg, planDrawingFrame, planWorldPoint } from "./architectural-plan.ts";
export type { ArchitecturalPlanSummary, ArchitecturalPlanSvgOptions } from "./architectural-plan.ts";
export { connectedFloorPlanGroup, connectedFloorPlanGroups } from "./connected-floor-plans.ts";
export type { ConnectedFloorPlanConnection, ConnectedFloorPlanGroup } from "./connected-floor-plans.ts";
export {
  IDENTITY_FLOOR_REFERENCE_TRANSFORM,
  applyFloorReferenceTransform,
  composeFloorReferenceTransform,
  decomposeFloorReferenceTransform,
  fitFloorReferenceTransform,
  floorReferenceTransformAttribute,
  makeFloorReferenceAlignment,
  parseFloorReferenceAlignment,
} from "./floor-reference-overlay.ts";
export type {
  FloorReferenceAlignment,
  FloorReferenceControlPair,
  FloorReferencePoint,
  FloorReferenceTransform,
} from "./floor-reference-overlay.ts";
export { cropFloorReferenceCatalogSvg, parseFloorReferenceCatalogSvg } from "./floor-reference-catalog.ts";
export type { FloorReferenceCatalog, FloorReferenceCatalogBounds, FloorReferenceCatalogSection } from "./floor-reference-catalog.ts";
export { cachedDerivedRoomsForLevel, deriveRoomsForLevel, deriveRoomsForLevels } from "./derived-rooms.ts";
export type { DerivedRoom, DerivedRoomGap, DerivedRoomOptions, DerivedRoomResult } from "./derived-rooms.ts";
export { isReviewedGap, isReviewedRoom, mergeRoomReview, reconcileRoomReview, ROOM_REVIEW_VERSION } from "./room-review.ts";
export type { GapDisposition, ReviewedGap, ReviewedRoom, RoomDetails, RoomDisposition, RoomReviewSidecar, RoomReviewState } from "./room-review.ts";
export { makeIfc, makeIfcCenterlines } from "./export-ifc.ts";
export type { IfcExportOptions } from "./export-ifc.ts";
export { elementManifest, makeReport } from "./export-report.ts";
