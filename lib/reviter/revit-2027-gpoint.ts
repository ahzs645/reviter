import type { Revit2027GInfo } from "./revit-2027-grep-prefixes.ts";

/** Exact Revit 2027 source slot for persisted `GPoint`. */
export const REVIT_2027_GPOINT_SOURCE_CLASS_SLOT = 2271;
export const REVIT_2027_GPOINT_BODY_BYTES = 56;

const GINFO_BYTES = 20;

export type Revit2027GPoint = {
  byteOffset: number;
  endOffset: number;
  gInfo: Revit2027GInfo;
  coordinate: readonly [number, number, number];
  size: number;
  borderSize: number;
  pointFlags: number;
};

export type Revit2027GPointDecodeResult =
  | { ok: true; value: Revit2027GPoint }
  | { ok: false; error: string };

/**
 * Decode one schema-complete Revit 2027 `GPoint` body.
 *
 * The embedded schema declares a GNode/GInfo base followed by the float64
 * coordinate triple and three int32 display fields. A point may participate
 * in a GFilter condition but contributes no solid triangles by itself.
 */
export function decodeRevit2027GPoint(
  data: Uint8Array,
  byteOffset: number,
  bodyEndOffset: number,
  revitVersion: number,
): Revit2027GPointDecodeResult {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "Revit 2027 GPoint decoding requires release 2027",
    };
  }
  if (
    !Number.isSafeInteger(byteOffset) ||
    !Number.isSafeInteger(bodyEndOffset) ||
    byteOffset < 0 ||
    bodyEndOffset > data.byteLength ||
    bodyEndOffset - byteOffset !== REVIT_2027_GPOINT_BODY_BYTES
  ) {
    return {
      ok: false,
      error: "Revit 2027 GPoint body is not exactly 56 bytes",
    };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const coordinate = [
    view.getFloat64(byteOffset + GINFO_BYTES, true),
    view.getFloat64(byteOffset + GINFO_BYTES + 8, true),
    view.getFloat64(byteOffset + GINFO_BYTES + 16, true),
  ] as const;
  if (!coordinate.every(Number.isFinite)) {
    return {
      ok: false,
      error: "Revit 2027 GPoint coordinate contains a non-finite scalar",
    };
  }
  const size = view.getInt32(byteOffset + 44, true);
  const borderSize = view.getInt32(byteOffset + 48, true);
  if (size < 0 || borderSize < 0) {
    return {
      ok: false,
      error: "Revit 2027 GPoint display size is negative",
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
      coordinate,
      size,
      borderSize,
      pointFlags: view.getInt32(byteOffset + 52, true),
    },
  };
}
