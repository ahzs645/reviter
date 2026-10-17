/** Source recovery, not stair admission. Read full original frames, including
 * records larger than the ordinary page scanner's 65,535-byte limit. Persisted
 * generator histories bind physical faces to tread indices without comparing
 * coordinates with a sketch or an independently evaluated IFC mesh. */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { openRevitContainer } from "./convert-container.ts";
import {
  activeClassTagTranslation,
  setActiveClassTagTranslation,
  type ClassTagTranslation,
} from "./revit-class-tags.ts";
import {
  activeElementIdBytes,
  setActiveElementIdBytes,
  type ElementIdBytes,
} from "./element-id-width.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  stripRevitPageChecksums,
} from "./revit-container.ts";
import { createSplitFrameStream } from "./split-frame-stream.ts";
import { readSchema, type SchemaStream } from "./schema-reader.ts";
import {
  readNativeStairTypedFifo,
  type NativeStairTypedFifo,
} from "./native-stair-typed-fifo.ts";
import { decodeRevit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import {
  replayRevit2027GRepFifo,
  type Revit2027GRepReplay,
} from "./revit-2027-grep-replay.ts";
import { collectRevit2027GInstanceBindings } from "./revit-2027-nested-instance.ts";
import {
  revit2027OwnerMeshIndex,
  revit2027OwnerSurface,
} from "./revit-2027-owner-mesh-index.ts";
import {
  revit2027DirectedEdgeUvs,
  walkRevit2027DirectedLoopEdges,
} from "./revit-2027-owner-mesh-trim.ts";
import type { Revit2027PlaneSurface } from "./revit-2027-surfaces.ts";
import { Rational, rational } from "./native-rational-overlay.ts";

type Point2 = [number, number];
type Fraction = [string, string];
type ExactPoint = [Fraction, Fraction, Fraction];
type Request = {
  nativeStairId: number;
  nativeRunId: number;
  nativeDefinitionId: number;
};
const digest = (bytes: Uint8Array) => bytesToHex(sha256(bytes));
const isHash = (value: string) => /^[a-f0-9]{64}$/.test(value);
const isId = (value: unknown): value is number =>
  Number.isSafeInteger(value) &&
  Number(value) > 0 &&
  Number(value) <= 0x7fff_ffff;
const id = (value: unknown): number | undefined => {
  const n = (value as { m_id?: { m_id64?: unknown } })?.m_id?.m_id64;
  return isId(n) ? n : undefined;
};
const add = (a: Rational, b: Rational) =>
  new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d);
const sub = (a: Rational, b: Rational) =>
  new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const pair = (a: Rational): Fraction => [a.n.toString(), a.d.toString()];
function exactPoint(
  plane: Revit2027PlaneSurface,
  uv: readonly number[],
): ExactPoint {
  return [0, 1, 2].map((axis) =>
    pair(
      add(
        add(
          rational(plane.origin[axis]!),
          mul(rational(plane.xVector[axis]!), rational(uv[0]!)),
        ),
        mul(rational(plane.yVector[axis]!), rational(uv[1]!)),
      ),
    ),
  ) as ExactPoint;
}
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

export type OriginalStairPhysicalHistoryBinding = {
  typedIndex: number;
  physicalFaceToken: number;
  physicalFaceTag: number;
  history: { id: number; keys: [number, number, number] }[];
};

/** Mathematical/source-record relation only. Caller-supplied decoded facts
 * acquire no original-source authority here. These source history families
 * retain the actual index operand: direct [53,index,-1], or an instantiated
 * [5,prototype,index] whose prototype is [53,seedIndex,-1]. No nearest-height,
 * centroid, rounded plane or mesh similarity establishes this relation. */
