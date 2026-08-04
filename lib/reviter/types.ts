import type { ElementParameter } from "./element-parameters.ts";
import type { LimitCensusEntry } from "./limit-census.ts";
import type { SchemaSummary } from "./schema.ts";
import type { SurfaceSummary } from "./surfaces.ts";
import type { SurfaceQuad, WallArc, WallSolid } from "./native-geometry.ts";
import type { Point3 } from "./sketch-curves.ts";
import type { CoverageSummary } from "./stream-coverage.ts";
import type { PartitionName } from "./partition-names.ts";
import type { PartAtomMetadata } from "./part-atom.ts";
import type { RevitTransmissionData } from "./transmission-data.ts";
import type { ElementOwnershipDecode } from "./element-relations.ts";
import type { NativeIdentityDecode } from "./native-identity.ts";
import type { NativeMaterialDefinition } from "./material-records.ts";
import type {
  NativeFamilyDefinition,
  NativeFamilySymbolRelation,
  NativeElementMaterialAssignment,
  NativeGeometryMaterialAssignment,
} from "./family-material-relations.ts";
import type {
  NativeCompoundLayerMaterialAssignment,
  NativeCompoundStructureDefinition,
} from "./compound-structure-materials.ts";
import type { NativeHostRelation } from "./host-relations.ts";
import type { NativeAssociatedLevelRelation } from "./level-relations.ts";
import type { PersistedCadFileName } from "./cad-files.ts";

export type { SchemaClass, SchemaReference, SchemaSummary } from "./schema.ts";
export type { ElementParameter, ElementParameterTable } from "./element-parameters.ts";
export type { TypeLinks, TypeNameRecord, TypeReference } from "./element-types.ts";
export type { PartitionName } from "./partition-names.ts";
export type { CylinderPatch, OwnedSurface, PlanePatch, SurfacePatch, SurfaceSummary } from "./surfaces.ts";
export type { SurfaceQuad, WallArc, WallSolid } from "./native-geometry.ts";
export type { BoundaryLoop, Point3, SketchCurve } from "./sketch-curves.ts";
export type { CoverageSummary, StreamCoverage, StreamDecoder } from "./stream-coverage.ts";

export type Vec3 = { x: number; y: number; z: number };

export type Segment = {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
};

export type MeshData = {
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
  colors: Float32Array;
  materialIndex: number;
  /**
   * One native Revit element id per triangle, indexed by face index. Drawn
   * items are no longer all 12-triangle boxes — an extruded sketch boundary has
   * as many triangles as its ring has edges — so picking indexes per triangle.
   */
  elementIds?: Uint32Array;
  /**
   * Exact persisted MaterialElem id shared by every triangle in this batch.
   * Absent when the face style is null, unresolved, or mixed.
   */
  nativeMaterialElementId?: number;
  /**
   * How this batch's geometry was produced.
   *
   * The viewer used to infer this from the batch *name* — a `startsWith` test
   * that silently stopped matching once batches were labelled by decoded Revit
   * category, and which cannot distinguish a tessellated native BRep from a
   * twelve-triangle envelope box in any case. The two need genuinely different
   * treatment: a wireframe overlay makes a box proxy legible and turns 912,044
   * triangles of native geometry into moiré.
   */
  source?: "native-brep" | "display-proxy" | "reference-ifc";
};

export type MaterialData = {
  name: string;
  baseColorLinear: [number, number, number, number];
  metallic: number;
  roughness: number;
  doubleSided: boolean;
  source: "rvt-material" | "display-fallback";
  assignedElements: number;
  /**
   * Persisted `MaterialId.m_transparency` in `[0, 1]`, present only when the
   * field was actually decoded from the RVT. Its complement is already applied
   * to `baseColorLinear[3]`; the field itself lets a consumer tell "decoded
   * opaque" apart from "transparency unknown, defaulted to opaque" — the
   * difference between a spandrel panel and an undecoded pane of glass.
   */
  transparency?: number;
};

export type LocatedNativeMaterialDefinition = NativeMaterialDefinition & {
  stream: string;
  chunkIndex: number;
  storedOffset: number;
};

