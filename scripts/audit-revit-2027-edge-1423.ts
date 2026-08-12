/**
 * Audit the exact Revit 2027 source-slot 1,423 (`GEdge`) boundary and the
 * currently reachable UNBC FIFO route.
 *
 * Exact body replay is restricted to roots containing one unambiguous
 * Geometry owner. It consumes every Geometry-owned Face first, appends the
 * Face children behind the pre-existing Geometry FIFO, and only then decodes
 * the Geometry-owned GEdge bodies.
 *
 * Usage:
 *   node --experimental-strip-types scripts/audit-revit-2027-edge-1423.ts model.rvt
 */
import {
  FORMATS_LATEST_PATTERN,
  PARTITION_STREAM_PATTERN,
  iterateInflatedChunks,
  openRvt,
  requireModelPath,
} from "./lib/rvt-harness.ts";

import {
  countsByFrequency,
  increment,
  matchesAscii,
} from "./lib/rvt-harness.ts";

import type { CondInt16QueueEntry } from "../lib/reviter/dynamic-geometry-queue.ts";
import { scanFramedElementObjects } from "../lib/reviter/element-objects.ts";
import {
  REVIT_2027_FACE_SOURCE_CLASS_SLOT,
  REVIT_2027_GARRAY_BODY_BYTES,
  REVIT_2027_GARRAY_SOURCE_CLASS_SLOT,
  REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
  REVIT_2027_GELEMENT_OBJECT_MARKER,
  REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
  REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
  REVIT_2027_GLINE_BODY_BYTES,
  REVIT_2027_GLINE_SOURCE_CLASS_SLOT,
  decodeRevit2027FaceStatic,
  decodeRevit2027FramedGRepRoot,
  decodeRevit2027GArray,
  decodeRevit2027GEdgeStatic,
  decodeRevit2027GGroupStatic,
  decodeRevit2027GLine,
  decodeRevit2027GeometryStatic,
  revit2027GEdgeNativeCurveKind,
} from "./lib/revit-2027-decoders.ts";
import type {
  Revit2027EdgePoint,
  Revit2027FaceStatic,
  Revit2027GeometryStatic,
} from "./lib/revit-2027-decoders.ts";
function findName16(
  data: Uint8Array,
  name: string,
  firstOffset: number,
  endOffset: number,
): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (
    let offset = firstOffset;
    offset <= Math.min(endOffset, data.byteLength - name.length - 2);
    offset += 1
  ) {
    if (
      view.getUint16(offset, true) === name.length &&
      matchesAscii(data, offset + 2, name)
    ) {
      return offset;
    }
  }
  return -1;
}

function findName32(
  data: Uint8Array,
  name: string,
  firstOffset: number,
  endOffset: number,
): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (
    let offset = firstOffset;
    offset <= Math.min(endOffset, data.byteLength - name.length - 4);
    offset += 1
  ) {
    if (
      view.getUint32(offset, true) === name.length &&
      matchesAscii(data, offset + 4, name)
    ) {
      return offset;
    }
  }
  return -1;
}

function bytesEqual(
  data: Uint8Array,
  byteOffset: number,
  expected: readonly number[],
): boolean {
  return expected.every(
    (value, index) => data[byteOffset + index] === value,
  );
}