export function originalStairPhysicalHistoryBindings(
  history: readonly { m_id: number; m_faceHist: { m_keys: number[] } }[],
  faces: readonly { physicalFaceToken: number; physicalFaceTag: number }[],
  typedCount: number,
): OriginalStairPhysicalHistoryBinding[] {
  if (
    !Number.isSafeInteger(typedCount) ||
    typedCount < 1 ||
    typedCount > 1000 ||
    !Array.isArray(history) ||
    history.length > 100_000 ||
    !Array.isArray(faces) ||
    faces.length > 8192
  )
    throw Error("Invalid original history inventory");
  const byId = new Map<number, [number, number, number]>();
  for (const row of history) {
    const keys = row.m_faceHist?.m_keys;
    if (
      !isId(row.m_id) ||
      byId.has(row.m_id) ||
      !Array.isArray(keys) ||
      keys.length !== 3 ||
      keys.some((n) => !Number.isSafeInteger(n))
    )
      throw Error("Conflicting or unsupported original face history");
    byId.set(row.m_id, keys as [number, number, number]);
  }
  if (
    new Set(faces.map((f) => f.physicalFaceToken)).size !== faces.length ||
    new Set(faces.map((f) => f.physicalFaceTag)).size !== faces.length
  )
    throw Error("Duplicate original physical face identity");
  const result: OriginalStairPhysicalHistoryBinding[] = [];
  for (const face of faces) {
    if (!isId(face.physicalFaceToken) || !isId(face.physicalFaceTag))
      throw Error("Invalid original physical face identity");
    const first = byId.get(face.physicalFaceTag);
    if (!first)
      throw Error(
        "Original physical face lacks its declared generator history",
      );
    const chain = [{ id: face.physicalFaceTag, keys: first }];
    let typedIndex: number | undefined;
    if (first[0] === 53 && first[2] === -1) typedIndex = first[1];
    else if (first[0] === 5) {
      const prototype = byId.get(first[1]);
      if (!prototype)
        throw Error("Original pattern face lacks its prototype history");
      if (prototype[0] === 53 && prototype[2] === -1) {
        if (prototype[1] < 0 || prototype[1] >= typedCount)
          throw Error("Original pattern seed does not name a typed tread");
        chain.push({ id: first[1], keys: prototype });
        typedIndex = first[2];
      }
    }
    if (typedIndex === undefined) continue; // Other physical faces stay in census.
    if (
      typedIndex < 0 ||
      typedIndex >= typedCount ||
      result.some((r) => r.typedIndex === typedIndex)
    )
      throw Error(
        "Original physical tread history is duplicated or outside its typed inventory",
      );
    result.push({ ...face, typedIndex, history: chain });
  }
  result.sort((a, b) => a.typedIndex - b.typedIndex);
  if (result.length !== typedCount || result.some((r, i) => r.typedIndex !== i))
    throw Error(
      "Original physical history does not cover every typed tread exactly once",
    );
  return result;
}

const contextBrand: unique symbol = Symbol(
  "OriginalNativeStairPhysicalContext",
);
export type OriginalNativeStairPhysicalContext = {
  readonly [contextBrand]: true;
  readonly sourceModelSha256: string;
  readonly sourceSchemaSha256: string;
  readonly completeSourcePages: number;
  /** Source records absent after a complete scan stay explicit, never empty bodies. */
  readonly missingOriginalRecords: readonly string[];
};
type StoredContext = {
  frames: Map<string, Uint8Array>;
  schema: SchemaStream;
  translation: ClassTagTranslation;
  idBytes: ElementIdBytes;
  requests: readonly Request[];
};
const contexts = new WeakMap<
  OriginalNativeStairPhysicalContext,
  StoredContext
>();

function checkedFrame(bytes: Uint8Array, elementId: number, marker: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length < 40 ||
    view.getUint32(0, true) !== elementId ||
    view.getUint32(4, true) !== 0 ||
    view.getUint16(16, true) !== marker
  )
    throw Error("Original frame identity mismatch");
  const length = view.getUint32(12, true);
  if (
    length + 20 !== bytes.length ||
    view.getUint32(length + 16, true) !== length
  )
    throw Error("Original frame length echo mismatch");
  let a = 1,
    b = 0;
  for (let i = 16; i < 16 + length; i++) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  if ((b * 65536 + a) >>> 0 !== view.getUint32(8, true))
    throw Error("Original frame checksum mismatch");
}
function geometry(bytes: Uint8Array, elementId: number) {
  checkedFrame(bytes, elementId, 2246);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const root = decodeRevit2027FramedGRepRoot(
    bytes,
    {
      offset: 0,
      elementId,
      marker: 2246,
      objectLength: view.getUint32(12, true),
      typeCode: view.getUint32(18, true),
    },
    2027,
  );
  if (!root.ok) throw Error(root.error);
  if (
    root.value.objectType !== 3 ||
    (root.value.flags !== 0 && root.value.flags !== 2)
  )
    throw Error("Unsupported original GElement body semantics");
  const replay = replayRevit2027GRepFifo(bytes, root.value, undefined, {
    maxReplayEntries: 100_000,
    maxDescriptors: 400_000,
  });
  if (!replay.ok) throw Error(replay.error);
  return replay.value;
}