export type NativeProfileLocator = {
  decoderId: "revit-2023-arcwall-standard-v1";
  revitVersion: 2023;
  stream: string;
  chunkIndex: number;
  rawOffset: number;
  recordOffset: number;
  variant: number;
  centerline: Segment;
  duplicateMatches: boolean;
};

export type DecoderCoverage = {
  revitVersion: number | null;
  activeDecoders: string[];
  nativeCurves: number;
  nativeProfiles: number;
  /** Native MeshData render batches actually present in ConvertResult.meshes. */
  nativeMeshes: number;
  /** Independently certified drawable Face meshes before render batching. */
  nativeMeshFaces?: number;
  /** Placed/direct elements whose complete drawable Face set is emitted. */
  nativeMeshElements?: number;
  /** Native wall meshes replaced by a corroborating, tighter location-line solid. */
  nativeWallProxyReplacements?: number;
  /** Complete independently persisted GRep owners retained before placement. */
  nativeMeshOwners?: number;
  /** Exact non-legacy root shapes entering bounded tessellator replay. */
  nativeMeshBoundedTessellatorCandidates?: number;
  /** Candidate roots retained only after complete local/nested coverage. */
  nativeMeshCompleteBoundedTessellatorRoots?: number;
  /** Bounded-root elements actually emitted after envelope/output gates. */
  nativeMeshBoundedTessellatorElements?: number;
  /** GFilter-led conditioned roots entering exact FIFO replay. */
  nativeMeshConditionedGeometryCandidates?: number;
  /** Conditioned roots retained after complete local/nested coverage. */
  nativeMeshCompleteConditionedGeometryRoots?: number;
  /** Conditioned-root elements actually emitted after envelope/output gates. */
  nativeMeshConditionedGeometryElements?: number;
  /** Exact embedded-column roots entering FIFO replay. */
  nativeMeshEmbeddedGeometryCandidates?: number;
  /** Embedded roots retained after complete transformed face coverage. */
  nativeMeshCompleteEmbeddedGeometryRoots?: number;
  /** Embedded-root elements actually emitted after envelope/output gates. */
  nativeMeshEmbeddedGeometryElements?: number;
  /** Exact certified triangles emitted after owner placement expansion. */
  nativeMeshTriangles?: number;
  /** Quantized, orientation-independent duplicate native triangles suppressed. */
  nativeMeshDuplicateTrianglesRemoved?: number;
  /** Suppressed duplicates whose two copies claimed different materials. */
  nativeMeshCrossMaterialDuplicateTrianglesRemoved?: number;
  /** Original wall triangles intersected by persisted door/window openings. */
  nativeHostOpeningWallTrianglesClipped?: number;
  /** Retained wall fragments emitted around those hosted openings. */
  nativeHostOpeningWallTrianglesGenerated?: number;
  /** True when a native storage/output safety cap declined complete elements. */
  nativeMeshTruncated?: boolean;
  /** Conservative byte estimate for compact cross-page GRep definitions. */
  nativeMeshStoredBytes?: number;
  /** Complete native items rejected because their AABB escaped the RVT envelope. */
  nativeMeshBoundsMismatches?: number;
  /** Complete native items lacking an independent display-envelope cross-check. */
  nativeMeshMissingBounds?: number;
  /** Framed GRep owner definitions retained for recursive symbol resolution. */
  nativeMeshNestedDefinitions?: number;
  /** Exact persisted GInstance/InstanceInfo links retained across pages. */
  nativeMeshNestedLinks?: number;
  /** Direct scene roots containing at least one nested symbol instance. */
  nativeMeshNestedRoots?: number;
  /** Nested roots admitted only after complete recursive face coverage. */
  nativeMeshCompleteNestedRoots?: number;
  /** Nested roots kept on proxies because any recursive source failed closed. */
  nativeMeshPartialNestedRoots?: number;
  /** Exact triangles contributed by complete composed nested roots. */
  nativeMeshNestedTriangles?: number;
  /** Nested roots rejected by graph, selector, coverage, conflict, or cap checks. */
  nativeMeshNestedFailures?: number;
  nativeMeshRequestedOwnerDefinitions?: number;
  nativeMeshCompleteRequestedOwners?: number;
  nativeMeshPartialRequestedOwners?: number;
  nativeMeshRequestedOwnerTriangles?: number;
  nativeMeshRequestedOwnerFailures?: number;
  nativeMaterialDefinitions: number;
  /** Placed elements inheriting at least one exact shared-geometry material. */
  nativeMaterialAssignments: number;
  /** Exact shared-geometry to MaterialElem relations before instance expansion. */
  nativeGeometryMaterialAssignments?: number;
  /** Framed BasicWallType compound structures whose layer materials resolved. */
  nativeCompoundStructureDefinitions?: number;
  /** Layer assignments expanded through persisted element-to-type references. */
  nativeCompoundLayerMaterialAssignments?: number;
  /** Persisted instance-to-symbol links read from InstInfoBase. */
  nativeFamilySymbols?: number;
  /** Persisted FamilySymbol-to-Family links whose target class resolved. */
  nativeFamilyRelations?: number;
  /** Persisted InsertableInst host relationships. */
  nativeHostRelations?: number;
  /** Persisted Element associated-level relationships. */
  nativeAssociatedLevelRelations?: number;
  /** Native loadable-family records whose FamilyBase name/path pair decoded. */
  nativeFamilyDefinitions?: number;
  /** Native Revit UniqueIds joined from `Global/History` and `Global/ElemTable`. */
  nativeUniqueIds?: number;
  /** Native items admitted through the carrier-composition route, which skips the envelope check. */
  nativeMeshCarrierComposedItems?: number;
  /** Of those, how many the envelope cross-check would have declined. */
  nativeMeshCarrierComposedOutsideEnvelope?: number;
  /** Complete ordinary records decoded from `Global/ElemTable`. */
  nativeOwnershipRecords?: number;
  /** Persisted, non-self `OwningElementId` relations. */
  nativeOwnershipRelations?: number;
  approximateSolids: number;
  /** Elements carrying a natively decoded Revit `BuiltInCategory`. */
  nativeCategorisedElements: number;
  geometryFidelity:
    | "certified-native-brep-with-proxy-fallback"
    | "native-profile-approximate-solid"
    | "native-bounds-envelope"
    | "diagnostic-only";
  materialFidelity: "native-definitions-unassigned" | "native-assigned" | "display-fallback";
  semanticFidelity:
    | "native-categories-and-ownership"
    | "native-categories"
    | "native-ownership"
    | "record-code-heuristic"
    | "none";
};