function certifyEdgeSchema(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const edge = findName16(data, "Edge", 0, data.byteLength);
  if (edge < 0) throw new Error("Formats/Latest has no Edge definition");
  const gEdge = findName16(data, "GEdge", edge + 1, edge + 32);
  const gEdgeBase = findName16(
    data,
    "GEdgeBase",
    edge + 1,
    edge + 48,
  );
  if (gEdge < 0 || gEdgeBase < 0) {
    throw new Error("Formats/Latest has no Edge/GEdge/GEdgeBase chain");
  }
  const edgeTag = view.getUint16(edge + 2 + "Edge".length, true);
  const gEdgeTag = view.getUint16(gEdge + 2 + "GEdge".length, true);
  const gEdgeBaseTag = view.getUint16(
    gEdgeBase + 2 + "GEdgeBase".length,
    true,
  );
  if (
    edgeTag !== 0x8590 ||
    gEdgeTag !== 0x8591 ||
    gEdgeBaseTag !== 0x8592
  ) {
    throw new Error("Formats/Latest Edge class tags changed");
  }

  const names = [
    "m_pFace",
    "m_next",
    "m_prev",
    "m_interiorEdgePnts",
    "m_firstAndLastEdgePnts",
    "m_flags",
  ] as const;
  let cursor = gEdgeBase;
  const fields: { name: string; offset: number; descriptor: string }[] = [];
  for (const name of names) {
    const fieldOffset = findName32(data, name, cursor, edge + 512);
    if (fieldOffset < 0) {
      throw new Error(`Formats/Latest GEdge field ${name} is missing`);
    }
    const descriptorOffset = fieldOffset + 4 + name.length;
    let expected: readonly number[];
    if (name === "m_pFace" || name === "m_next" || name === "m_prev") {
      expected = [0x0e, 0x13, 0, 0, 2, 0, 0, 0];
    } else if (name === "m_interiorEdgePnts") {
      expected = [0x0e, 0x50, 0, 0, 0x94, 0x85];
    } else if (name === "m_firstAndLastEdgePnts") {
      expected = [0x0e, 0x10, 0, 0, 2, 0, 0, 0, 0x94, 0x05];
    } else {
      expected = [0x02, 0, 0, 0];
    }
    if (!bytesEqual(data, descriptorOffset, expected)) {
      throw new Error(`Formats/Latest GEdge descriptor ${name} changed`);
    }
    fields.push({
      name,
      offset: fieldOffset,
      descriptor: expected
        .map((value) => value.toString(16).padStart(2, "0"))
        .join(" "),
    });
    cursor = descriptorOffset + expected.length;
  }

  const edgePoint = findName16(
    data,
    "EdgePnt",
    fields[3]!.offset,
    fields[4]!.offset,
  );
  const uv = findName32(
    data,
    "uv",
    fields[3]!.offset,
    fields[4]!.offset,
  );
  if (
    edgePoint < 0 ||
    uv < 0 ||
    view.getUint16(edgePoint + 2 + "EdgePnt".length, true) !== 0 ||
    !bytesEqual(data, uv + 6, [
      0x0d, 0x10, 0, 0, 2, 0, 0, 0,
    ])
  ) {
    throw new Error("Formats/Latest EdgePnt UV pair changed");
  }

  return {
    ok: true,
    edgeOffset: edge,
    schemaTags: {
      Edge: edgeTag & 0x7fff,
      GEdge: gEdgeTag & 0x7fff,
      GEdgeBase: gEdgeBaseTag & 0x7fff,
    },
    sourceClassSlot: REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
    fields,
    edgePoint: {
      offset: edgePoint,
      field: "uv",
      tuple: "2 * Point2d<double>",
      serializedBytes: 32,
    },
  };
}

function requireTokens(
  entries: readonly CondInt16QueueEntry[],
  firstToken: number,
): string | null {
  let expectedToken = firstToken;
  for (const entry of entries) {
    if (entry.sourceClassSlot == null || entry.token === 0) {
      return "FIFO append list contains a null property";
    }
    if (entry.token === -1) continue;
    if (entry.token !== expectedToken) {
      return (
        `FIFO token mismatch: expected ${expectedToken}, ` +
        `received ${entry.token} for source slot ${entry.sourceClassSlot}`
      );
    }
    expectedToken += 1;
  }
  return null;
}

function numberedPropertyCount(
  entries: readonly CondInt16QueueEntry[],
): number {
  return entries.reduce(
    (count, entry) => count + (entry.token > 0 ? 1 : 0),
    0,
  );
}