/** Actual RVT bytes only. Immutable snapshots, full original page inflation,
 * complete framing and independent typed schema replay establish source
 * membership. A cache, receipt, incoming mesh or self-hashed frame manifest
 * cannot create this opaque context. */
export function createOriginalNativeStairPhysicalContext(
  originalRvtBytes: Uint8Array,
  expectedSourceModelSha256: string,
  requests: readonly Request[],
): OriginalNativeStairPhysicalContext {
  if (
    !isHash(expectedSourceModelSha256) ||
    !requests.length ||
    requests.length > 64 ||
    requests.some(
      (r) =>
        !isId(r.nativeStairId) ||
        !isId(r.nativeRunId) ||
        !isId(r.nativeDefinitionId),
    ) ||
    new Set(requests.map((r) => r.nativeRunId)).size !== requests.length
  )
    throw Error("Invalid source or requested stair inventory");
  const bytes = Uint8Array.from(originalRvtBytes);
  if (digest(bytes) !== expectedSourceModelSha256)
    throw Error("Original RVT checksum mismatch");
  const previousTranslation = activeClassTagTranslation(),
    previousWidth = activeElementIdBytes();
  try {
    const opened = openRevitContainer(bytes, {});
    if (
      opened.decoderPlan.revitVersion !== 2027 ||
      !opened.nativeSourceSchemaBytes ||
      activeElementIdBytes() !== 8 ||
      !opened.classTagTranslation.identity ||
      opened.classTagTranslation.movedClasses
    )
      throw Error(
        "Source physical inventory requires canonical wide-ID Revit2027 schema",
      );
    const parsed = readSchema(opened.nativeSourceSchemaBytes);
    if (!parsed.ok) throw Error("Original embedded schema did not decode");
    const wanted = new Set(
      requests.flatMap((r) => [r.nativeRunId, r.nativeDefinitionId]),
    );
    const frames = new Map<string, Uint8Array>();
    let pages = 0,
      storedBytes = 0;
    for (const partition of opened.partitions) {
      const stream = createSplitFrameStream({
        markers: [2246, 4102, 4133],
        minObjectLength: 40,
        maxFrameBytes: 16 * 1024 * 1024,
        acceptHeader: (view, offset) =>
          wanted.has(view.getUint32(offset, true)),
      });
      const data = stripRevitPageChecksums(asBytes(partition.entry.content));
      const offsets = gzipOffsets(data, 10_001);
      if (offsets.length > 10_000)
        throw Error("Original partition exceeds bounded source page census");
      let window: Uint8Array | null = null;
      for (let i = 0; i < offsets.length; i++) {
        const page = inflateRevitChunk(
          data,
          offsets[i]!,
          offsets[i + 1],
          window,
        );
        if (!page) throw Error("Original source page failed exact inflation");
        window = revitWindowTail(page);
        pages++;
        // Consume the complete split-frame object itself. indexPageFrames
        // would discard large recovered bodies for a second time here.
        for (const frame of stream.push(page)) {
          const snapshot = Uint8Array.from(frame.data);
          checkedFrame(snapshot, frame.elementId, frame.marker);
          const key = `${frame.elementId}:${frame.marker}`;
          if (frames.has(key))
            throw Error("Duplicate original source body or semantic root");
          frames.set(key, snapshot);
          storedBytes += snapshot.length;
          if (storedBytes > 128 * 1024 * 1024)
            throw Error("Requested source inventory exceeds bounded bytes");
        }
      }
    }
    const missingOriginalRecords: string[] = [];
    for (const r of requests)
      for (const key of [
        `${r.nativeRunId}:4102`,
        `${r.nativeRunId}:2246`,
        `${r.nativeDefinitionId}:4133`,
        `${r.nativeDefinitionId}:2246`,
      ])
        if (!frames.has(key)) missingOriginalRecords.push(key);
    const context = Object.freeze({
      [contextBrand]: true as const,
      sourceModelSha256: expectedSourceModelSha256,
      sourceSchemaSha256: digest(opened.nativeSourceSchemaBytes),
      completeSourcePages: pages,
      missingOriginalRecords: Object.freeze(missingOriginalRecords),
    });
    contexts.set(context, {
      frames,
      schema: parsed.schema,
      translation: opened.classTagTranslation,
      idBytes: activeElementIdBytes(),
      requests: structuredClone(requests),
    });
    return context;
  } finally {
    setActiveClassTagTranslation(previousTranslation);
    setActiveElementIdBytes(previousWidth);
  }
}