export type ElementBoundsRecord = {
  elementId: number;
  stream: string;
  chunkIndex: number;
  rawOffset: number;
  /** Start of the nested element record inside the inflated chunk. */
  recordOffset: number;
  /** Byte offset from record start to the first of the duplicated bounds blocks. */
  boundsOffset?: number;
  recordCode?: number;
  recordCount?: number;
  /** Negative Revit `BuiltInCategory` id decoded from the partition stream. */
  categoryId?: number;
  categoryName?: string;
  categorySource?: NativeCategorySource;
  /** Instance parameters decoded from the element's own parameter table. */
  parameters?: ElementParameter[];
  /** Element id of this element's type element. */
  typeId?: number;
  /** Type name read from that type element, for system families. */
  typeName?: string;
  /** Shared FamilySymbol referenced by this placed instance. */
  familySymbolId?: number;
  /** Persisted Family target referenced by the shared FamilySymbol. */
  familyId?: number;
  /** Native loadable-family name read from the FamilyBase name/path pair. */
  familyName?: string;
  /** Oriented solid rebuilt from the element's own native surface patches. */
  solid?: WallSolid;
  /**
   * Every solid rebuilt for this element, for a run modelled in segments.
   * `solid` remains the longest of them, and is what properties report.
   */
  solids?: WallSolid[];
  /** Native faces, for elements with surfaces that do not form a solid. */
  quads?: SurfaceQuad[];
  /**
   * Curved wall segments, rebuilt from the element's own cylinder triples. A
   * curved wall has no straight location line, so without these it falls back
   * to its axis-aligned envelope — a rectangle covering the whole bulge of the
   * arc rather than the wall.
   */
  arcs?: WallArc[];
  /** Eight world corners of a placed family instance, in box-index order. */
  orientedBox?: [number, number, number][];
  /**
   * Which route cut this door's leaf out of the opening its record describes.
   * The two are worth telling apart when measuring, because they do not agree:
   * the door's own shape carries the door's own thickness, while the host wall
   * carries the wall's, and against the export that is 97% size agreement
   * against 68%.
   */
  doorLeafSource?: "shape" | "wall";
  /** Sketch boundary rings, outer first, for a floor, roof, ceiling or ramp. */
  loops?: Point3[][];
  /**
   * A railing's rail path, as world polylines, with the height of the guard
   * above it. A railing that runs around an atrium has an enormous axis-aligned
   * box — 23,877 sq ft in plan for the largest here — and drawing that box lays
   * a slab across the floor, so a railing that can be swept is swept instead.
   */
  railPath?: { polylines: Point3[][]; guardHeightFeet: number };
  /**
   * Individual horizontal treads recovered from a straight stair run's own
   * repeated plan lines and rising sketch segments.
   */
  stairTreads?: [Point3, Point3, Point3, Point3][];
  /**
   * Riser count persisted by the native StairsRun aggregate. This remains
   * useful when curve recovery fails: a positive count proves that an empty
   * `stairTreads` array is missing topology rather than a genuinely flat run.
   */
  stairExpectedRiserCount?: number;
  /**
   * Horizontal slab thickness used below each recovered stair tread.
   *
   * The supplied project's native StairsRun aggregate persists equal left/right
   * support widths, and the paired Autodesk export independently proves the
   * same 50 mm dimension on both target runs' tread extrusions.
   */
  stairTreadThicknessFeet?: number;
  /** Native StairsRun end conditions governing the exposed first/last risers. */
  stairBeginWithRiser?: boolean;
  stairEndWithRiser?: boolean;
  /**
   * A rectangular placed curtain-panel proxy clipped by the long axis of an
   * independently placed diagonal mullion. Present only for an unambiguous
   * larger-side cut; ordinary rectangular panels retain their oriented box.
   */
  inferredCurtainPanelGeometry?: {
    positions: number[];
    indices: number[];
  };
  /** Analytic planes kept only after every corner fits this panel's envelope. */
  curtainPanelSurfaceQuads?: SurfaceQuad[];
  /**
   * Provenance of the geometry that actually reached the final scene.
   *
   * This is assigned only after native admission and helper suppression, so it
   * must not be inferred earlier from whichever proxy fields happen to exist.
   */
  renderGeometryProvenance?:
    | "native"
    | "reconstructed"
    | "reference-assisted"
    | "boundary-clipped-proxy"
    | "bounds-fallback"
    | "not-rendered-helper";
  boundsFeet: Bounds3;
};

