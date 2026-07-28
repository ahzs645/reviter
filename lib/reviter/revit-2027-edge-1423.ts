import type { Revit2027GInfo } from "./revit-2027-grep-prefixes.ts";

export const REVIT_2027_GEDGE_SOURCE_CLASS_SLOT = 1423;

const GINFO_BYTES = 20;
const REFERENCE_ARRAY_BYTES = 2 * 4;
const EDGE_POINT_BYTES = 4 * 8;
const ENDPOINT_COUNT = 2;
const FIXED_BYTES_AFTER_INTERIOR_COUNT =
  ENDPOINT_COUNT * EDGE_POINT_BYTES + 1;
const DEFAULT_MAX_INTERIOR_EDGE_POINTS = 1_000_000;

export type Revit2027EdgePoint = {
  /** Parametric UV on the first adjacent face. */
  firstFaceUv: readonly [number, number];
  /** Parametric UV on the second adjacent face. */
  secondFaceUv: readonly [number, number];
};

export type Revit2027GEdgeStatic = {
  byteOffset: number;
  endOffset: number;
  gInfo: Revit2027GInfo;
  /** Two signed object-reference tokens for adjacent faces. */
  faceReferences: readonly [number, number];
  /** Two signed object-reference tokens for the next loop edges. */
  nextReferences: readonly [number, number];
  /** Two signed object-reference tokens for the previous loop edges. */
  previousReferences: readonly [number, number];
  interiorEdgePoints: readonly Revit2027EdgePoint[];
  firstAndLastEdgePoints: readonly [
    Revit2027EdgePoint,
    Revit2027EdgePoint,
  ];
  /**
   * Persisted GEdge flags: bit 0 flips curve-to-loop orientation; bits 1 and 2
   * mark the first and last endpoints; bit 3 marks a 3D arc.
   */
  flags: number;
  /** GEdge declares no queued property body of its own. */
  queuedPropertyCount: 0;
};

export type Revit2027GEdgeStaticDecodeResult =
  | { ok: true; value: Revit2027GEdgeStatic }
  | { ok: false; error: string };

/**
 * Return the native curve-sample direction for one face-local coedge.
 *
 * TB_Database reports OdBmBrEdge::getOrientToCurve() as forward. Its
 * isOrientToLoop() result is forward exactly when GEdge.isFlipped() equals
 * whether the face occupies faceReferences[1]. GEdge.isFlipped() is persisted
 * flags bit zero.
 */
export function revit2027GEdgeLoopDirection(
  edge: Pick<Revit2027GEdgeStatic, "flags">,
  faceSide: 0 | 1,
): 1 | -1 {
  const flipped = (edge.flags & 0x1) !== 0;
  return flipped === (faceSide === 1) ? 1 : -1;
}

/**
 * Return the native next coedge token for one face-local edge use.
 *
 * OdBmBrCoedge::GetNext() finds the loop Face in GEdge.faces[0..1], then
 * passes that exact side index to GEdge.getNextItem(). The latter directly
 * indexes the persisted two-item `next` array decoded here.
 */
export function revit2027GEdgeLoopNextReference(
  edge: Pick<Revit2027GEdgeStatic, "nextReferences">,
  faceSide: 0 | 1,
): number {
  return edge.nextReferences[faceSide];
}

/**
 * Return the native previous coedge token for one face-local edge use.
 *
 * This is the GetPrev/getPrevItem counterpart to
 * revit2027GEdgeLoopNextReference().
 */
export function revit2027GEdgeLoopPreviousReference(
  edge: Pick<Revit2027GEdgeStatic, "previousReferences">,
  faceSide: 0 | 1,
): number {
  return edge.previousReferences[faceSide];
}

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

function readInt32Pair(
  view: DataView,
  byteOffset: number,
): readonly [number, number] {
  return [
    view.getInt32(byteOffset, true),
    view.getInt32(byteOffset + 4, true),
  ];
}

function readEdgePoint(
  view: DataView,
  byteOffset: number,
): Revit2027EdgePoint {
  return {
    firstFaceUv: [
      view.getFloat64(byteOffset, true),
      view.getFloat64(byteOffset + 8, true),
    ],
    secondFaceUv: [
      view.getFloat64(byteOffset + 16, true),
      view.getFloat64(byteOffset + 24, true),
    ],
  };
}

