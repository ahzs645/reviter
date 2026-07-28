import {
  locateFacetedTopology8Body,
  type FacetedTopology8Body,
} from "./faceted-topology.ts";

const DEFAULT_MAX_QUEUE_ENTRIES = 10_000;
const DEFAULT_MAX_QUEUE_SEARCH_BYTES = 64 * 1024;
const UINT64_MAX = (1n << 64n) - 1n;

export const REVIT_2026_GPOLYMESH_SOURCE_CLASS = 2237;
export const REVIT_COMMON_FACETED_TOPOLOGY8_SOURCE_CLASS = 5255;

export type CondInt16QueueEntry = {
  byteOffset: number;
  endOffset: number;
  token: number;
  sourceClassSlot: number | null;
};

export type CondInt16QueueCollection = {
  countOffset: number;
  entriesOffset: number;
  /** End of this counted collection, not necessarily dynamic replay start. */
  endOffset: number;
  count: number;
  entries: readonly CondInt16QueueEntry[];
};

export type CondInt16QueueDecodeResult =
  | { ok: true; collection: CondInt16QueueCollection }
  | { ok: false; error: string };

export type RevitTransform3d = {
  byteOffset: number;
  endOffset: number;
  xAxis: readonly [number, number, number];
  yAxis: readonly [number, number, number];
  zAxis: readonly [number, number, number];
  origin: readonly [number, number, number];
  /** Column-major affine matrix suitable for the browser tessellator. */
  matrix: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
};

export type ExactGPolyMeshBindingEvidence = {
  gPolyMeshSourceClassSlot: number;
  topologyPropertyToken: number;
  topologySourceClassSlot: number;
  /**
   * Exact state retained while `OdBmObjectPtrInitReader::read` traversed the
   * complete outer object. Browser readers may use stable surrogate IDs for
   * the native object/property pointers in the DynamicQueue DataKey.
   */
  dynamicQueueState: {
    collectionEndOffset: number;
    outerStaticEndOffset: number;
    replayOffset: number;
    objectIdentity: string;
    classPropertyIdentity: string;
    sequenceIndex: number;
    retainedValueCount: number;
    nextUnreadEntryIndex: number;
  };
  ownerElementId: bigint;
  styleElementId: bigint;
  materialElementId: bigint;
  polyMeshFlags: number;
  transform: RevitTransform3d;
};

export type QueuedFacetedTopology8Binding = {
  queue: CondInt16QueueCollection;
  topology: FacetedTopology8Body;
  ownerElementId: bigint;
  styleElementId: bigint;
  materialElementId: bigint;
  polyMeshFlags: number;
  transform: RevitTransform3d;
};

export type QueuedFacetedTopology8BindingResult =
  | { ok: true; binding: QueuedFacetedTopology8Binding }
  | {
      ok: false;
      error: string;
      queue?: CondInt16QueueCollection;
    };

function fits(data: Uint8Array, offset: number, byteLength: number): boolean {
  return (
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(byteLength) &&
    offset >= 0 &&
    byteLength >= 0 &&
    offset <= data.byteLength - byteLength
  );
}

/**
 * Decode the collection form used by `OdBmCollectionReader<OdBmCondInt16>`.
 *
 * Each item is an `int32` token followed, only when the token is nonzero, by
 * an `int16` source-class slot. The nested property bodies begin at the
 * returned `endOffset`. Derived readers can continue reading static fields
 * after this collection, so its end must not be treated as dynamic replay.
 */