type ExactReplay = {
  directGeometryRoots: number;
  singleGroupGeometryRoots: number;
  geometryOwners: number;
  geometryOwnersWithEdges: number;
  declaredFaces: number;
  decodedFaces: number;
  declaredEdges: number;
  positionedEdges: number;
  decodedEdges: number;
  faceBodyBytes: Map<number, number>;
  faceRegionCounts: Map<number, number>;
  faceChildSlots: Map<number, number>;
  faceChildTokenKinds: Map<string, number>;
  edgeBodyBytes: Map<number, number>;
  edgeInteriorPointCounts: Map<number, number>;
  edgeFlags: Map<number, number>;
  edgeNativeCurveKinds: Map<string, number>;
  edgeUvScalars: ScalarStats;
  edgeFaceReferences: ReferenceStats;
  edgeNextReferences: ReferenceStats;
  edgePreviousReferences: ReferenceStats;
  failures: Map<string, number>;
};

type ScalarStats = {
  total: number;
  finite: number;
  nan: number;
  positiveInfinity: number;
  negativeInfinity: number;
  positiveZero: number;
  negativeZero: number;
  minFinite: number;
  maxFinite: number;
  extremeFiniteValues: Map<string, number>;
};

type ReferenceStats = {
  total: number;
  negativeOne: number;
  zero: number;
  positive: number;
  otherNegative: number;
  min: number;
  max: number;
  exactValues: Map<number, number>;
};

function createScalarStats(): ScalarStats {
  return {
    total: 0,
    finite: 0,
    nan: 0,
    positiveInfinity: 0,
    negativeInfinity: 0,
    positiveZero: 0,
    negativeZero: 0,
    minFinite: Number.POSITIVE_INFINITY,
    maxFinite: Number.NEGATIVE_INFINITY,
    extremeFiniteValues: new Map(),
  };
}

function createReferenceStats(): ReferenceStats {
  return {
    total: 0,
    negativeOne: 0,
    zero: 0,
    positive: 0,
    otherNegative: 0,
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
    exactValues: new Map(),
  };
}

function recordScalar(stats: ScalarStats, value: number): void {
  stats.total += 1;
  if (Number.isNaN(value)) {
    stats.nan += 1;
    return;
  }
  if (value === Number.POSITIVE_INFINITY) {
    stats.positiveInfinity += 1;
    return;
  }
  if (value === Number.NEGATIVE_INFINITY) {
    stats.negativeInfinity += 1;
    return;
  }
  stats.finite += 1;
  stats.minFinite = Math.min(stats.minFinite, value);
  stats.maxFinite = Math.max(stats.maxFinite, value);
  if (value === 0) {
    if (Object.is(value, -0)) stats.negativeZero += 1;
    else stats.positiveZero += 1;
  }
  if (Math.abs(value) >= 1e300) {
    increment(stats.extremeFiniteValues, value.toString());
  }
}

function recordEdgePoint(stats: ScalarStats, point: Revit2027EdgePoint): void {
  for (const value of [
    ...point.firstFaceUv,
    ...point.secondFaceUv,
  ]) {
    recordScalar(stats, value);
  }
}

function recordReferences(
  stats: ReferenceStats,
  values: readonly [number, number],
): void {
  for (const value of values) {
    stats.total += 1;
    stats.min = Math.min(stats.min, value);
    stats.max = Math.max(stats.max, value);
    increment(stats.exactValues, value);
    if (value === -1) stats.negativeOne += 1;
    else if (value === 0) stats.zero += 1;
    else if (value > 0) stats.positive += 1;
    else stats.otherNegative += 1;
  }
}

function recordFaceReplay(face: Revit2027FaceStatic, replay: ExactReplay): void {
  increment(replay.faceBodyBytes, face.endOffset - face.byteOffset);
  increment(replay.faceRegionCounts, face.faceRegions.count);
  for (const entry of face.queuedProperties) {
    increment(replay.faceChildSlots, entry.sourceClassSlot!);
    increment(
      replay.faceChildTokenKinds,
      `${entry.sourceClassSlot}:${
        entry.token === -1 ? "sentinel" : "numbered"
      }`,
    );
  }
}

