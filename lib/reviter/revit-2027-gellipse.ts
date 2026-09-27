import type { Revit2027GInfo } from "./revit-2027-grep-prefixes.ts";
import { usesRevit2027RecordLayout } from "./revit-class-tags.ts";

/** Exact Revit 2027 source-class slot for `GEllipse`. */
export const REVIT_2027_GELLIPSE_SOURCE_CLASS_SLOT = 2249;
export const REVIT_2027_GELLIPSE_BODY_BYTES = 124;

const GINFO_BYTES = 20;
const END_PARAMETERS_OFFSET = GINFO_BYTES;
const CENTER_OFFSET = END_PARAMETERS_OFFSET + 16;
const X_DIRECTION_OFFSET = CENTER_OFFSET + 24;
const Y_DIRECTION_OFFSET = X_DIRECTION_OFFSET + 24;
const X_RADIUS_OFFSET = Y_DIRECTION_OFFSET + 24;
const Y_RADIUS_OFFSET = X_RADIUS_OFFSET + 8;

export type Revit2027GEllipse = {
  byteOffset: number;
  endOffset: number;
  gInfo: Revit2027GInfo;
  /** Inherited `GCurve.m_endParams`. */
  endParameters: readonly [number, number];
  center: readonly [number, number, number];
  /** `m_xVec`. */
  xDirection: readonly [number, number, number];
  /** `m_yVec`. */
  yDirection: readonly [number, number, number];
  /** `m_xLen`: the radius along `xDirection`. */
  xRadius: number;
  /** `m_yLen`: the radius along `yDirection`. */
  yRadius: number;
};

export type Revit2027GEllipseDecodeResult =
  | { ok: true; value: Revit2027GEllipse }
  | { ok: false; error: string };

function vector(view: DataView, byteOffset: number): readonly [number, number, number] {
  return [
    view.getFloat64(byteOffset, true),
    view.getFloat64(byteOffset + 8, true),
    view.getFloat64(byteOffset + 16, true),
  ] as const;
}

/**
 * Decode the schema-complete Revit 2027 `GEllipse` body.
 *
 * The body is the 20-byte `GInfo` prefix, the inherited two-double
 * `GCurve.m_endParams`, then `m_center`, `m_xVec` and `m_yVec` as three
 * doubles each and the two radii `m_xLen` and `m_yLen`. Unlike `GArc` there
 * is no filled flag. It queues no further properties. In the 2025 RAC sample
 * every body is followed by the next queued property exactly 124 bytes on.
 */
export function decodeRevit2027GEllipse(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
  revitVersion: number,
): Revit2027GEllipseDecodeResult {
  if (!usesRevit2027RecordLayout(revitVersion)) {
    return { ok: false, error: "Revit 2027 GEllipse decoding requires release 2027" };
  }
  if (
    !Number.isSafeInteger(byteOffset) ||
    byteOffset < 0 ||
    !Number.isSafeInteger(enclosingEndOffset) ||
    enclosingEndOffset > data.byteLength ||
    byteOffset > enclosingEndOffset - REVIT_2027_GELLIPSE_BODY_BYTES
  ) {
    return { ok: false, error: "Revit 2027 GEllipse body is truncated or outside its owner" };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const endParameters = [
    view.getFloat64(byteOffset + END_PARAMETERS_OFFSET, true),
    view.getFloat64(byteOffset + END_PARAMETERS_OFFSET + 8, true),
  ] as const;
  const center = vector(view, byteOffset + CENTER_OFFSET);
  const xDirection = vector(view, byteOffset + X_DIRECTION_OFFSET);
  const yDirection = vector(view, byteOffset + Y_DIRECTION_OFFSET);
  const xRadius = view.getFloat64(byteOffset + X_RADIUS_OFFSET, true);
  const yRadius = view.getFloat64(byteOffset + Y_RADIUS_OFFSET, true);
  if (
    ![...endParameters, ...center, ...xDirection, ...yDirection, xRadius, yRadius]
      .every(Number.isFinite)
  ) {
    return { ok: false, error: "Revit 2027 GEllipse contains a non-finite scalar" };
  }
  if (
    Math.hypot(...xDirection) <= Number.EPSILON ||
    Math.hypot(...yDirection) <= Number.EPSILON
  ) {
    return { ok: false, error: "Revit 2027 GEllipse contains a degenerate basis vector" };
  }
  if (xRadius < 0 || yRadius < 0) {
    return { ok: false, error: "Revit 2027 GEllipse radius is negative" };
  }

  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: byteOffset + REVIT_2027_GELLIPSE_BODY_BYTES,
      gInfo: {
        gStyleElementId: view.getBigInt64(byteOffset, true),
        tag: view.getInt32(byteOffset + 8, true),
        controlCommand: view.getInt32(byteOffset + 12, true),
        flags: view.getUint32(byteOffset + 16, true),
      },
      endParameters,
      center,
      xDirection,
      yDirection,
      xRadius,
      yRadius,
    },
  };
}