export function decodeCondInt16QueueCollection(
  data: Uint8Array,
  countOffset: number,
  options: { maxEntries?: number } = {},
): CondInt16QueueDecodeResult {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_QUEUE_ENTRIES;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 0) {
    return { ok: false, error: "maxEntries must be a non-negative safe integer" };
  }
  if (!fits(data, countOffset, 4)) {
    return { ok: false, error: "CondInt16 collection count is truncated" };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getInt32(countOffset, true);
  if (count < 0 || count > maxEntries) {
    return { ok: false, error: "CondInt16 collection count is outside the allowed range" };
  }

  const entries: CondInt16QueueEntry[] = [];
  let offset = countOffset + 4;
  for (let index = 0; index < count; index += 1) {
    if (!fits(data, offset, 4)) {
      return { ok: false, error: "CondInt16 queue token is truncated" };
    }
    const byteOffset = offset;
    const token = view.getInt32(offset, true);
    offset += 4;
    let sourceClassSlot: number | null = null;
    if (token !== 0) {
      if (!fits(data, offset, 2)) {
        return { ok: false, error: "CondInt16 source-class slot is truncated" };
      }
      sourceClassSlot = view.getInt16(offset, true);
      if (sourceClassSlot <= 0) {
        return { ok: false, error: "CondInt16 source-class slot is not positive" };
      }
      offset += 2;
    }
    entries.push({ byteOffset, endOffset: offset, token, sourceClassSlot });
  }

  return {
    ok: true,
    collection: {
      countOffset,
      entriesOffset: countOffset + 4,
      endOffset: offset,
      count,
      entries,
    },
  };
}

/**
 * Find a uniquely decodable CondInt16 collection whose end is exactly the
 * supplied offset. Ambiguous matches are rejected.
 */