function replaySingleGeometryRoot(
  data: Uint8Array,
  root: {
    children: readonly CondInt16QueueEntry[];
    dynamicPayloadOffset: number;
    dynamicPayloadEndOffset: number;
  },
  release: number,
  replay: ExactReplay,
): void {
  let geometryOffset: number | null = null;
  let firstGeometryAppendToken = 0;
  if (
    root.children.length === 1 &&
    root.children[0]?.sourceClassSlot ===
      REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT
  ) {
    replay.directGeometryRoots += 1;
    const rootTokenError = requireTokens(root.children, 3);
    if (rootTokenError) {
      increment(replay.failures, `direct root: ${rootTokenError}`);
      return;
    }
    geometryOffset = root.dynamicPayloadOffset;
    firstGeometryAppendToken = 4;
  } else if (
    root.children.length === 1 &&
    root.children[0]?.sourceClassSlot ===
      REVIT_2027_GGROUP_SOURCE_CLASS_SLOT
  ) {
    const rootTokenError = requireTokens(root.children, 3);
    if (rootTokenError) {
      increment(replay.failures, `single group root: ${rootTokenError}`);
      return;
    }
    const group = decodeRevit2027GGroupStatic(
      data,
      root.dynamicPayloadOffset,
      root.dynamicPayloadEndOffset,
      release,
    );
    if (
      !group.ok ||
      group.value.children.length !== 1 ||
      group.value.children[0]?.sourceClassSlot !==
        REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT
    ) {
      return;
    }
    replay.singleGroupGeometryRoots += 1;
    const groupTokenError = requireTokens(group.value.children, 4);
    if (groupTokenError) {
      increment(replay.failures, `single group child: ${groupTokenError}`);
      return;
    }
    geometryOffset = group.value.endOffset;
    firstGeometryAppendToken = 5;
  }
  if (geometryOffset == null) return;

  const geometry = decodeRevit2027GeometryStatic(
    data,
    geometryOffset,
    root.dynamicPayloadEndOffset,
    release,
  );
  if (!geometry.ok) {
    increment(replay.failures, geometry.error);
    return;
  }
  const geometryTokenError = requireTokens(
    geometry.value.queuedProperties,
    firstGeometryAppendToken,
  );
  if (geometryTokenError) {
    increment(replay.failures, geometryTokenError);
    return;
  }
  if (
    geometry.value.faces.entries.some(
      (entry) =>
        entry.sourceClassSlot !== REVIT_2027_FACE_SOURCE_CLASS_SLOT,
    )
  ) {
    increment(
      replay.failures,
      "Geometry face descriptor is not source slot 1825",
    );
    return;
  }
  if (
    geometry.value.edges.entries.some(
      (entry) =>
        entry.sourceClassSlot !== REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
    )
  ) {
    increment(
      replay.failures,
      "Geometry edge descriptor is not source slot 1423",
    );
    return;
  }

  replay.geometryOwners += 1;
  if (geometry.value.edges.count > 0) {
    replay.geometryOwnersWithEdges += 1;
  }
  replay.declaredFaces += geometry.value.faces.count;
  replay.declaredEdges += geometry.value.edges.count;

  let cursor = geometry.value.endOffset;
  let nextAppendToken =
    firstGeometryAppendToken +
    numberedPropertyCount(geometry.value.queuedProperties);
  for (let index = 0; index < geometry.value.faces.count; index += 1) {
    const face = decodeRevit2027FaceStatic(
      data,
      cursor,
      root.dynamicPayloadEndOffset,
      release,
    );
    if (!face.ok) {
      increment(replay.failures, face.error);
      return;
    }
    const faceTokenError = requireTokens(
      face.value.queuedProperties,
      nextAppendToken,
    );
    if (faceTokenError) {
      increment(replay.failures, faceTokenError);
      return;
    }
    nextAppendToken += numberedPropertyCount(face.value.queuedProperties);
    cursor = face.value.endOffset;
    replay.decodedFaces += 1;
    recordFaceReplay(face.value, replay);
  }

  // Face children were appended to the tail. The pre-existing Geometry edges
  // therefore occupy the next bodies in FIFO order.
  replay.positionedEdges += geometry.value.edges.count;
  for (let index = 0; index < geometry.value.edges.count; index += 1) {
    const edge = decodeRevit2027GEdgeStatic(
      data,
      cursor,
      root.dynamicPayloadEndOffset,
      release,
    );
    if (!edge.ok) {
      increment(replay.failures, edge.error);
      return;
    }
    cursor = edge.value.endOffset;
    replay.decodedEdges += 1;
    increment(
      replay.edgeBodyBytes,
      edge.value.endOffset - edge.value.byteOffset,
    );
    increment(
      replay.edgeInteriorPointCounts,
      edge.value.interiorEdgePoints.length,
    );
    increment(replay.edgeFlags, edge.value.flags);
    increment(
      replay.edgeNativeCurveKinds,
      revit2027GEdgeNativeCurveKind(edge.value),
    );
    for (const point of edge.value.interiorEdgePoints) {
      recordEdgePoint(replay.edgeUvScalars, point);
    }
    for (const point of edge.value.firstAndLastEdgePoints) {
      recordEdgePoint(replay.edgeUvScalars, point);
    }
    recordReferences(
      replay.edgeFaceReferences,
      edge.value.faceReferences,
    );
    recordReferences(
      replay.edgeNextReferences,
      edge.value.nextReferences,
    );
    recordReferences(
      replay.edgePreviousReferences,
      edge.value.previousReferences,
    );
  }
}

