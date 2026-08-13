/**
 * The library's public surface.
 *
 * Everything re-exported here is a name some consumer imports as
 * `from "@/lib/reviter"`, plus the types those names carry in their
 * signatures. Nothing else belongs on this list: the modules underneath are
 * deep-importable by path, which is how the tests, the audit scripts and the
 * library's own internals reach the parts that are not public API. A name that
 * appears here is a commitment; a name that only ever had one caller inside
 * `lib/reviter/` is not one.
 *
 * One statement per module, grouped by what the module is for. The order below
 * follows the pipeline: read the file, understand what is in it, recover
 * geometry and relations, then draw, review and export.
 */

// ─── Conversion ──────────────────────────────────────────────────────────────
// The entry point and the vocabulary its result is written in.

export { convertRvtBytes } from "./convert.ts";
export type {
  Bounds3,
  ConvertFailure,
  ConvertOptions,
  ConvertOutcome,
  ConvertResult,
  ConvertStats,
  CoverageSummary,
  DecoderCoverage,
  ElemTableLayout,
  ElementBoundsRecord,
  ElementParameter,
  GateStatus,
  IfcElementTypeMatch,
  IfcMatchedElement,
  IfcReferenceManifest,
  IfcWorkerRequest,
  LevelBand,
  MaterialData,
  MeshData,
  MeshGeometrySource,
  NativeCategoryCodeConsensus,
  NativeCategoryCount,
  NativeCategorySource,
  NativeCategorySummary,
  NativeProfileLocator,
  PairedRegressionResult,
  PartitionName,
  PartitionRecordLocator,
  Point3,
  ProgressUpdate,
  ReaderDiagnostics,
  ReferenceMeshData,
  RegressionGate,
  RvtElementIndex,
  RvtRegressionInput,
  SchemaClass,
  SchemaReference,
  SchemaSummary,
  Segment,
  StreamCoverage,
  StreamDecoder,
  Vec3,
  WorkerRequest,
} from "./types.ts";

// ─── Source-file identity and metadata ───────────────────────────────────────
// What the file says about itself before any geometry is decoded.

export {
  parseBasicFileInfoProperties,
  revitVersionFromBasicFileInfo,
  type BasicFileInfoProperties,
} from "./basic-file-info.ts";
export type { DecodedRevitText, RevitTextEncoding } from "./revit-text-encoding.ts";
export type { RevitExternalFileReference, RevitTransmissionData } from "./transmission-data.ts";
export type { PersistedCadFileName } from "./cad-files.ts";
export { STANDARDS_READER_RANGE_LABEL, standardsReaderSupports } from "./reader-support.ts";
export { classCoverage, type ClassCoverage } from "./coverage.ts";

// ─── Revit content libraries ─────────────────────────────────────────────────
// Standalone Autodesk formats that travel beside an RVT: family libraries,
// shared parameters, type catalogues, classification taxonomies, and the
// optional Revit 2021 vocabulary for reading old files.

export {
  indexFamilyLibraryFiles,
  searchFamilyLibrary,
  type FamilyLibraryEntry,
  type FamilyLibraryError,
  type FamilyLibraryIndex,
  type FamilyLibraryProgress,
} from "./family-library.ts";
export type {
  PartAtomDesignFile,
  PartAtomFamilyType,
  PartAtomFeature,
  PartAtomFeatureGroup,
  PartAtomLink,
  PartAtomMetadata,
  PartAtomParameter,
  PartAtomTerm,
} from "./part-atom.ts";
export {
  compareSharedParameterDocuments,
  mergeSharedParameterDocuments,
  parseSharedParameterBytes,
  validateSharedParameterDocument,
  writeSharedParameterFile,
  type DecodedSharedParameterDocument,
  type SharedParameterComparison,
  type SharedParameterDefinition,
  type SharedParameterDifference,
  type SharedParameterDocument,
  type SharedParameterGroup,
  type SharedParameterIssue,
} from "./shared-parameters.ts";
export type { TypeCatalog, TypeCatalogParameter, TypeCatalogType } from "./type-catalog.ts";
export {
  loadBundledOmniClassTaxonomy,
  searchOmniClassTaxonomy,
  type BundledOmniClassEdition,
  type OmniClassItem,
} from "./omniclass.ts";
export {
  loadLegacyRevit2021Api,
  type LegacyCategoryInfo,
  type LegacyDisplayUnitInfo,
  type LegacyNamedValue,
  type LegacyParameterTypeInfo,
  type LegacyRevit2021Api,
  type LegacyRevit2021EnumName,
  type LegacyRevit2021MapName,
  type LegacySearchResult,
  type LegacyUnitSymbolInfo,
  type LegacyUnitTypeInfo,
} from "./legacy-revit-2021.ts";

