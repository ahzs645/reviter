import type { SchemaSummary } from "./schema.ts";
import type { CoverageSummary } from "./stream-coverage.ts";
import type { PartitionName } from "./partition-names.ts";

export type { SchemaClass, SchemaSummary } from "./schema.ts";
export type { PartitionName } from "./partition-names.ts";
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
  /** One native Revit element id per 12-triangle box, when the mesh is an element-envelope batch. */
  elementIds?: Uint32Array;
};

export type MaterialData = {
  name: string;
  baseColorLinear: [number, number, number, number];
  metallic: number;
  roughness: number;
  doubleSided: boolean;
  source: "rvt-material" | "display-fallback";
  assignedElements: number;
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
  nativeMeshes: number;
  nativeMaterialDefinitions: number;
  nativeMaterialAssignments: number;
  approximateSolids: number;
  /** Elements carrying a natively decoded Revit `BuiltInCategory`. */
  nativeCategorisedElements: number;
  geometryFidelity: "native-profile-approximate-solid" | "native-bounds-envelope" | "diagnostic-only";
  materialFidelity: "native-definitions-unassigned" | "native-assigned" | "display-fallback";
  semanticFidelity: "native-categories" | "record-code-heuristic" | "none";
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
  boundsFeet: Bounds3;
};

/**
 * `native-token` means the element's own category token was decoded.
 * `record-code-consensus` means the category was inherited from sibling records
 * that share the element's record code.
 */
export type NativeCategorySource = "native-token" | "record-code-consensus";

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
  categories: NativeCategoryCount[];
  codeConsensus: NativeCategoryCodeConsensus[];
};

export type LevelBand = {
  elevation: number;
  candidates: number;
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
};

export type IfcMatchedElement = {
  expressId: number;
  revitElementId: number;
  ifcType: string;
  name: string;
  hasGeometry: boolean;
  evidence: "elem-table" | "partition-record" | "both";
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
  boundsMetres: Bounds3;
  elementTypes: IfcElementTypeMatch[];
  matchedSamples: IfcMatchedElement[];
  durationMs: number;
};

export type GateStatus = "pass" | "warn" | "fail";

export type RegressionGate = {
  id: "identity" | "extents" | "topology" | "semantics";
  label: string;
  status: GateStatus;
  value: string;
  detail: string;
};

export type ReferenceMeshData = {
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
  color: [number, number, number];
  matched: boolean;
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
  partitionRecords: PartitionRecordLocator[];
  boundsFeet: Bounds3;
  triangleCount: number;
  productionElements: number;
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
};

export type ConvertFailure = {
  ok: false;
  fileName: string;
  error: string;
};

export type ConvertOutcome = ConvertResult | ConvertFailure;

export type ConvertOptions = {
  maxSegments?: number;
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
