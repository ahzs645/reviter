import type { RevitExtents3d } from "./revit-2026-grep-root.ts";
import type { Revit2027GInfo } from "./revit-2027-grep-prefixes.ts";

/** Resolved from the Revit 2027 source schema for the supplied UNBC model. */
export const REVIT_2027_GPOLYLINE_SOURCE_CLASS_SLOT = 2276;

const GINFO_BYTES = 20;
const POINT_COUNT_BYTES = 4;
const POINT3D_BYTES = 24;
const EXTENTS_BYTES = 48;
const FILLED_BYTES = 1;
const FIXED_BODY_BYTES =
  GINFO_BYTES + POINT_COUNT_BYTES + EXTENTS_BYTES + FILLED_BYTES;
const DEFAULT_MAX_POINTS = 1_000_000;

export type RevitPoint3d = readonly [number, number, number];

export type Revit2027GPolyLine = {
  byteOffset: number;
  endOffset: number;
  gInfo: Revit2027GInfo;
  coordinates: readonly RevitPoint3d[];
  extents: RevitExtents3d;
  extentsMatchCoordinates: boolean;
  closed: boolean;
  filled: boolean;
};

export type Revit2027GPolyLineDecodeResult =
  | { ok: true; value: Revit2027GPolyLine }
  | { ok: false; error: string };

function bounded(
  data: Uint8Array,
  byteOffset: number,
  byteLength: number,
  enclosingEndOffset: number,
): boolean {
  return (
    Number.isSafeInteger(byteOffset) &&
    Number.isSafeInteger(byteLength) &&
    Number.isSafeInteger(enclosingEndOffset) &&
    byteOffset >= 0 &&
    byteLength >= 0 &&
    enclosingEndOffset >= byteOffset &&
    enclosingEndOffset <= data.byteLength &&
    byteOffset <= enclosingEndOffset - byteLength
  );
}

function samePoint(left: RevitPoint3d, right: RevitPoint3d): boolean {
  return (
    left[0] === right[0] &&
    left[1] === right[1] &&
    left[2] === right[2]
  );
}

/**
 * Decode one count-bounded Revit 2027 `GPolyLine` FIFO body.
 *
 * The release schema identifies source slot 2276 as `GPolyLine`. Its measured
 * native reader order is `GInfo -> Point3d collection -> extents -> filled`.
 * Unlike a length-framed object, this reader returns the count-derived body
 * end so a caller can advance to the next queued body without assigning the
 * rest of the enclosing GRep payload to the polyline.
 */
export function decodeRevit2027GPolyLine(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
  revitVersion: number,
  options: { maxPoints?: number } = {},
): Revit2027GPolyLineDecodeResult {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "Revit 2027 GPolyLine decoding requires release 2027",
    };
  }
  if (!bounded(data, byteOffset, GINFO_BYTES + POINT_COUNT_BYTES, enclosingEndOffset)) {
    return { ok: false, error: "Revit 2027 GPolyLine prefix is truncated" };
  }

  const maxPoints = options.maxPoints ?? DEFAULT_MAX_POINTS;
  if (!Number.isSafeInteger(maxPoints) || maxPoints < 0) {
    return { ok: false, error: "Revit 2027 GPolyLine point limit is invalid" };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const pointCount = view.getInt32(byteOffset + GINFO_BYTES, true);
  if (pointCount < 0 || pointCount > maxPoints) {
    return {
      ok: false,
      error: "Revit 2027 GPolyLine point count is outside the allowed range",
    };
  }

  const bodyBytes = FIXED_BODY_BYTES + pointCount * POINT3D_BYTES;
  if (
    !Number.isSafeInteger(bodyBytes) ||
    !bounded(data, byteOffset, bodyBytes, enclosingEndOffset)
  ) {
    return { ok: false, error: "Revit 2027 GPolyLine body is truncated" };
  }

  const coordinates: RevitPoint3d[] = [];
  const coordinateMinimum = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const coordinateMaximum = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  let offset = byteOffset + GINFO_BYTES + POINT_COUNT_BYTES;
  for (let index = 0; index < pointCount; index += 1) {
    const point = [
      view.getFloat64(offset, true),
      view.getFloat64(offset + 8, true),
      view.getFloat64(offset + 16, true),
    ] as const;
    if (!point.every(Number.isFinite)) {
      return {
        ok: false,
        error: "Revit 2027 GPolyLine contains a non-finite coordinate",
      };
    }
    for (let axis = 0; axis < 3; axis += 1) {
      coordinateMinimum[axis] = Math.min(coordinateMinimum[axis]!, point[axis]);
      coordinateMaximum[axis] = Math.max(coordinateMaximum[axis]!, point[axis]);
    }
    coordinates.push(point);
    offset += POINT3D_BYTES;
  }

  const minimum = [
    view.getFloat64(offset, true),
    view.getFloat64(offset + 8, true),
    view.getFloat64(offset + 16, true),
  ] as const;
  const maximum = [
    view.getFloat64(offset + 24, true),
    view.getFloat64(offset + 32, true),
    view.getFloat64(offset + 40, true),
  ] as const;
  const extentsValid =
    minimum.every(Number.isFinite) &&
    maximum.every(Number.isFinite) &&
    minimum.every((value, axis) => value <= maximum[axis]);
  if (!extentsValid) {
    return { ok: false, error: "Revit 2027 GPolyLine extents are invalid" };
  }
  if (
    coordinates.some((point) =>
      point.some(
        (value, axis) => value < minimum[axis] || value > maximum[axis],
      ),
    )
  ) {
    return {
      ok: false,
      error: "Revit 2027 GPolyLine extents do not contain its coordinates",
    };
  }
  const extents: RevitExtents3d = { minimum, maximum, valid: true };
  const extentsMatchCoordinates =
    pointCount > 0 &&
    minimum.every((value, axis) => value === coordinateMinimum[axis]) &&
    maximum.every((value, axis) => value === coordinateMaximum[axis]);
  offset += EXTENTS_BYTES;

  const filledByte = data[offset];
  if (filledByte !== 0 && filledByte !== 1) {
    return { ok: false, error: "Revit 2027 GPolyLine filled flag is invalid" };
  }
  offset += FILLED_BYTES;

  const first = coordinates[0];
  const last = coordinates.at(-1);
  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: offset,
      gInfo: {
        gStyleElementId: view.getBigInt64(byteOffset, true),
        tag: view.getInt32(byteOffset + 8, true),
        controlCommand: view.getInt32(byteOffset + 12, true),
        flags: view.getUint32(byteOffset + 16, true),
      },
      coordinates,
      extents,
      extentsMatchCoordinates,
      closed: first != null && last != null && samePoint(first, last),
      filled: filledByte === 1,
    },
  };
}