export function locateCondInt16QueueEndingAt(
  data: Uint8Array,
  endOffset: number,
  options: { maxEntries?: number; maxSearchBytes?: number } = {},
): CondInt16QueueDecodeResult {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_QUEUE_ENTRIES;
  const maxSearchBytes =
    options.maxSearchBytes ?? DEFAULT_MAX_QUEUE_SEARCH_BYTES;
  if (
    !Number.isSafeInteger(endOffset) ||
    endOffset < 4 ||
    endOffset > data.byteLength
  ) {
    return { ok: false, error: "endOffset is outside the supplied bytes" };
  }
  if (!Number.isSafeInteger(maxSearchBytes) || maxSearchBytes < 4) {
    return { ok: false, error: "maxSearchBytes must be a safe integer of at least four" };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const firstOffset = Math.max(0, endOffset - maxSearchBytes);
  let match: CondInt16QueueCollection | null = null;
  for (let countOffset = firstOffset; countOffset <= endOffset - 4; countOffset += 1) {
    const count = view.getInt32(countOffset, true);
    if (count <= 0 || count > maxEntries) continue;
    const available = endOffset - countOffset - 4;
    if (available < count * 4 || available > count * 6) continue;
    const decoded = decodeCondInt16QueueCollection(data, countOffset, {
      maxEntries,
    });
    if (!decoded.ok || decoded.collection.endOffset !== endOffset) continue;
    if (match) {
      return {
        ok: false,
        error: "multiple CondInt16 collections end at the supplied endOffset",
      };
    }
    match = decoded.collection;
  }
  return match
    ? { ok: true, collection: match }
    : {
        ok: false,
        error: "no bounded CondInt16 collection ends at the supplied endOffset",
      };
}

function validUnsignedId(value: bigint): boolean {
  return value >= 0n && value <= UINT64_MAX;
}

function validTransform(transform: RevitTransform3d): boolean {
  return (
    transform.matrix.length === 16 &&
    transform.matrix.every(Number.isFinite) &&
    transform.matrix[3] === 0 &&
    transform.matrix[7] === 0 &&
    transform.matrix[11] === 0 &&
    transform.matrix[15] === 1
  );
}

/**
 * Bind a selector-free topology body only when the queue-to-owner evidence is
 * complete and unambiguous.
 *
 * A multi-entry queue is intentionally rejected: DynamicQueue can satisfy
 * earlier entries from retained data, so adjacency alone does not identify
 * which queued property consumes the next bytes.
 */
export function bindQueuedFacetedTopology8(
  data: Uint8Array,
  evidence: ExactGPolyMeshBindingEvidence,
): QueuedFacetedTopology8BindingResult {
  const state = evidence.dynamicQueueState;
  const queue = locateCondInt16QueueEndingAt(data, state.collectionEndOffset);
  if (!queue.ok) return queue;
  const collection = queue.collection;
  if (collection.count !== 1) {
    return {
      ok: false,
      error: "faceted topology ownership is ambiguous in a multi-entry DynamicQueue",
      queue: collection,
    };
  }
  const entry = collection.entries[0]!;
  if (
    state.outerStaticEndOffset !== state.replayOffset ||
    state.replayOffset < collection.endOffset ||
    state.nextUnreadEntryIndex !== 0 ||
    state.retainedValueCount !== 0 ||
    state.objectIdentity.length === 0 ||
    state.classPropertyIdentity.length === 0 ||
    state.sequenceIndex !== -1
  ) {
    return {
      ok: false,
      error:
        "complete outer-object and DataKey replay state is required before binding topology",
      queue: collection,
    };
  }
  if (
    evidence.gPolyMeshSourceClassSlot !== REVIT_2026_GPOLYMESH_SOURCE_CLASS ||
    evidence.topologySourceClassSlot !==
      REVIT_COMMON_FACETED_TOPOLOGY8_SOURCE_CLASS ||
    entry.sourceClassSlot !== evidence.topologySourceClassSlot ||
    entry.token !== evidence.topologyPropertyToken
  ) {
    return {
      ok: false,
      error: "queued property does not exactly identify the Revit 2026 GPolyMesh topology",
      queue: collection,
    };
  }
  if (
    !validUnsignedId(evidence.ownerElementId) ||
    !validUnsignedId(evidence.styleElementId) ||
    !validUnsignedId(evidence.materialElementId) ||
    !Number.isInteger(evidence.polyMeshFlags) ||
    evidence.polyMeshFlags < -0x80000000 ||
    evidence.polyMeshFlags > 0x7fffffff ||
    !validTransform(evidence.transform)
  ) {
    return {
      ok: false,
      error: "GPolyMesh owner, style, material, flags, or transform evidence is invalid",
      queue: collection,
    };
  }
  const topology = locateFacetedTopology8Body(data, state.replayOffset);
  if (!topology.ok) {
    return { ok: false, error: topology.error, queue: collection };
  }
  return {
    ok: true,
    binding: {
      queue: collection,
      topology: topology.body,
      ownerElementId: evidence.ownerElementId,
      styleElementId: evidence.styleElementId,
      materialElementId: evidence.materialElementId,
      polyMeshFlags: evidence.polyMeshFlags,
      transform: evidence.transform,
    },
  };
}

/**
 * Decode `Trf201120260Reader`: three float64 basis vectors followed by a
 * float64 origin point (96 bytes total).
 */
export function decodeTrf201120260(
  data: Uint8Array,
  byteOffset: number,
): { ok: true; transform: RevitTransform3d } | { ok: false; error: string } {
  if (!fits(data, byteOffset, 96)) {
    return { ok: false, error: "Trf201120260 body is truncated" };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tuple = (offset: number): [number, number, number] => [
    view.getFloat64(offset, true),
    view.getFloat64(offset + 8, true),
    view.getFloat64(offset + 16, true),
  ];
  const xAxis = tuple(byteOffset);
  const yAxis = tuple(byteOffset + 24);
  const zAxis = tuple(byteOffset + 48);
  const origin = tuple(byteOffset + 72);
  if (![...xAxis, ...yAxis, ...zAxis, ...origin].every(Number.isFinite)) {
    return { ok: false, error: "Trf201120260 contains a non-finite scalar" };
  }
  const determinant =
    xAxis[0] * (yAxis[1] * zAxis[2] - yAxis[2] * zAxis[1]) -
    yAxis[0] * (xAxis[1] * zAxis[2] - xAxis[2] * zAxis[1]) +
    zAxis[0] * (xAxis[1] * yAxis[2] - xAxis[2] * yAxis[1]);
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-12) {
    return { ok: false, error: "Trf201120260 basis is singular" };
  }
  return {
    ok: true,
    transform: {
      byteOffset,
      endOffset: byteOffset + 96,
      xAxis,
      yAxis,
      zAxis,
      origin,
      matrix: [
        xAxis[0],
        xAxis[1],
        xAxis[2],
        0,
        yAxis[0],
        yAxis[1],
        yAxis[2],
        0,
        zAxis[0],
        zAxis[1],
        zAxis[2],
        0,
        origin[0],
        origin[1],
        origin[2],
        1,
      ],
    },
  };
}