type Census = {
  geometryBodies: number;
  edgeBearingGeometryBodies: number;
  faceDescriptors: number;
  edgeDescriptors: number;
  faceSlots: Map<number, number>;
  edgeSlots: Map<number, number>;
  geometryBodiesWithEdgesButNoFaces: number;
};

function recordGeometry(
  value: Revit2027GeometryStatic,
  census: Census,
): void {
  census.geometryBodies += 1;
  census.faceDescriptors += value.faces.count;
  census.edgeDescriptors += value.edges.count;
  if (value.edges.count > 0) {
    census.edgeBearingGeometryBodies += 1;
    if (value.faces.count === 0) {
      census.geometryBodiesWithEdgesButNoFaces += 1;
    }
  }
  for (const entry of value.faces.entries) {
    increment(census.faceSlots, entry.sourceClassSlot!);
  }
  for (const entry of value.edges.entries) {
    increment(census.edgeSlots, entry.sourceClassSlot!);
  }
}

const modelPath = requireModelPath(
  "audit-revit-2027-edge-1423.ts model.rvt",
);

const model = openRvt(modelPath);
const release = model.requireRelease(2027);
const schema = model.firstInflatedStream(FORMATS_LATEST_PATTERN);
if (!schema) throw new Error("RVT has no readable Formats/Latest stream");
const schemaEvidence = certifyEdgeSchema(schema);

const census: Census = {
  geometryBodies: 0,
  edgeBearingGeometryBodies: 0,
  faceDescriptors: 0,
  edgeDescriptors: 0,
  faceSlots: new Map(),
  edgeSlots: new Map(),
  geometryBodiesWithEdgesButNoFaces: 0,
};
const exactReplay: ExactReplay = {
  directGeometryRoots: 0,
  singleGroupGeometryRoots: 0,
  geometryOwners: 0,
  geometryOwnersWithEdges: 0,
  declaredFaces: 0,
  decodedFaces: 0,
  declaredEdges: 0,
  positionedEdges: 0,
  decodedEdges: 0,
  faceBodyBytes: new Map(),
  faceRegionCounts: new Map(),
  faceChildSlots: new Map(),
  faceChildTokenKinds: new Map(),
  edgeBodyBytes: new Map(),
  edgeInteriorPointCounts: new Map(),
  edgeFlags: new Map(),
  edgeNativeCurveKinds: new Map(),
  edgeUvScalars: createScalarStats(),
  edgeFaceReferences: createReferenceStats(),
  edgeNextReferences: createReferenceStats(),
  edgePreviousReferences: createReferenceStats(),
  failures: new Map(),
};
let chunks = 0;
let failedChunks = 0;
let outerEdgeDescriptors = 0;
let initialGeometryBodies = 0;
let nestedGeometryBodies = 0;
const routeFailures = new Map<string, number>();

