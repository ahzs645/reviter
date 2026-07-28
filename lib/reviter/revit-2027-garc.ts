import type { Revit2027GInfo } from "./revit-2027-grep-prefixes.ts";

/** Exact Revit 2027 source-class slot for `GArc`. */
export const REVIT_2027_GARC_SOURCE_CLASS_SLOT = 2213;
export const REVIT_2027_GARC_BODY_BYTES = 117;

const GINFO_BYTES = 20;
const END_PARAMETERS_OFFSET = GINFO_BYTES;
const X_DIRECTION_OFFSET = END_PARAMETERS_OFFSET + 16;
const Y_DIRECTION_OFFSET = X_DIRECTION_OFFSET + 24;
const RADIUS_OFFSET = Y_DIRECTION_OFFSET + 24;
const CENTER_OFFSET = RADIUS_OFFSET + 8;
const FILLED_OFFSET = CENTER_OFFSET + 24;

export type Revit2027GArc = {
  byteOffset: number;
  endOffset: number;
  gInfo: Revit2027GInfo;
  /** Inherited `GCurve.m_endParams`. */
  endParameters: readonly [number, number];
  /** `m_xVec`. */
  xDirection: readonly [number, number, number];
  /** `m_yVec`. */
  yDirection: readonly [number, number, number];
  radius: number;
  center: readonly [number, number, number];
  isFilled: boolean;
};

export type Revit2027GArcDecodeResult =
  | { ok: true; value: Revit2027GArc }
  | { ok: false; error: string };

function bounded(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
): boolean {
  return (
    Number.isSafeInteger(byteOffset) &&
    byteOffset >= 0 &&
    Number.isSafeInteger(enclosingEndOffset) &&
    enclosingEndOffset >= byteOffset &&
    enclosingEndOffset <= data.byteLength &&
    byteOffset <= enclosingEndOffset - REVIT_2027_GARC_BODY_BYTES
  );
}

function finiteTuple(values: readonly number[]): boolean {
  return values.every(Number.isFinite);
}

/**
 * Decode the schema-complete Revit 2027 `GArc` body.
 *
 * The body is the 20-byte `GInfo` prefix, inherited two-double
 * `GCurve.m_endParams`, two Vector3d values, radius, Point3d center, and one
 * strict persisted boolean. It queues no further properties.
 */
export function decodeRevit2027GArc(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
  revitVersion: number,
): Revit2027GArcDecodeResult {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "Revit 2027 GArc decoding requires release 2027",
    };
  }
  if (!bounded(data, byteOffset, enclosingEndOffset)) {
    return {
      ok: false,
      error: "Revit 2027 GArc body is truncated or outside its owner",
    };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const endParameters = [
    view.getFloat64(byteOffset + END_PARAMETERS_OFFSET, true),
    view.getFloat64(byteOffset + END_PARAMETERS_OFFSET + 8, true),
  ] as const;
  const xDirection = [
    view.getFloat64(byteOffset + X_DIRECTION_OFFSET, true),
    view.getFloat64(byteOffset + X_DIRECTION_OFFSET + 8, true),
    view.getFloat64(byteOffset + X_DIRECTION_OFFSET + 16, true),
  ] as const;
  const yDirection = [
    view.getFloat64(byteOffset + Y_DIRECTION_OFFSET, true),
    view.getFloat64(byteOffset + Y_DIRECTION_OFFSET + 8, true),
    view.getFloat64(byteOffset + Y_DIRECTION_OFFSET + 16, true),
  ] as const;
  const radius = view.getFloat64(byteOffset + RADIUS_OFFSET, true);
  const center = [
    view.getFloat64(byteOffset + CENTER_OFFSET, true),
    view.getFloat64(byteOffset + CENTER_OFFSET + 8, true),
    view.getFloat64(byteOffset + CENTER_OFFSET + 16, true),
  ] as const;
  if (
    !finiteTuple(endParameters) ||
    !finiteTuple(xDirection) ||
    !finiteTuple(yDirection) ||
    !Number.isFinite(radius) ||
    !finiteTuple(center)
  ) {
    return {
      ok: false,
      error: "Revit 2027 GArc contains a non-finite scalar",
    };
  }
  if (
    Math.hypot(...xDirection) <= Number.EPSILON ||
    Math.hypot(...yDirection) <= Number.EPSILON
  ) {
    return {
      ok: false,
      error: "Revit 2027 GArc contains a degenerate basis vector",
    };
  }
  if (radius < 0) {
    return {
      ok: false,
      error: "Revit 2027 GArc radius is negative",
    };
  }
  const filled = data[byteOffset + FILLED_OFFSET]!;
  if (filled !== 0 && filled !== 1) {
    return {
      ok: false,
      error: "Revit 2027 GArc filled flag is not a strict boolean",
    };
  }

  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: byteOffset + REVIT_2027_GARC_BODY_BYTES,
      gInfo: {
        gStyleElementId: view.getBigInt64(byteOffset, true),
        tag: view.getInt32(byteOffset + 8, true),
        controlCommand: view.getInt32(byteOffset + 12, true),
        flags: view.getUint32(byteOffset + 16, true),
      },
      endParameters,
      xDirection,
      yDirection,
      radius,
      center,
      isFilled: filled === 1,
    },
  };
}