/**
 * `native-token` means the element's own category token was decoded.
 * `native-object` means a schema-specific native object proved the class.
 * `record-code-consensus` means the category was inherited from sibling records
 * that share the element's record code.
 */
export type NativeCategorySource =
  | "native-token"
  | "native-object"
  | "record-code-consensus";

export type NativeCategoryCount = {
  categoryId: number;
  name: string;
  elements: number;
};

export type NativeCategoryCodeConsensus = {
  /** `recordCode:recordCount` key of the cluster. */
  recordCode: string;
  categoryId: number;
  categoryName: string;
  support: number;
  purity: number;
};

export type NativeCategorySummary = {
  tokensFound: number;
  directElements: number;
  inheritedElements: number;
  /**
   * Elements whose direct label rests only on donated tokens — tokens whose
   * nearest real element id (per the persisted element table) is an element
   * this conversion does not draw, so the nearest-preceding ownership rule
   * fell through past the true owner.
   */
  donatedTokenElements?: number;
  /**
   * The subset of those overridden by their own record-code cluster because
   * the cluster clears the consensus floors and names a different category.
   */
  donatedTokensOverridden?: number;
  categories: NativeCategoryCount[];
  codeConsensus: NativeCategoryCodeConsensus[];
};

export type LevelBand = {
  elevation: number;
  candidates: number;
  /**
   * The Revit element id of the level, when the storey came from the file's own
   * `Element.m_assocLevelId` relations. Absent for an inferred elevation band.
   */
  levelId?: number;
  /**
   * How this band was arrived at, so a consumer can tell a storey the file
   * states from one inferred out of a pile of elevations.
   */
  source?: "assoc-level-id" | "elevation-band";
};