export type OriginalNativeStairPhysicalInventory = {
  version: 1;
  sourceModelSha256: string;
  sourceSchemaSha256: string;
  nativeStairId: number;
  nativeRunId: number;
  nativeDefinitionId: number;
  sourceFrameSha256s: Record<string, string>;
  completeOriginalSourceFaceCensus: boolean;
  sourceFaceCount: number;
  sourceEdgeCount: number;
  sourceTypedTreadCount: number;
  unsupportedPhysicalFaceTokens: number[];
  /** Source samples are retained, never treated as a chord-certified trim. */
  unsupportedPhysicalTreadEdgeTokens: number[];
  treadHistoryBindingComplete: boolean;
  treads: (OriginalStairPhysicalHistoryBinding & {
    originalPhysicalPlane: Revit2027PlaneSurface;
    originalTypedOriginFeet: number[];
    exactPhysicalPlaneHeightFeet: Fraction;
    exactHeightMatchesTyped: boolean;
    coedges: {
      sourceEdgeToken: number;
      direction: number;
      originalUV: readonly Point2[];
      exactStartFeet: ExactPoint;
      exactEndFeet: ExactPoint;
    }[];
    exactUVCoedgeContinuity: boolean;
  })[];
  blockers: string[];
  /** A complete persisted source census is not a watertight physical solid. */
  completeOriginalPhysicalBodyApproved: false;
  terminalSupportApproved: false;
  ownBodyAndHeadroomClearanceApproved: false;
  routeApproved: false;
};

export type OriginalNativeStairPhysicalSource = Request & {
  sourceModelSha256: string;
  sourceSchemaSha256: string;
  sourceFrameSha256s: Record<string, string>;
  run: NativeStairTypedFifo;
  symbol: NativeStairTypedFifo;
  carrier: Revit2027GRepReplay;
  physicalDefinition: Revit2027GRepReplay;
};

/** Return newly decoded original source operands, including every physical
 * definition face and the complete placed carrier. This grants no body or
 * clearance approval. Consumers that issue source certificates must take the
 * opaque context themselves; a caller-supplied copy of these facts is not an
 * alternative source-authority constructor. No private frame is exposed. */
