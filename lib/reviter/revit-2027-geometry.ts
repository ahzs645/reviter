import {
  decodeCondInt16QueueCollection,
  type CondInt16QueueCollection,
  type CondInt16QueueEntry,
} from "./dynamic-geometry-queue.ts";
import type { Revit2027GInfo } from "./revit-2027-grep-prefixes.ts";

export const REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT = 2343;

const GINFO_BYTES = 20;
const INT32_BYTES = 4;
const TESS_EPS_CNTRL_BYTES = 8;
const DEFAULT_MAX_COLLECTION_ENTRIES = 1_000_000;

export type Revit2027TessEpsCntrl = {
  type: number;
  version: number;
};

export type Revit2027GeometryStatic = {
  byteOffset: number;
  endOffset: number;
  gInfo: Revit2027GInfo;
  /** `GBRep.m_pFaces`; the queued face bodies follow normal FIFO order. */
  faces: CondInt16QueueCollection;
  flags: number;
  geometryTag: number;
  tessEpsCntrl: Revit2027TessEpsCntrl;
  /** `Geometry.m_pEdges`; these descriptors enqueue edge bodies. */
  edges: CondInt16QueueCollection;
  /** `Geometry.m_sharedSurfInfo`; these descriptors enqueue surface data. */
  sharedSurfaceInfo: CondInt16QueueCollection;
  /** All properties appended by this body, in native insertion order. */
  queuedProperties: readonly CondInt16QueueEntry[];
};

export type Revit2027GeometryStaticDecodeResult =
  | { ok: true; value: Revit2027GeometryStatic }
  | { ok: false; error: string };

export type Revit2027GeometryDecodeOptions = {
  maxFaces?: number;
  maxEdges?: number;
  maxSharedSurfaceInfo?: number;
};

function bounded(
  data: Uint8Array,
  byteOffset: number,
  byteLength: number,
  enclosingEndOffset: number,
): boolean {
  return (
    Number.isSafeInteger(byteOffset) &&
    byteOffset >= 0 &&
    Number.isSafeInteger(byteLength) &&
    byteLength >= 0 &&
    Number.isSafeInteger(enclosingEndOffset) &&
    enclosingEndOffset >= byteOffset &&
    enclosingEndOffset <= data.byteLength &&
    byteOffset <= enclosingEndOffset - byteLength
  );
}

function decodeGInfo(view: DataView, byteOffset: number): Revit2027GInfo {
  return {
    gStyleElementId: view.getBigInt64(byteOffset, true),
    tag: view.getInt32(byteOffset + 8, true),
    controlCommand: view.getInt32(byteOffset + 12, true),
    flags: view.getUint32(byteOffset + 16, true),
  };
}

function maxEntries(
  value: number | undefined,
  name: string,
): number | { error: string } {
  const resolved = value ?? DEFAULT_MAX_COLLECTION_ENTRIES;
  return Number.isSafeInteger(resolved) && resolved >= 0
    ? resolved
    : { error: `${name} must be a non-negative safe integer` };
}

/**
 * Decode the complete selector-free static body of Revit 2027 source slot
 * 2,343 (`Geometry`).
 *
 * The exact file's schema and the available native reader agree on this
 * base-to-derived order:
 *
 * - `GNode/GInfo`;
 * - `GBRep.m_pFaces`, a counted `CondInt16` collection;
 * - `Geometry.m_flags` and `m_geometryTag`;
 * - the two-int32 `TessEpsCntrl`;
 * - counted `m_pEdges` and `m_sharedSurfInfo` `CondInt16` collections.
 *
 * This reader ends before every queued face/edge/surface body. It establishes
 * FIFO ownership and boundaries; it does not claim to decode or tessellate
 * those BRep bodies.
 */
export function decodeRevit2027GeometryStatic(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
  revitVersion: number,
  options: Revit2027GeometryDecodeOptions = {},
): Revit2027GeometryStaticDecodeResult {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "Revit 2027 Geometry decoding requires release 2027",
    };
  }

  const maxFaces = maxEntries(options.maxFaces, "maxFaces");
  if (typeof maxFaces !== "number") return { ok: false, error: maxFaces.error };
  const maxEdges = maxEntries(options.maxEdges, "maxEdges");
  if (typeof maxEdges !== "number") return { ok: false, error: maxEdges.error };
  const maxSharedSurfaceInfo = maxEntries(
    options.maxSharedSurfaceInfo,
    "maxSharedSurfaceInfo",
  );
  if (typeof maxSharedSurfaceInfo !== "number") {
    return { ok: false, error: maxSharedSurfaceInfo.error };
  }

  if (
    !bounded(
      data,
      byteOffset,
      GINFO_BYTES + INT32_BYTES,
      enclosingEndOffset,
    )
  ) {
    return { ok: false, error: "Revit 2027 Geometry/GBRep prefix is truncated" };
  }

  const boundedData =
    enclosingEndOffset === data.byteLength
      ? data
      : data.subarray(0, enclosingEndOffset);
  const faces = decodeCondInt16QueueCollection(
    boundedData,
    byteOffset + GINFO_BYTES,
    { maxEntries: maxFaces },
  );
  if (!faces.ok) {
    return { ok: false, error: `Geometry faces: ${faces.error}` };
  }

  let cursor = faces.collection.endOffset;
  const scalarBytes =
    INT32_BYTES + INT32_BYTES + TESS_EPS_CNTRL_BYTES + INT32_BYTES;
  if (!bounded(data, cursor, scalarBytes, enclosingEndOffset)) {
    return {
      ok: false,
      error: "Revit 2027 Geometry fields or edge count are truncated",
    };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const flags = view.getInt32(cursor, true);
  const geometryTag = view.getInt32(cursor + 4, true);
  const tessEpsCntrl = {
    type: view.getInt32(cursor + 8, true),
    version: view.getInt32(cursor + 12, true),
  };
  cursor += INT32_BYTES + INT32_BYTES + TESS_EPS_CNTRL_BYTES;

  const edges = decodeCondInt16QueueCollection(boundedData, cursor, {
    maxEntries: maxEdges,
  });
  if (!edges.ok) {
    return { ok: false, error: `Geometry edges: ${edges.error}` };
  }
  cursor = edges.collection.endOffset;

  const sharedSurfaceInfo = decodeCondInt16QueueCollection(
    boundedData,
    cursor,
    { maxEntries: maxSharedSurfaceInfo },
  );
  if (!sharedSurfaceInfo.ok) {
    return {
      ok: false,
      error: `Geometry shared-surface info: ${sharedSurfaceInfo.error}`,
    };
  }

  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: sharedSurfaceInfo.collection.endOffset,
      gInfo: decodeGInfo(view, byteOffset),
      faces: faces.collection,
      flags,
      geometryTag,
      tessEpsCntrl,
      edges: edges.collection,
      sharedSurfaceInfo: sharedSurfaceInfo.collection,
      queuedProperties: [
        ...faces.collection.entries,
        ...edges.collection.entries,
        ...sharedSurfaceInfo.collection.entries,
      ],
    },
  };
}