// ─── Recovered native relations ──────────────────────────────────────────────
// Element-to-element evidence lifted out of the partition streams.

export type { HostRelationCandidate, NativeHostRelation } from "./host-relations.ts";
export type {
  AssociatedLevelFieldOffset,
  AssociatedLevelRelationCandidate,
  NativeAssociatedLevelRelation,
} from "./level-relations.ts";
export type {
  FamilySymbolCandidate,
  GeometryMaterialCandidate,
  NativeFamilySymbolRelation,
  NativeGeometryMaterialAssignment,
} from "./family-material-relations.ts";

// ─── Geometry and the 3-D viewer ─────────────────────────────────────────────

export type { Box } from "./drawn-bounds.ts";
export { meshBoundsByElement } from "./mesh-element-bounds.ts";
export { packMeshSurfaceOrientationSignatures } from "./surface-orientation.ts";
export {
  CAMERA_PRESETS,
  DEFAULT_CAMERA_PRESET,
  boundsDimensions,
  cameraPoseForPreset,
  type CameraPose,
  type CameraPreset,
  type NavigationMode,
  type OrbitDragConvention,
  type RenderMode,
} from "./viewer.ts";

// ─── Rooms and review ────────────────────────────────────────────────────────
// Regions inferred from recovered barriers, and the human dispositions that
// promote them to named rooms.

export {
  deriveRoomsForLevels,
  type DerivedRoom,
  type DerivedRoomGap,
  type DerivedRoomOptions,
  type DerivedRoomResult,
} from "./derived-rooms.ts";
export {
  mergeRoomReview,
  reconcileRoomReview,
  type GapDisposition,
  type ReviewedGap,
  type ReviewedRoom,
  type RoomDetails,
  type RoomDisposition,
  type RoomReviewState,
} from "./room-review.ts";

// ─── Paired-IFC reference analysis ───────────────────────────────────────────

export {
  applyIfcReferenceRepairs,
  incompleteExpectedStairTopologyIds,
  type IfcReferenceRepairOptions,
} from "./reference-assisted-recovery.ts";

// ─── Drawings and open-format exports ────────────────────────────────────────
// One module per output format behind `./exports.ts`; import a single format
// directly from its module when bundle size matters.

export {
  IDENTITY_FLOOR_REFERENCE_TRANSFORM,
  applyFloorReferenceTransform,
  composeFloorReferenceTransform,
  connectedFloorPlanGroup,
  connectedFloorPlanGroups,
  decomposeFloorReferenceTransform,
  downloadBlob,
  fitFloorReferenceTransform,
  floorPlateBounds,
  floorPlateLevels,
  floorPlateSvgDataUrl,
  floorReferenceTransformAttribute,
  makeArchitecturalFloorSvg,
  makeDxf,
  makeFloorPlateSvg,
  makeFloorReferenceAlignment,
  makeGlb,
  makeIfcCenterlines,
  makeObj,
  makePlanSvg,
  makeReport,
  outputName,
  parseFloorReferenceAlignment,
  planDrawingFrame,
  planWorldPoint,
  type ArchitecturalPlanRoomLabel,
  type ArchitecturalPlanSvgOptions,
  type ConnectedFloorPlanConnection,
  type ConnectedFloorPlanGroup,
  type FloorPlateLevel,
  type FloorPlateSvgOptions,
  type FloorReferenceAlignment,
  type FloorReferenceControlPair,
  type FloorReferencePoint,
  type FloorReferenceTransform,
  type PlanDrawingFrame,
  type PlanSvgOptions,
  type PlanTheme,
} from "./exports.ts";
export type { IfcExportOptions } from "./export-ifc.ts";

// ─── Reference drawings ──────────────────────────────────────────────────────
// Supplied CAD floor plans registered against the recovered model.

export {
  cropFloorReferenceCatalogSvg,
  parseFloorReferenceCatalogSvg,
  withFloorReferenceIntrinsicSize,
  type FloorReferenceCatalog,
  type FloorReferenceCatalogBounds,
  type FloorReferenceCatalogSection,
} from "./floor-reference-catalog.ts";
export { dwgThumbnailBlob, extractDwgThumbnail, type DwgThumbnail } from "./dwg-thumbnail.ts";

// ─── Presentation helpers ────────────────────────────────────────────────────

export { formatFeetInches } from "./format-length.ts";