export function readOriginalNativeStairPhysicalSource(
  context: OriginalNativeStairPhysicalContext,
  nativeRunId: number,
): OriginalNativeStairPhysicalSource {
  const source = contexts.get(context);
  if (!source) throw Error("Untrusted original source context");
  const request = source.requests.find((r) => r.nativeRunId === nativeRunId);
  if (!request) throw Error("Run is not in this original source context");
  const previousTranslation = activeClassTagTranslation(),
    previousWidth = activeElementIdBytes();
  try {
    setActiveClassTagTranslation(source.translation);
    setActiveElementIdBytes(source.idBytes);
    const hashes: Record<string, string> = {};
    const frame = (elementId: number, marker: number) => {
      const key = `${elementId}:${marker}`,
        bytes = source.frames.get(key);
      if (!bytes)
        throw Error(`Requested original source record missing: ${key}`);
      hashes[key] = digest(bytes);
      return bytes;
    };
    const run = readNativeStairTypedFifo(
      frame(request.nativeRunId, 4102),
      source.schema,
      "StairsRun",
    );
    const symbol = readNativeStairTypedFifo(
      frame(request.nativeDefinitionId, 4133),
      source.schema,
      "StairsTriserSymbol",
    );
    if (!run.ok || !symbol.ok)
      throw Error("Original run/symbol semantics did not replay");
    const carrier = geometry(
      frame(request.nativeRunId, 2246),
      request.nativeRunId,
    );
    const physicalDefinition = geometry(
      frame(request.nativeDefinitionId, 2246),
      request.nativeDefinitionId,
    );
    return {
      ...request,
      sourceModelSha256: context.sourceModelSha256,
      sourceSchemaSha256: context.sourceSchemaSha256,
      sourceFrameSha256s: hashes,
      run: run.value,
      symbol: symbol.value,
      carrier,
      physicalDefinition,
    };
  } finally {
    setActiveClassTagTranslation(previousTranslation);
    setActiveElementIdBytes(previousWidth);
  }
}

