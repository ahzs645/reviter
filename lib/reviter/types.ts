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

export type PairedRegressionResult = {
  reference: IfcReferenceManifest;
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
  segments: Segment[];
  origin: Vec3;
  bbox: { min: Vec3; max: Vec3 };
  levels: LevelBand[];
  stats: ConvertStats;
  warnings: string[];
  method: "partition-coordinate-recovery";
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
