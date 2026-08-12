export { convertRvtBytes } from "./convert.ts";
export {
  applyIfcReferenceRepairs,
  incompleteExpectedStairTopologyIds,
} from "./reference-assisted-recovery.ts";
export {
  parseBasicFileInfoProperties,
  redactBasicFileInfoProperties,
  revitVersionFromBasicFileInfo,
} from "./basic-file-info.ts";
export type { BasicFileInfoProperties } from "./basic-file-info.ts";
export { decodeRevitTextBytes } from "./revit-text-encoding.ts";
export type { DecodedRevitText, RevitTextEncoding } from "./revit-text-encoding.ts";
export { dwgThumbnailBlob, extractDwgThumbnail } from "./dwg-thumbnail.ts";
export { formatFeetInches } from "./format-length.ts";
export type { DwgThumbnail } from "./dwg-thumbnail.ts";
export {
  indexFamilyLibraryFiles,
  searchFamilyLibrary,
  serializableFamilyLibraryIndex,
} from "./family-library.ts";
export type {
  FamilyLibraryEntry,
  FamilyLibraryError,
  FamilyLibraryIndex,
  FamilyLibraryProgress,
} from "./family-library.ts";
export { partAtomMetadataFromSummary } from "./part-atom.ts";
export { parsePartAtomXml } from "./part-atom.ts";
export { parseProjectInformationArchive } from "./project-information.ts";
export { parseRevitTransmissionData } from "./transmission-data.ts";
export type {
  RevitExternalFileReference,
  RevitTransmissionData,
  RevitTransmissionDataOptions,
} from "./transmission-data.ts";
export { scanPersistedDwgFileNames } from "./cad-files.ts";
export type { PersistedCadFileName } from "./cad-files.ts";
export { cropFloorReferenceCatalogSvg, parseFloorReferenceCatalogSvg, withFloorReferenceIntrinsicSize } from "./floor-reference-catalog.ts";
export type { FloorReferenceCatalog, FloorReferenceCatalogBounds, FloorReferenceCatalogSection } from "./floor-reference-catalog.ts";
export type {
  PartAtomDesignFile,
  PartAtomFeature,
  PartAtomFeatureGroup,
  PartAtomFamilyType,
  PartAtomLink,
  PartAtomMetadata,
  PartAtomParameter,
  PartAtomTerm,
} from "./part-atom.ts";
export {
  compareSharedParameterDocuments,
  deduplicateSharedParameterDocument,
  mergeSharedParameterDocuments,
  parseSharedParameterBytes,
  parseSharedParameterFile,
  regroupSharedParameters,
  validateSharedParameterDocument,
  writeSharedParameterFile,
} from "./shared-parameters.ts";
export type {
  DecodedSharedParameterDocument,
  SharedParameterComparison,
  SharedParameterDefinition,
  SharedParameterDifference,
  SharedParameterDocument,
  SharedParameterGroup,
  SharedParameterIssue,
} from "./shared-parameters.ts";
export { parseTypeCatalog, parseTypeCatalogBytes, writeTypeCatalog } from "./type-catalog.ts";
export type {
  DecodedTypeCatalog,
  TypeCatalog,
  TypeCatalogParameter,
  TypeCatalogType,
} from "./type-catalog.ts";
export {
  loadBundledOmniClassTaxonomy,
  mergeOmniClassTaxonomies,
  omniClassForPartAtom,
  parseOmniClassTaxonomy,
  searchOmniClassTaxonomy,
  writeOmniClassTaxonomy,
} from "./omniclass.ts";
export type { BundledOmniClassEdition, OmniClassItem } from "./omniclass.ts";
export { loadLegacyRevit2021Api } from "./legacy-revit-2021.ts";
export type {
  LegacyCategoryInfo,
  LegacyDisplayUnitInfo,
  LegacyNamedValue,
  LegacyParameterTypeInfo,
  LegacyRevit2021Api,
  LegacyRevit2021EnumName,
  LegacyRevit2021MapName,
  LegacySearchResult,
  LegacyUnitSymbolInfo,
  LegacyUnitTypeInfo,
} from "./legacy-revit-2021.ts";
export {
  boundsOfRecords,
  detectDuplicatedBoundsRecord,
  detectDuplicatedBoundsRecords,
  solidBounds,
} from "./bounds-records.ts";
export type { DetectedBoundsRecord } from "./bounds-records.ts";
export { boxDifference, drawnBounds } from "./drawn-bounds.ts";
export type { Box } from "./drawn-bounds.ts";
export { meshBoundsByElement } from "./mesh-element-bounds.ts";
export {
  packMeshSurfaceOrientationSignatures,
  slopedSurfaceFraction,
} from "./surface-orientation.ts";
export {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  isRevitChecksumPagedStream,
  REVIT_PAGE_CHECKSUM_BYTES,
  REVIT_PAGE_PAYLOAD_BYTES,
  REVIT_STORED_PAGE_BYTES,
  REVIT_WINDOW_BYTES,
  revitStoredPageOffset,
  revitWindowTail,
  stripRevitPageChecksums,
} from "./revit-container.ts";
export {
  buildBoundsMeshes,
  boundsPlanSegments,
  displayMaterials,
  displayRole,
  elementDisplayRoles,
  glazingElementIds,
  levelsForBounds,
  levelsFromRelations,
  selectDisplayBounds,
} from "./scene.ts";
export type { DisplayRole, DisplaySelection } from "./scene.ts";
export { scanSegments, segmentScaleFor } from "./segment-scan.ts";
export { builtInCategoryName, humaniseCategoryName } from "./built-in-categories.ts";
export { builtInParameterName, parameterDisplayName } from "./built-in-parameters.ts";
export { chainElementObjects, dominantMarker } from "./element-objects.ts";
export { collectElementParameters } from "./element-parameters.ts";
export { collectOwnedSurfaces, collectSurfaces, summariseSurfaces } from "./surfaces.ts";
export { surfaceQuadsFor, wallArcs, wallArcsFor, wallSolids, wallSolidsFor } from "./native-geometry.ts";
export { instanceCorners, readInstancePlacement, readLocalBounds } from "./instanced-geometry.ts";
export type { InstancePlacement, LocalBounds } from "./instanced-geometry.ts";
export {
  resolveFamilySymbolRelations,
  resolveGeometryMaterialAssignments,
  scanPersistedRelationshipCandidates,
} from "./family-material-relations.ts";
export { resolveHostRelations, scanHostRelationCandidates } from "./host-relations.ts";
export type {
  HostRelationCandidate,
  NativeHostRelation,
} from "./host-relations.ts";
export {
  resolveAssociatedLevelRelations,
  REVIT_2027_LEVEL_MARKER,
  scanAssociatedLevelRelationCandidates,
} from "./level-relations.ts";
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
  PersistedRelationshipScan,
} from "./family-material-relations.ts";
export { assembleRings, boundaryLoopsFor, collectSketchCurves } from "./sketch-curves.ts";
export type { BoundaryLoop, Point3, SketchCurve } from "./sketch-curves.ts";
export { tessellateNeutralBrep, tessellatePlanarBrep } from "./brep-tessellator.ts";
export type {
  BrepCylinderSurface,
  BrepMatrix4,
  BrepParamPoint2,
  BrepPlaneSurface,
  BrepPoint3,
  BrepProvenance,
  BrepSurface,
  BrepTessellationIssue,
  BrepTessellationIssueCode,
  BrepTessellationOptions,
  BrepTessellationResult,
  BrepTrimCurve,
  BrepTrimLoop,
  NeutralBrep,
  NeutralBrepFace,
  NeutralFaceMesh,
  NeutralMeshFaceGroup,
} from "./brep-tessellator.ts";
export { ringArea, triangulate } from "./polygon.ts";
export type { Point2 } from "./polygon.ts";
export { collectTypeLinks } from "./element-types.ts";
export type { ElementParameter, ElementParameterTable } from "./element-parameters.ts";
export type { ElementObject } from "./element-objects.ts";
export { parseSchemaTags, summariseSchema } from "./schema.ts";
export { parsePartitionNames } from "./partition-names.ts";
export { measureStream, summariseCoverage } from "./stream-coverage.ts";
export type { SegmentScale } from "./segment-scan.ts";
export {
  decodeArcWall2023Record,
  decodeRvtMaterialDefinitions,
  decoderPlanForVersion,
  scanArcWall2023Records,
} from "./native-decoder.ts";
export { detectElemTableLayout, parseElemTable } from "./elem-table.ts";
export {
  decodeRevitDocumentHistory,
  decodeRevitNativeIdentities,
  formatNativeRevitUniqueId,
  formatRevitGuid,
} from "./native-identity.ts";
export {
  applyNativeCategories,
  categoryDisplayName,
  collectCategoryTokens,
  deriveRecordCodeCategories,
  isNamedCategory,
  recordCodeKey,
  resolveElementCategories,
} from "./native-categories.ts";
export { classCoverage } from "./coverage.ts";
export { doorLeafCorners } from "./door-leaf.ts";
export type { WallRun } from "./door-leaf.ts";
export type { ClassCoverage } from "./coverage.ts";
export { compareRvtToIfc } from "./regression.ts";
export {
  STANDARDS_READER_MAX_VERSION,
  STANDARDS_READER_MIN_VERSION,
  STANDARDS_READER_RANGE_LABEL,
  standardsReaderSupports,
} from "./reader-support.ts";
export { NO_CLASS_RECORD_CODE, STAIR_COMPANION_CODE } from "./record-codes.ts";
export {
  boundsDimensions,
  CAMERA_PRESETS,
  cameraPoseForPreset,
  DEFAULT_CAMERA_PRESET,
  FEET_PER_METRE,
  isPlanPreset,
  referenceRegistration,
  solidElementBounds,
} from "./viewer.ts";
export {
  downloadBlob,
  elementManifest,
  makeDxf,
  makeGlb,
  makeIfc,
  makeIfcCenterlines,
  makeObj,
  makeFloorPlateSvg,
  makeArchitecturalFloorSvg,
  architecturalPlanSummary,
  planDrawingFrame,
  planWorldPoint,
  connectedFloorPlanGroup,
  connectedFloorPlanGroups,
  IDENTITY_FLOOR_REFERENCE_TRANSFORM,
  applyFloorReferenceTransform,
  composeFloorReferenceTransform,
  decomposeFloorReferenceTransform,
  fitFloorReferenceTransform,
  floorReferenceTransformAttribute,
  makeFloorReferenceAlignment,
  parseFloorReferenceAlignment,
  floorPlateBounds,
  floorPlateSvgDataUrl,
  makePlanSvg,
  floorPlateLevels,
  floorPlateRecords,
  planSegments,
  makeReport,
  outputName,
} from "./exports.ts";
export { cachedDerivedRoomsForLevel, deriveRoomsForLevel, deriveRoomsForLevels } from "./derived-rooms.ts";
export type {
  DerivedRoom,
  DerivedRoomGap,
  DerivedRoomOptions,
  DerivedRoomResult,
} from "./derived-rooms.ts";
export { isReviewedGap, isReviewedRoom, mergeRoomReview, reconcileRoomReview, ROOM_REVIEW_VERSION } from "./room-review.ts";
export type { GapDisposition, ReviewedGap, ReviewedRoom, RoomDetails, RoomDisposition, RoomReviewSidecar, RoomReviewState } from "./room-review.ts";
export type { FloorPlateLevel, FloorPlateSvgOptions, PlanSvgOptions } from "./exports.ts";
export type { ArchitecturalPlanSummary, ArchitecturalPlanSvgOptions } from "./exports.ts";
export type { IfcExportOptions } from "./export-ifc.ts";
export type { ConnectedFloorPlanConnection, ConnectedFloorPlanGroup } from "./exports.ts";
export type {
  FloorReferenceAlignment,
  FloorReferenceControlPair,
  FloorReferencePoint,
  FloorReferenceTransform,
} from "./exports.ts";
export type {
  Bounds3,
  ConvertFailure,
  ConvertOptions,
  ConvertOutcome,
  ConvertResult,
  ConvertStats,
  DecoderCoverage,
  ElemTableLayout,
  ElementBoundsRecord,
  GateStatus,
  IfcElementTypeMatch,
  IfcMatchedElement,
  IfcReferenceManifest,
  IfcWorkerRequest,
  IfcWorkerResponse,
  LevelBand,
  MaterialData,
  MeshData,
  MeshGeometrySource,
  NativeCategoryCodeConsensus,
  NativeCategoryCount,
  NativeCategorySource,
  NativeCategorySummary,
  NativeProfileLocator,
  SchemaClass,
  SchemaReference,
  SchemaSummary,
  CoverageSummary,
  PartitionName,
  StreamCoverage,
  StreamDecoder,
  ProgressUpdate,
  ReaderDiagnostics,
  ReferenceMeshData,
  RegressionGate,
  RvtElementIndex,
  RvtRegressionInput,
  PairedRegressionResult,
  PartitionRecordLocator,
  Segment,
  Vec3,
  WorkerRequest,
  WorkerResponse,
} from "./types.ts";
export type { CameraPose, CameraPreset, NavigationMode, RenderMode } from "./viewer.ts";