export function inspectOriginalNativeStairPhysicalInventory(
  context: OriginalNativeStairPhysicalContext,
  nativeRunId: number,
): OriginalNativeStairPhysicalInventory {
  const source = contexts.get(context);
  if (!source) throw Error("Untrusted original source context");
  const request = source.requests.find((r) => r.nativeRunId === nativeRunId);
  if (!request) throw Error("Run is not in this original source context");
  const report: OriginalNativeStairPhysicalInventory = {
    version: 1,
    sourceModelSha256: context.sourceModelSha256,
    sourceSchemaSha256: context.sourceSchemaSha256,
    ...request,
    sourceFrameSha256s: {},
    completeOriginalSourceFaceCensus: false,
    sourceFaceCount: 0,
    sourceEdgeCount: 0,
    sourceTypedTreadCount: 0,
    unsupportedPhysicalFaceTokens: [],
    unsupportedPhysicalTreadEdgeTokens: [],
    treadHistoryBindingComplete: false,
    treads: [],
    blockers: [],
    completeOriginalPhysicalBodyApproved: false,
    terminalSupportApproved: false,
    ownBodyAndHeadroomClearanceApproved: false,
    routeApproved: false,
  };
  const previousTranslation = activeClassTagTranslation(),
    previousWidth = activeElementIdBytes();
  try {
    setActiveClassTagTranslation(source.translation);
    setActiveElementIdBytes(source.idBytes);
    const read = (elementId: number, marker: number) => {
      const key = `${elementId}:${marker}`,
        bytes = source.frames.get(key);
      if (!bytes)
        throw Error(`Requested original source record missing: ${key}`);
      report.sourceFrameSha256s[key] = digest(bytes);
      return bytes;
    };
    const run = readNativeStairTypedFifo(
      read(request.nativeRunId, 4102),
      source.schema,
      "StairsRun",
    );
    const symbol = readNativeStairTypedFifo(
      read(request.nativeDefinitionId, 4133),
      source.schema,
      "StairsTriserSymbol",
    );
    if (!run.ok || !symbol.ok)
      throw Error(
        "Original run/symbol semantic root did not replay completely",
      );
    if (
      id(run.value.root.m_stairsId) !== request.nativeStairId ||
      id(run.value.root.m_triserSymId) !== request.nativeDefinitionId ||
      id(symbol.value.root.m_hostId) !== request.nativeRunId
    )
      throw Error(
        "Original run/stair/definition ownership does not correspond",
      );
    const typed = run.value.entries.filter(
      (entry) => entry.sourceClassName === "StairsTreadInfo",
    );
    report.sourceTypedTreadCount = typed.length;
    const carrier = geometry(
      read(request.nativeRunId, 2246),
      request.nativeRunId,
    );
    const bindings = collectRevit2027GInstanceBindings(carrier);
    if (
      !bindings.ok ||
      bindings.value.length !== 1 ||
      bindings.value[0]!.kind !== "external"
    )
      throw Error(
        "Original run does not contain one supported physical definition occurrence",
      );
    const instance = bindings.value[0]!.instance;
    const supportedCarrierReaders = new Set([
      "Revit2027GFilter",
      "Revit2027GGroup",
      "Revit2027GLine",
      "Revit2027GArc",
      "Revit2027GCylindricalHelix",
      "Revit2027GPoint",
      "Revit2027GConditionInt",
      "Revit2027GInstance",
      "Revit2027InstanceInfo",
      "Revit2027Geometry",
    ]);
    if (
      instance.symbolElementId !== BigInt(request.nativeDefinitionId) ||
      instance.hasScale ||
      !equal(
        instance.transform.matrix,
        [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      ) ||
      carrier.spans.some(
        (s) =>
          !supportedCarrierReaders.has(s.readerId) ||
          (s.readerId === "Revit2027Geometry" &&
            (s.value as { faces: { count: number } }).faces.count !== 0),
      )
    )
      throw Error(
        "Original run placement or additional physical branches remain unsupported",
      );
    const body = geometry(
      read(request.nativeDefinitionId, 2246),
      request.nativeDefinitionId,
    );
    const index = revit2027OwnerMeshIndex(body);
    const allowed = new Set([
      "Revit2027Geometry",
      "Revit2027Face",
      "Revit2027GEdge",
      "Revit2027EdgeLoop",
      "Revit2027AnalyticSurface:634",
      // Retain complete decoded cylindrical source faces for the census and
      // tread-role correspondence. Their physical interpretation stays held.
      "Revit2027AnalyticSurface:1144",
    ]);
    const declared = body.spans.find((s) => s.readerId === "Revit2027Geometry")
      ?.value as
      | {
          faces: { count: number; entries: { token: number }[] };
          edges: { count: number; entries: { token: number }[] };
        }
      | undefined;
    if (
      body.spans.some((s) => !allowed.has(s.readerId)) ||
      body.spans.filter((s) => s.readerId === "Revit2027Geometry").length !==
        1 ||
      index.faces.size !==
        body.spans.filter((s) => s.readerId === "Revit2027Face").length ||
      index.edges.size !==
        body.spans.filter((s) => s.readerId === "Revit2027GEdge").length ||
      index.loops.size !==
        body.spans.filter((s) => s.readerId === "Revit2027EdgeLoop").length ||
      !declared ||
      declared.faces.count !== index.faces.size ||
      declared.edges.count !== index.edges.size ||
      !equal(
        declared.faces.entries
          .map((entry) => entry.token)
          .toSorted((a, b) => a - b),
        [...index.faces.keys()].sort((a, b) => a - b),
      ) ||
      !equal(
        declared.edges.entries
          .map((entry) => entry.token)
          .toSorted((a, b) => a - b),
        [...index.edges.keys()].sort((a, b) => a - b),
      )
    )
      throw Error(
        "Unsupported physical source branch or incomplete declared face/edge census",
      );
    report.sourceFaceCount = index.faces.size;
    report.sourceEdgeCount = index.edges.size;
    const steps = symbol.value.entries.filter(
      (e) => e.sourceClassName === "StairsTriserSymbolGStep",
    );
    if (steps.length !== 1 || steps[0]!.value.m_version !== 2)
      throw Error(
        "Original definition lacks one unambiguous generator history",
      );
    const tops = [...index.faces].flatMap(([physicalFaceToken, face]) => {
      const plane = revit2027OwnerSurface<Revit2027PlaneSurface>(
        index,
        634,
        physicalFaceToken,
      );
      if (
        !plane ||
        plane.kind !== "plane" ||
        typeof plane.surface.orientFlag !== "boolean" ||
        face.cutType !== 0 ||
        face.faceFlags !== 4
      ) {
        report.unsupportedPhysicalFaceTokens.push(physicalFaceToken);
        return [];
      }
      const signedNormalZ =
        sub(
          mul(rational(plane.xVector[0]), rational(plane.yVector[1])),
          mul(rational(plane.xVector[1]), rational(plane.yVector[0])),
        ).n * (plane.surface.orientFlag ? 1n : -1n);
      if (
        plane.xVector[2] !== 0 ||
        plane.yVector[2] !== 0 ||
        signedNormalZ <= 0n
      )
        return [];
      return [{ physicalFaceToken, physicalFaceTag: face.gInfo.tag }];
    });
    const history = originalStairPhysicalHistoryBindings(
      steps[0]!.value.m_faceHistTable as Parameters<
        typeof originalStairPhysicalHistoryBindings
      >[0],
      tops,
      typed.length,
    );
    report.completeOriginalSourceFaceCensus = true;
    if (report.unsupportedPhysicalFaceTokens.length)
      report.blockers.push(
        "Original physical faces with unsupported semantics remain in the census and block complete body approval",
      );
    for (const binding of history) {
      const face = index.faces.get(binding.physicalFaceToken)!;
      const plane = revit2027OwnerSurface<Revit2027PlaneSurface>(
        index,
        634,
        binding.physicalFaceToken,
      )!;
      const loop = index.loops.get(face.firstLoop.token);
      if (
        !loop ||
        face.faceRegions.count ||
        loop.loop.open ||
        loop.loop.nextLoop.token !== 0
      )
        throw Error("Unsupported physical tread loop or hole/region census");
      const walked = walkRevit2027DirectedLoopEdges({
        faceToken: binding.physicalFaceToken,
        loop,
        edges: index.edges,
        loopArity: "open",
      });
      if (!walked.ok)
        throw Error("Original physical tread coedge topology does not close");
      const coedges = walked.edges.map((edge) => {
        const uv = revit2027DirectedEdgeUvs(edge);
        if (uv.length < 2 || uv.some((p) => p.some((n) => !Number.isFinite(n))))
          throw Error("Invalid original physical tread coedge samples");
        if (uv.length !== 2) {
          report.unsupportedPhysicalTreadEdgeTokens.push(edge.token);
        }
        return {
          sourceEdgeToken: edge.token,
          direction: edge.direction,
          originalUV: uv.map((p) => [p[0], p[1]] as Point2),
          exactStartFeet: exactPoint(plane, uv[0]!),
          exactEndFeet: exactPoint(plane, uv.at(-1)!),
        };
      });
      const origin = typed[binding.typedIndex]!.value.m_origin as number[];
      if (
        !Array.isArray(origin) ||
        origin.length !== 3 ||
        origin.some((n) => !Number.isFinite(n))
      )
        throw Error("Original typed tread origin is not supported");
      const exactHeightMatchesTyped = plane.origin[2] === origin[2];
      const exactUVCoedgeContinuity = coedges.every((edge, i) =>
        equal(
          edge.originalUV.at(-1),
          coedges[(i + 1) % coedges.length]!.originalUV[0],
        ),
      );
      report.treads.push({
        ...binding,
        originalPhysicalPlane: structuredClone(plane),
        originalTypedOriginFeet: [...origin],
        exactPhysicalPlaneHeightFeet: pair(rational(plane.origin[2])),
        exactHeightMatchesTyped,
        coedges,
        exactUVCoedgeContinuity,
      });
    }
    report.treadHistoryBindingComplete = report.treads.length === typed.length;
    if (report.unsupportedPhysicalTreadEdgeTokens.length)
      report.blockers.push(
        "Original curved physical tread coedge samples are retained; no chordal trim or complete walking-body approval is inferred",
      );
    if (report.treads.some((t) => !t.exactHeightMatchesTyped))
      report.blockers.push(
        "Original generated physical top heights differ from typed sketch heights; both original operands are retained",
      );
    if (report.treads.some((t) => !t.exactUVCoedgeContinuity))
      report.blockers.push(
        "Positive original coedge endpoint discrepancies remain; no endpoint is joined, snapped or discarded",
      );
    report.blockers.push(
      "A source face census and tread history binding do not certify exact closed physical body, terminal continuity, own-body/foreign headroom, circulation or routes",
    );
  } catch (error) {
    report.blockers.push(
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    setActiveClassTagTranslation(previousTranslation);
    setActiveElementIdBytes(previousWidth);
  }
  return report;
}
