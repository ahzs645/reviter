/** Portable operand shapes. These types grant no original-model authority. */
type ObjectValue = Record<string, unknown>;
export type NativeTypedRootClassName =
  | "StairsRun"
  | "StairsTriserSymbol"
  | "ImportInstance"
  | "MasterImportSymbol"
  | "SlaveImportSymbol";
export type NativeStairTypedDescriptor = {
  token: number;
  sourceClassSlot: number | null;
  start: number;
  end: number;
  path: string;
};
export type NativeStairTypedField = {
  path: string;
  sourceClassName: string;
  schemaFieldOffset: number;
  start: number;
  end: number;
  omitted?: true;
};
export type NativeStairTypedFifoEntry = {
  replayIndex: number;
  descriptor: NativeStairTypedDescriptor;
  sourceClassName: string;
  start: number;
  end: number;
  value: ObjectValue;
  fields: NativeStairTypedField[];
};
export type NativeStairTypedFifo = {
  /** Retained for callers reading StairsRun; nativeElementId also names symbols. */
  nativeRunId: number;
  nativeElementId: number;
  rootClassName: NativeTypedRootClassName;
  rootClassSlot: number;
  rootStaticEnd: number;
  endOffset: number;
  root: ObjectValue;
  rootFields: NativeStairTypedField[];
  entries: NativeStairTypedFifoEntry[];
  completeOriginalTypedRootAndFifoByteReplay: true;
};

export type Revit2027GRepReplayPath = readonly number[];
export type Revit2027GRepReplayDescriptor = {
  descriptorIndex: number;
  ownerElementId: bigint;
  path: Revit2027GRepReplayPath;
  parentPath: Revit2027GRepReplayPath | null;
  parentReplayIndex: number | null;
  token: number;
  sourceClassSlot: number | null;
  descriptorOffset: number;
  descriptorEndOffset: number;
  state: "queued" | "null" | "reused";
  /** Monotonic insertion order for a real FIFO entry; null for token zero. */
  queueSequence: number | null;
};

export type Revit2027GRepReplaySpan = {
  replayIndex: number;
  queueSequence: number;
  ownerElementId: bigint;
  path: Revit2027GRepReplayPath;
  parentPath: Revit2027GRepReplayPath | null;
  parentReplayIndex: number | null;
  propertyToken: number;
  propertySourceClassSlot: number;
  descriptorOffset: number;
  descriptorEndOffset: number;
  startOffset: number;
  endOffset: number;
  readerId: string;
  value?: unknown;
};

export type Revit2027GRepReplay = {
  ownerElementId: bigint;
  startOffset: number;
  endOffset: number;
  initialTokenCount: number;
  finalTokenCount: number;
  descriptors: readonly Revit2027GRepReplayDescriptor[];
  spans: readonly Revit2027GRepReplaySpan[];
};

export type Revit2027GInstance = {
  embeddedSymbolGRep: { token: number; sourceClassSlot: number | null };
  instanceInfo: { sourceClassSlot: number | null };
  forbiddenTarget: number;
  resolveSymbolInView: boolean;
  hasScale: boolean;
  gInfo: { tag: number };
};
export type Revit2027InstanceInfo = {
  symbolElementId: bigint;
  gRepId: number;
  cda: number;
  transform: { matrix: readonly number[] };
};
export type Revit2027GLine = {
  origin: readonly [number, number, number];
  direction: readonly [number, number, number];
  endParameters: readonly [number, number];
};
export type Revit2027GPoint = {
  coordinate: readonly [number, number, number];
  size: number;
  borderSize: number;
};
