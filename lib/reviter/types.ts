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