const partitions = model.streamsMatching(PARTITION_STREAM_PATTERN);

for (const { data: inflated } of iterateInflatedChunks(model, {
  onFailure: () => {
    failedChunks += 1;
  },
})) {
  chunks += 1;

  for (const frame of scanFramedElementObjects(inflated)) {
    if (frame.marker !== REVIT_2027_GELEMENT_OBJECT_MARKER) continue;
    const decodedRoot = decodeRevit2027FramedGRepRoot(
      inflated,
      frame,
      release,
    );
    if (!decodedRoot.ok) continue;
    const root = decodedRoot.value;
    replaySingleGeometryRoot(inflated, root, release, exactReplay);
    outerEdgeDescriptors += root.children.filter(
      (entry) =>
        entry.sourceClassSlot === REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
    ).length;

    if (
      root.children[0]?.sourceClassSlot ===
      REVIT_2027_GGROUP_SOURCE_CLASS_SLOT
    ) {
      let offset = root.dynamicPayloadOffset;
      let nextToken = 3 + numberedPropertyCount(root.children);
      let firstNestedGeometry = false;
      let failure: string | null = requireTokens(root.children, 3);
      for (
        let queueIndex = 0;
        failure == null && queueIndex < root.children.length;
        queueIndex += 1
      ) {
        const entry = root.children[queueIndex]!;
        if (
          entry.sourceClassSlot ===
          REVIT_2027_GGROUP_SOURCE_CLASS_SLOT
        ) {
          const group = decodeRevit2027GGroupStatic(
            inflated,
            offset,
            root.dynamicPayloadEndOffset,
            release,
          );
          if (!group.ok) {
            failure = group.error;
            break;
          }
          if (queueIndex === 0) {
            firstNestedGeometry =
              group.value.children[0]?.sourceClassSlot ===
              REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT;
          }
          failure = requireTokens(group.value.children, nextToken);
          nextToken += numberedPropertyCount(group.value.children);
          offset = group.value.endOffset;
        } else if (
          entry.sourceClassSlot ===
          REVIT_2027_GARRAY_SOURCE_CLASS_SLOT
        ) {
          const endOffset = offset + REVIT_2027_GARRAY_BODY_BYTES;
          const array = decodeRevit2027GArray(
            inflated,
            offset,
            endOffset,
            release,
          );
          if (!array.ok || endOffset > root.dynamicPayloadEndOffset) {
            failure = array.ok
              ? "GArray exceeds replay boundary"
              : array.error;
            break;
          }
          offset = array.value.endOffset;
        } else if (
          entry.sourceClassSlot === REVIT_2027_GLINE_SOURCE_CLASS_SLOT
        ) {
          const endOffset = offset + REVIT_2027_GLINE_BODY_BYTES;
          const line = decodeRevit2027GLine(
            inflated,
            offset,
            endOffset,
            release,
          );
          if (!line.ok || endOffset > root.dynamicPayloadEndOffset) {
            failure = line.ok
              ? "GLine exceeds replay boundary"
              : line.error;
            break;
          }
          offset = line.value.endOffset;
        } else if (
          entry.sourceClassSlot ===
          REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT
        ) {
          const geometry = decodeRevit2027GeometryStatic(
            inflated,
            offset,
            root.dynamicPayloadEndOffset,
            release,
          );
          if (!geometry.ok) {
            failure = geometry.error;
            break;
          }
          failure = requireTokens(
            geometry.value.queuedProperties,
            nextToken,
          );
          nextToken += numberedPropertyCount(
            geometry.value.queuedProperties,
          );
          offset = geometry.value.endOffset;
        } else {
          failure =
            `no certified sibling reader for slot ` +
            `${entry.sourceClassSlot}`;
        }
      }
      if (firstNestedGeometry) {
        if (failure) {
          increment(routeFailures, failure);
        } else {
          const geometry = decodeRevit2027GeometryStatic(
            inflated,
            offset,
            root.dynamicPayloadEndOffset,
            release,
          );
          if (!geometry.ok) {
            increment(routeFailures, geometry.error);
          } else {
            const tokenError = requireTokens(
              geometry.value.queuedProperties,
              nextToken,
            );
            if (tokenError) increment(routeFailures, tokenError);
            else {
              nestedGeometryBodies += 1;
              recordGeometry(geometry.value, census);
            }
          }
        }
      }
    }

    const geometryIndex = root.children.findIndex(
      (entry) =>
        entry.sourceClassSlot === REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
    );
    if (
      geometryIndex < 0 ||
      geometryIndex !== root.children.length - 1 ||
      root.children
        .slice(0, geometryIndex)
        .some(
          (entry) =>
            entry.sourceClassSlot !==
            REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
        )
    ) {
      continue;
    }
    let offset = root.dynamicPayloadOffset;
    let nextToken = 3 + numberedPropertyCount(root.children);
    let failure: string | null = requireTokens(root.children, 3);
    for (
      let index = 0;
      failure == null && index < geometryIndex;
      index += 1
    ) {
      const group = decodeRevit2027GGroupStatic(
        inflated,
        offset,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!group.ok) {
        failure = group.error;
        break;
      }
      failure = requireTokens(group.value.children, nextToken);
      nextToken += numberedPropertyCount(group.value.children);
      offset = group.value.endOffset;
    }
    if (failure) continue;
    const geometry = decodeRevit2027GeometryStatic(
      inflated,
      offset,
      root.dynamicPayloadEndOffset,
      release,
    );
    if (!geometry.ok) continue;
    const tokenError = requireTokens(
      geometry.value.queuedProperties,
      nextToken,
    );
    if (tokenError) continue;
    initialGeometryBodies += 1;
    recordGeometry(geometry.value, census);
  }

}
function scalarSummary(stats: ScalarStats) {
  return {
    total: stats.total,
    finite: stats.finite,
    nonFinite: {
      total:
        stats.nan +
        stats.positiveInfinity +
        stats.negativeInfinity,
      nan: stats.nan,
      positiveInfinity: stats.positiveInfinity,
      negativeInfinity: stats.negativeInfinity,
    },
    zero: {
      positive: stats.positiveZero,
      negative: stats.negativeZero,
    },
    finiteRange:
      stats.finite === 0
        ? null
        : { min: stats.minFinite, max: stats.maxFinite },
    extremeFiniteSentinelCandidates: countsByFrequency(
      stats.extremeFiniteValues,
    ),
  };
}