export type ConvertStats = {
  streamCount: number;
  partitionStreams: number;
  gzipChunks: number;
  inflatedBytes: number;
  candidatesFound: number;
  candidatesFocused: number;
  candidatesUsed: number;
  vertexCount: number;
  triangleCount: number;
  meshCount: number;
  boundsRecordsFound: number;
  solidBoundsRecords: number;
  /** Length-delimited element objects recovered by chaining. */
  elementObjects?: number;
  /** Elements carrying a decoded instance parameter table. */
  parameterElements?: number;
  /** Native analytic surface patches decoded from the partition stream. */
  surfaces?: SurfaceSummary;
  /** Elements whose native surfaces rebuild an oriented solid. */
  nativeSolids?: number;
  /** Elements reaching the scene from a solid alone, with no bounds record. */
  solidOnlyElements?: number;
  /** Elements reaching the scene from a placed instance alone. */
  instanceOnlyElements?: number;
  /** Elements drawn without a decoded Revit category. */
  unclassifiedElements?: number;
  /** Elements drawn from native faces because their surfaces form no solid. */
  faceOnlyElements?: number;
  /** Family instances placed from a transform and a shared shape. */
  placedInstances?: number;
  /** Placed boxes discarded for disagreeing with the element's own envelope. */
  rejectedOrientedBoxes?: number;
  /** Cached family shapes removed from the model; they are not elements. */
  cachedShapeRecords?: number;
  /** Envelopes read in a family's local frame, so never placed in the model. */
  unplacedRecords?: number;
  /** Elements extruded from a recovered sketch boundary rather than boxed. */
  sketchBoundaryElements?: number;
  /**
   * Facet-hull records whose box was replaced by their own boundary sketch's.
   *
   * A hull over one attributed facet is not a reading of the element; where the
   * element carries a sketch category and a closed ring, the curves that ring was
   * assembled from give both the footprint and the elevations.
   */
  sketchBoundedFacetHulls?: number;
  /**
   * Flat sketch records given their own category's thickness.
   *
   * A record synthesised as a hull over one attributed face is a zero-thickness
   * sheet, so a floor is drawn 0.656 ft short and a ceiling is dropped from the
   * scene entirely. Every floor in a model shares one thickness, and that is
   * measured from the records that carry a real one.
   */
  completedFlatSketches?: number;
  /** Railings swept along their own rail path rather than drawn as a box. */
  sweptRailings?: number;
  /** Walls rebuilt as an arc from their own cylinder triple. */
  curvedWalls?: number;
  /** Rectangular curtain-panel proxies clipped by a diagonal mullion boundary. */
  inferredCurtainPanels?: number;
  /** Doors whose leaf was cut out of the opening using their host wall. */
  doorLeaves?: number;
  /** Doors whose leaf was folded out of their own shared shape's swing. */
  doorLeavesFromShape?: number;
  /** Rebuilt solids shortened to the element's own envelope. */
  clippedSolids?: number;
  /**
   * Rebuilt solids lengthened to the element's own envelope, recovering the join
   * extension Revit applies to a wall's body without moving its location line.
   */
  extendedSolids?: number;
  /** Wall ends trimmed to a corroborating adjacent native wall face. */
  recoveredWallJoinEnds?: number;
  /**
   * Rebuilt solids whose drawn box was shrunk into the element's own envelope,
   * where that envelope solves as this slab's own oriented rectangle. The
   * centreline clip cannot reach this: a box corner sits half a thickness off the
   * centreline, so a wall at an angle stays outside its own envelope.
   */
  shrunkSolids?: number;
  /**
   * Rebuilt solids whose elevation band was intersected with the element's own
   * envelope. Three in the supplied project, all wrong by 6.6-9.2 ft.
   */
  narrowedSolidBands?: number;
  /**
   * Rebuilt solids dropped because they share no point with the element's own
   * envelope, so the surface attribution filed another element's body here.
   */
  disownedSolids?: number;
  /** Stair runs and landings that adopted their companion record's own box. */
  adoptedStairBoxes?: number;
  /**
   * Envelopes narrowed in z to the element's own faces, where those faces cap it
   * above and below. A stair stringer's record carries the whole assembly's band.
   */
  narrowedFacetBands?: number;
  /** Of those, elements with no decoded category whose ring matched the envelope. */
  unnamedSketchElements?: number;
  /** Sketch edge records decoded from the partition stream. */
  sketchCurves?: number;
  /** Elements linked to their type element. */
  typedElements?: number;
  /** Elements whose type element also yielded a name. */
  namedTypeElements?: number;
  /** Release-specific object marker observed in this file, e.g. 0x08c6 in 2027. */
  elementObjectMarker?: number;
  /**
   * Fitted decoder limits that turned geometry away during this conversion.
   *
   * Empty on a model that stays inside every threshold measured on the
   * reference building — which is the ordinary case, and is why these limits
   * were invisible before. A non-empty census means at least one number fitted
   * to a different model decided what this one shows.
   */
  fittedLimitsReached?: LimitCensusEntry[];
  durationMs: number;
};