/**
 * Decode the complete selector-free static body of Revit 2027 source slot
 * 1,423 (`GEdge`).
 *
 * Exact `Formats/Latest` schema evidence and the native field reader agree on
 * this base-to-derived order:
 *
 * - inherited 20-byte GNode/GInfo;
 * - fixed pairs of signed int32 face, next-edge, and previous-edge references;
 * - a counted array of EdgePnt values;
 * - two fixed endpoint EdgePnt values;
 * - one uint8 flags value.
 *
 * Each EdgePnt stores two double-precision UV pairs, one for each adjacent
 * face. The reader returns at the exact static boundary and does not resolve
 * object-reference tokens or infer any curve/surface body.
 */
export function decodeRevit2027GEdgeStatic(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
  revitVersion: number,
  options: { maxInteriorEdgePoints?: number } = {},
): Revit2027GEdgeStaticDecodeResult {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "Revit 2027 GEdge decoding requires release 2027",
    };
  }
  const maxInteriorEdgePoints =
    options.maxInteriorEdgePoints ?? DEFAULT_MAX_INTERIOR_EDGE_POINTS;
  if (
    !Number.isSafeInteger(maxInteriorEdgePoints) ||
    maxInteriorEdgePoints < 0
  ) {
    return {
      ok: false,
      error: "maxInteriorEdgePoints must be a non-negative safe integer",
    };
  }

  const interiorCountOffset =
    byteOffset + GINFO_BYTES + 3 * REFERENCE_ARRAY_BYTES;
  if (
    !bounded(
      data,
      byteOffset,
      GINFO_BYTES + 3 * REFERENCE_ARRAY_BYTES + 4,
      enclosingEndOffset,
    )
  ) {
    return { ok: false, error: "Revit 2027 GEdge prefix is truncated" };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const interiorCount = view.getInt32(interiorCountOffset, true);
  if (
    interiorCount < 0 ||
    interiorCount > maxInteriorEdgePoints
  ) {
    return {
      ok: false,
      error: "Revit 2027 GEdge interior-point count is outside the safety bound",
    };
  }
  const interiorBytes = interiorCount * EDGE_POINT_BYTES;
  const interiorOffset = interiorCountOffset + 4;
  const requiredAfterCount =
    interiorBytes + FIXED_BYTES_AFTER_INTERIOR_COUNT;
  if (
    !Number.isSafeInteger(requiredAfterCount) ||
    !bounded(
      data,
      interiorOffset,
      requiredAfterCount,
      enclosingEndOffset,
    )
  ) {
    return { ok: false, error: "Revit 2027 GEdge body is truncated" };
  }

  const interiorEdgePoints: Revit2027EdgePoint[] = [];
  for (let index = 0; index < interiorCount; index += 1) {
    interiorEdgePoints.push(
      readEdgePoint(view, interiorOffset + index * EDGE_POINT_BYTES),
    );
  }
  const endpointsOffset = interiorOffset + interiorBytes;
  const firstAndLastEdgePoints = [
    readEdgePoint(view, endpointsOffset),
    readEdgePoint(view, endpointsOffset + EDGE_POINT_BYTES),
  ] as const;
  const flagsOffset =
    endpointsOffset + ENDPOINT_COUNT * EDGE_POINT_BYTES;

  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: flagsOffset + 1,
      gInfo: {
        gStyleElementId: view.getBigInt64(byteOffset, true),
        tag: view.getInt32(byteOffset + 8, true),
        controlCommand: view.getInt32(byteOffset + 12, true),
        flags: view.getUint32(byteOffset + 16, true),
      },
      faceReferences: readInt32Pair(
        view,
        byteOffset + GINFO_BYTES,
      ),
      nextReferences: readInt32Pair(
        view,
        byteOffset + GINFO_BYTES + REFERENCE_ARRAY_BYTES,
      ),
      previousReferences: readInt32Pair(
        view,
        byteOffset + GINFO_BYTES + 2 * REFERENCE_ARRAY_BYTES,
      ),
      interiorEdgePoints,
      firstAndLastEdgePoints,
      flags: data[flagsOffset]!,
      queuedPropertyCount: 0,
    },
  };
}