function referenceSummary(stats: ReferenceStats) {
  return {
    total: stats.total,
    signedCategories: {
      negativeOne: stats.negativeOne,
      zero: stats.zero,
      positive: stats.positive,
      otherNegative: stats.otherNegative,
    },
    range:
      stats.total === 0 ? null : { min: stats.min, max: stats.max },
    distinctValues: stats.exactValues.size,
    mostFrequentExactValues: Object.fromEntries(
      [...stats.exactValues]
        .sort(
          (left, right) =>
            right[1] - left[1] || left[0] - right[0],
        )
        .slice(0, 20)
        .map(([value, count]) => [value.toString(), count]),
    ),
  };
}

const allReachableFacesAreExpected =
  census.faceSlots.size === 1 &&
  census.faceSlots.get(REVIT_2027_FACE_SOURCE_CLASS_SLOT) ===
    census.faceDescriptors;
const allReachableEdgesAreExpected =
  census.edgeSlots.size === 1 &&
  census.edgeSlots.get(REVIT_2027_GEDGE_SOURCE_CLASS_SLOT) ===
    census.edgeDescriptors;
if (!allReachableFacesAreExpected || !allReachableEdgesAreExpected) {
  throw new Error("reachable Geometry queue contains an unexpected source slot");
}

console.log(JSON.stringify({
  modelPath,
  release,
  schemaEvidence,
  partitions: partitions.length,
  chunks,
  failedChunks,
  outerEdgeDescriptors,
  reachableGeometry: {
    bodies: census.geometryBodies,
    initialBodies: initialGeometryBodies,
    nestedBodies: nestedGeometryBodies,
    edgeBearingBodies: census.edgeBearingGeometryBodies,
    bodiesWithEdgesButNoFaces:
      census.geometryBodiesWithEdgesButNoFaces,
    faceDescriptors: census.faceDescriptors,
    faceSourceSlots: countsByFrequency(census.faceSlots),
    edgeDescriptors: census.edgeDescriptors,
    edgeSourceSlots: countsByFrequency(census.edgeSlots),
  },
  edgeReplay: {
    certifiedOwnerScopes: {
      directGeometryRoots: exactReplay.directGeometryRoots,
      singleGroupGeometryRoots: exactReplay.singleGroupGeometryRoots,
      geometryOwners: exactReplay.geometryOwners,
      geometryOwnersWithEdges: exactReplay.geometryOwnersWithEdges,
    },
    faces: {
      declaredBodies: exactReplay.declaredFaces,
      decodedBodies: exactReplay.decodedFaces,
      coveragePercent:
        exactReplay.declaredFaces === 0
          ? 100
          : Number(
              (
                (exactReplay.decodedFaces * 100) /
                exactReplay.declaredFaces
              ).toFixed(4),
            ),
      bodyBytes: countsByFrequency(exactReplay.faceBodyBytes),
      regionCounts: countsByFrequency(exactReplay.faceRegionCounts),
      appendedChildSourceSlots: countsByFrequency(exactReplay.faceChildSlots),
      appendedChildTokenKinds: countsByFrequency(exactReplay.faceChildTokenKinds),
    },
    edges: {
      declaredBodies: exactReplay.declaredEdges,
      positionedBodies: exactReplay.positionedEdges,
      decodedBodies: exactReplay.decodedEdges,
      positionedCoveragePercent:
        exactReplay.declaredEdges === 0
          ? 100
          : Number(
              (
                (exactReplay.positionedEdges * 100) /
                exactReplay.declaredEdges
              ).toFixed(4),
            ),
      decodedCoveragePercent:
        exactReplay.declaredEdges === 0
          ? 100
          : Number(
              (
                (exactReplay.decodedEdges * 100) /
                exactReplay.declaredEdges
              ).toFixed(4),
            ),
      bodyBytes: countsByFrequency(exactReplay.edgeBodyBytes),
      interiorPointCounts: countsByFrequency(exactReplay.edgeInteriorPointCounts),
      flags: countsByFrequency(exactReplay.edgeFlags),
      nativeCurveKinds: countsByFrequency(exactReplay.edgeNativeCurveKinds),
      uvScalars: scalarSummary(exactReplay.edgeUvScalars),
      references: {
        face: referenceSummary(exactReplay.edgeFaceReferences),
        next: referenceSummary(exactReplay.edgeNextReferences),
        previous: referenceSummary(
          exactReplay.edgePreviousReferences,
        ),
      },
      appendedChildSourceSlots: {},
      appendedChildDescriptors: 0,
    },
    failures: countsByFrequency(exactReplay.failures),
    stoppedBeforeUncertifiedQueuedBodies: true,
    stopBoundary:
      "after Geometry-owned GEdge bodies and before shared-surface-info or Face-owned child bodies",
  },
  routeFailures: countsByFrequency(routeFailures),
}, null, 2));