export type ReaderDiagnostics = {
  available: boolean;
  supportedVersion: boolean;
  productionElements: number;
  diagnosticCandidates: number;
  exportLevel: string;
  summary: string;
  warnings: string[];
  /** Family/type metadata decoded from the optional PartAtom XML stream. */
  partAtom?: PartAtomMetadata;
};

export type ElemTableLayout = {
  start: number;
  stride: number;
  markerLength: number;
  framing: "implicit" | "explicit";
};

export type RvtElementIndex = {
  declaredElementCount: number;
  recordCount: number;
  parsedRecordCount: number;
  uniqueElementIds: Uint32Array;
  partitionRecordIds: Uint32Array;
  partitionRecords: PartitionRecordLocator[];
  layout: ElemTableLayout;
};

export type PartitionRecordLocator = {
  elementId: number;
  stream: string;
  chunkIndex: number;
  rawOffset: number;
  inflatedBytes: number;
};

export type Bounds3 = { min: Vec3; max: Vec3 };

export type IfcElementTypeMatch = {
  ifcType: string;
  count: number;
  tagged: number;
  matchedRvtRecords: number;
  matchedElemTable: number;
  matchedPartitionRecords: number;
  /**
   * Revit ids of the matched elements, so the studio can report how many of
   * this class actually reach the scene — the audit script's third column.
   */
  matchedIds?: Uint32Array;
};

export type IfcMatchedElement = {
  expressId: number;
  revitElementId: number;
  ifcType: string;
  name: string;
  hasGeometry: boolean;
  evidence: "elem-table" | "partition-record" | "both" | "recovered-geometry";
  partitionRecord?: Omit<PartitionRecordLocator, "elementId">;
};

export type IfcReferenceManifest = {
  fileName: string;
  byteLength: number;
  schema: string;
  elementCount: number;
  taggedElementCount: number;
  matchedElementCount: number;
  unmatchedTaggedElementCount: number;
  matchedGeometryProducts: number;
  storeyCount: number;
  geometryProducts: number;
  placedGeometries: number;
  vertexCount: number;
  triangleCount: number;
  /** Matched IFC/Revit elements classified by the geometric diff. */
  geometricComparedElementCount?: number;
  /** Compared elements whose centre and size errors are within the tolerance. */
  geometricAlignedElementCount?: number;
  /** Compared elements outside the geometric tolerance. */
  geometricDifferentElementCount?: number;
  /** Bounds-aligned elements rejected because one body omitted material slopes. */
  geometricShapeDifferentElementCount?: number;
  /** Native Revit ids admitted by the conservative surface-orientation gate. */
  geometricShapeDifferentElementIds?: Uint32Array;
  /**
   * Roof ids whose numeric Revit Tag resolves to a direct IfcRoof body which
   * owns geometry and is not an IfcRelAggregates parent.
   */
  directRoofGeometryElementIds?: Uint32Array;
  /**
   * Revit ids whose numeric IFC Tag resolves directly to an IfcStairFlight
   * product that owns tessellated geometry.
   */
  directStairFlightGeometryElementIds?: Uint32Array;
  /**
   * Ramp ids whose tagged IfcRamp owns a direct body and is not itself an
   * IfcRelAggregates parent. Reference-assisted recovery still requires tight
   * six-face extent parity before replacing the RVT aggregate.
   */
  completeRampAggregateElementIds?: Uint32Array;
  geometryToleranceFeet?: number;
  boundsMetres: Bounds3;
  elementTypes: IfcElementTypeMatch[];
  matchedSamples: IfcMatchedElement[];
  durationMs: number;
};

