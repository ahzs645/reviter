import type { Revit2027GInfo } from "./revit-2027-grep-prefixes.ts";

/** Exact Revit 2027 source slot for `GCylindricalHelix`. */
export const REVIT_2027_GCYLINDRICAL_HELIX_SOURCE_CLASS_SLOT = 2244;
export const REVIT_2027_GCYLINDRICAL_HELIX_BODY_BYTES = 148;

const GINFO_BYTES = 20;
const DOUBLE_BYTES = 8;
const POINT_3D_BYTES = 24;
const END_PARAMETERS_OFFSET = GINFO_BYTES;
const RADIUS_OFFSET = END_PARAMETERS_OFFSET + DOUBLE_BYTES * 2;
const PITCH_OFFSET = RADIUS_OFFSET + DOUBLE_BYTES;
const BASE_POINT_OFFSET = PITCH_OFFSET + DOUBLE_BYTES;
const X_VECTOR_OFFSET = BASE_POINT_OFFSET + POINT_3D_BYTES;
const Y_VECTOR_OFFSET = X_VECTOR_OFFSET + POINT_3D_BYTES;
const Z_VECTOR_OFFSET = Y_VECTOR_OFFSET + POINT_3D_BYTES;

export type RevitPoint3d = readonly [number, number, number];

export type Revit2027GCylindricalHelix = {
  byteOffset: number;
  endOffset: number;
  gInfo: Revit2027GInfo;
  /** Inherited `GCurve.m_endParams`. */
  endParameters: readonly [number, number];
  radius: number;
  /** Native `m_pitchOver2PI`: axial distance per radian. */
  pitchOver2Pi: number;
  basePoint: RevitPoint3d;
  xVector: RevitPoint3d;
  yVector: RevitPoint3d;
  zVector: RevitPoint3d;
};

export type Revit2027GCylindricalHelixDecodeResult =
  | { ok: true; value: Revit2027GCylindricalHelix }
  | { ok: false; error: string };

function point3d(view: DataView, byteOffset: number): RevitPoint3d {
  return [
    view.getFloat64(byteOffset, true),
    view.getFloat64(byteOffset + DOUBLE_BYTES, true),
    view.getFloat64(byteOffset + DOUBLE_BYTES * 2, true),
  ];
}

function dot(a: RevitPoint3d, b: RevitPoint3d): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function finite(values: readonly number[]): boolean {
  return values.every(Number.isFinite);
}

/**
 * Decode the schema-complete Revit 2027 cylindrical helix.
 *
 * `Formats/Latest` gives the exact base-to-derived field order:
 * `GInfo`, `GCurve.m_endParams`, `m_radius`, `m_pitchOver2PI`, `m_basePnt`,
 * `m_xVec`, `m_yVec`, `m_zVec`. The resulting 148-byte body is identical for
 * every helix prefix in the UNBC spiral-flight/stringer population.
 */
export function decodeRevit2027GCylindricalHelix(
  data: Uint8Array,
  byteOffset: number,
  bodyEndOffset: number,
  revitVersion: number,
): Revit2027GCylindricalHelixDecodeResult {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "Revit 2027 GCylindricalHelix decoding requires release 2027",
    };
  }
  if (
    !Number.isSafeInteger(byteOffset) ||
    !Number.isSafeInteger(bodyEndOffset) ||
    byteOffset < 0 ||
    bodyEndOffset > data.byteLength ||
    bodyEndOffset - byteOffset !== REVIT_2027_GCYLINDRICAL_HELIX_BODY_BYTES
  ) {
    return {
      ok: false,
      error: "Revit 2027 GCylindricalHelix body is not exactly 148 bytes",
    };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const endParameters = [
    view.getFloat64(byteOffset + END_PARAMETERS_OFFSET, true),
    view.getFloat64(byteOffset + END_PARAMETERS_OFFSET + DOUBLE_BYTES, true),
  ] as const;
  const radius = view.getFloat64(byteOffset + RADIUS_OFFSET, true);
  const pitchOver2Pi = view.getFloat64(byteOffset + PITCH_OFFSET, true);
  const basePoint = point3d(view, byteOffset + BASE_POINT_OFFSET);
  const xVector = point3d(view, byteOffset + X_VECTOR_OFFSET);
  const yVector = point3d(view, byteOffset + Y_VECTOR_OFFSET);
  const zVector = point3d(view, byteOffset + Z_VECTOR_OFFSET);
  if (
    !finite([
      ...endParameters,
      radius,
      pitchOver2Pi,
      ...basePoint,
      ...xVector,
      ...yVector,
      ...zVector,
    ])
  ) {
    return {
      ok: false,
      error: "Revit 2027 GCylindricalHelix contains a non-finite scalar",
    };
  }
  if (radius < 0) {
    return {
      ok: false,
      error: "Revit 2027 GCylindricalHelix radius is negative",
    };
  }
  const tolerance = 1e-6;
  for (const vector of [xVector, yVector, zVector]) {
    if (Math.abs(dot(vector, vector) - 1) > tolerance) {
      return {
        ok: false,
        error: "Revit 2027 GCylindricalHelix basis is not unit length",
      };
    }
  }
  if (
    Math.abs(dot(xVector, yVector)) > tolerance ||
    Math.abs(dot(xVector, zVector)) > tolerance ||
    Math.abs(dot(yVector, zVector)) > tolerance
  ) {
    return {
      ok: false,
      error: "Revit 2027 GCylindricalHelix basis is not orthogonal",
    };
  }

  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: bodyEndOffset,
      gInfo: {
        gStyleElementId: view.getBigInt64(byteOffset, true),
        tag: view.getInt32(byteOffset + 8, true),
        controlCommand: view.getInt32(byteOffset + 12, true),
        flags: view.getUint32(byteOffset + 16, true),
      },
      endParameters,
      radius,
      pitchOver2Pi,
      basePoint,
      xVector,
      yVector,
      zVector,
    },
  };
}