export type GateStatus = "pass" | "warn" | "fail";

export type RegressionGate = {
  id: "identity" | "extents" | "topology" | "semantics" | "geometry";
  label: string;
  status: GateStatus;
  value: string;
  detail: string;
};

export type ReferenceMeshData = {
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
  /** One matched Revit element id per triangle; zero marks untagged IFC context. */
  elementIds?: Uint32Array;
  color: [number, number, number];
  matched: boolean;
  diffStatus: "aligned" | "different" | "context";
};

export type PairedRegressionResult = {
  reference: IfcReferenceManifest;
  referenceMeshes: ReferenceMeshData[];
  referenceBoundsMetres: Bounds3;
  status: GateStatus;
  identityCoverage: number;
  rvtIndexCoverage: number;
  sortedRvtDimensionsMetres: [number, number, number];
  sortedIfcDimensionsMetres: [number, number, number];
  dimensionRatios: [number, number, number];
  triangleRatio: number;
  semanticCoverage: number;
  gates: RegressionGate[];
  conclusion: string;
};

export type RvtRegressionInput = {
  elemTableIds: Uint32Array;
  partitionRecordIds: Uint32Array;
  /**
   * Ids the converter gave an envelope. Some of them are recovered from a solid
   * or a sketch and appear in neither index above, so a join that skipped them
   * reported ~200 fewer walls than the element actually has.
   */
  recoveredIds?: Uint32Array;
  partitionRecords: PartitionRecordLocator[];
  boundsFeet: Bounds3;
  triangleCount: number;
  productionElements: number;
  /** Native category coverage, used when the production decoder is version-gated. */
  typedElements?: number;
  /**
   * Viewer-visible AABBs packed as
   * [elementId,minX,minY,minZ,maxX,maxY,maxZ], in feet.
   */
  displayBounds?: Float64Array;
  /**
   * Viewer surface orientation totals packed as
   * [elementId,horizontalArea,verticalArea,slopedArea,triangleCount].
   */
  surfaceOrientationSignatures?: Float64Array;
};

export type ConvertResult = {
  ok: true;
  fileName: string;
  byteLength: number;
  meshes: MeshData[];
  materials: MaterialData[];
  segments: Segment[];
  elementBounds: ElementBoundsRecord[];
  nativeProfiles: NativeProfileLocator[];
  nativeCategories?: NativeCategorySummary;
  /** Serializable class inventory decoded from the embedded `Formats/Latest`. */
  schema?: SchemaSummary;
  /** Workset or family partition names decoded from `Global/PartitionTable`. */
  partitionNames?: PartitionName[];
  /** Family/type metadata decoded from the optional PartAtom XML stream. */
  partAtom?: PartAtomMetadata;
  /** Redacted external-reference state decoded from `TransmissionData`. */
  transmissionData?: RevitTransmissionData;
  /** DWG names retained in partition records; not the original DWG payloads. */
  persistedCadFileNames?: PersistedCadFileName[];
  /** Every container stream, and which decoder claims it. */
  coverage?: CoverageSummary;
  decoderCoverage: DecoderCoverage;
  origin: Vec3;
  bbox: { min: Vec3; max: Vec3 };
  levels: LevelBand[];
  stats: ConvertStats;
  warnings: string[];
  method: "native-profile-recovery" | "partition-bounds-recovery" | "partition-coordinate-recovery";
  readerDiagnostics?: ReaderDiagnostics;
  elementIndex?: RvtElementIndex;
  /** Persisted, browser-safe element ownership decoded from `Global/ElemTable`. */
  elementOwnership?: ElementOwnershipDecode;
  /** Native Revit element identities decoded from document and element history. */
  nativeIdentity?: NativeIdentityDecode;
  /** Persisted material identities/names and optional packed render colour. */
  nativeMaterialDefinitions?: LocatedNativeMaterialDefinition[];
  /** Loadable-family symbol to family relationships persisted in partition objects. */
  nativeFamilySymbolRelations?: NativeFamilySymbolRelation[];
  /** Native loadable-family identities/names decoded from FamilyBase. */
  nativeFamilyDefinitions?: NativeFamilyDefinition[];
  /** Exact MaterialElem ids attached to referenced shared geometry objects. */
  nativeGeometryMaterialAssignments?: NativeGeometryMaterialAssignment[];
  /** Placed elements joined through exact persisted shared-geometry material ids. */
  nativeElementMaterialAssignments?: NativeElementMaterialAssignment[];
  /** Persisted BasicWallType compound-layer definitions. */
  nativeCompoundStructureDefinitions?: NativeCompoundStructureDefinition[];
  /** Placed elements joined through type-owned compound-layer material ids. */
  nativeCompoundLayerMaterialAssignments?: NativeCompoundLayerMaterialAssignment[];
  /** Persisted hosted-element relationships from InsertableInst.m_hostId. */
  nativeHostRelations?: NativeHostRelation[];
  /** Elements whose display mesh was replaced by a tagged paired-IFC body. */
  referenceAssistedElementIds?: Uint32Array;
  /** Ramp aggregates admitted by both IFC decomposition and extent-parity gates. */
  referenceAssistedCompleteRampAggregateIds?: Uint32Array;
  /** Ramp aggregates kept from RVT because the paired tag was incomplete or unverified. */
  referenceAssistedRetainedRampAggregateIds?: Uint32Array;
  /** Roofs admitted by direct IfcRoof identity, shape difference, and tight extent parity. */
  referenceAssistedCompleteRoofIds?: Uint32Array;
  /** Roofs kept from RVT because one of the strict paired-roof gates was not proved. */
  referenceAssistedRetainedRoofIds?: Uint32Array;
  /** Native stair runs repaired from a direct, extent-matched IfcStairFlight. */
  referenceAssistedCompleteStairRunIds?: Uint32Array;
  /** Topologically incomplete stair runs that failed the strict IFC gate. */
  referenceAssistedRetainedStairRunIds?: Uint32Array;
  /** Persisted spatial relationships from Element.m_assocLevelId. */
  nativeAssociatedLevelRelations?: NativeAssociatedLevelRelation[];
};

export type ConvertFailure = {
  ok: false;
  fileName: string;
  error: string;
};

export type ConvertOutcome = ConvertResult | ConvertFailure;

export type ConvertOptions = {
  maxSegments?: number;
  /**
   * Optional browser/runtime cap for cached native Revit mesh definitions.
   * When reached, conversion continues with the independently recovered proxy
   * geometry. The native decoder's default is used when this is omitted.
   */
  maxNativeMeshBytes?: number;
  wallHeight?: number;
  wallThickness?: number;
  revitVersion?: number;
  /**
   * Coordinate window for the diagnostic segment scanner. Defaults to `auto`,
   * which reads a family window for `.rfa`/`.rft` and a project window
   * otherwise — a family's curves are far shorter than a building's.
   */
  geometryScale?: "auto" | "project" | "family";
};

export type ProgressUpdate = {
  ratio: number;
  message: string;
};

export type WorkerRequest = {
  id: number;
  type: "convert";
  fileName: string;
  buffer: ArrayBuffer;
  options?: ConvertOptions;
};

export type WorkerResponse =
  | ({ id: number; type: "progress" } & ProgressUpdate)
  | { id: number; type: "result"; result: ConvertOutcome }
  | { id: number; type: "error"; error: string };

export type IfcWorkerRequest = {
  id: number;
  type: "analyze-ifc";
  fileName: string;
  buffer: ArrayBuffer;
  rvt: RvtRegressionInput;
};

export type IfcWorkerResponse =
  | ({ id: number; type: "progress" } & ProgressUpdate)
  | { id: number; type: "result"; result: PairedRegressionResult }
  | { id: number; type: "error"; error: string };
