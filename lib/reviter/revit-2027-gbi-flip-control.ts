import type { Revit2027GInfo } from "./revit-2027-grep-prefixes.ts";

/** Exact Revit 2027 source slot for `GBiFlipControl` (schema tag 2,220). */
export const REVIT_2027_GBI_FLIP_CONTROL_SOURCE_CLASS_SLOT = 2219;
export const REVIT_2027_GBI_FLIP_CONTROL_BODY_BYTES = 76;

const GINFO_BYTES = 20;
const ORIGIN_OFFSET = GINFO_BYTES;
const BASE_OFFSET = ORIGIN_OFFSET + 24;
const LENGTH_OFFSET = BASE_OFFSET + 24;

export type Revit2027GBiFlipControl = {
  byteOffset: number;
  endOffset: number;
  gInfo: Revit2027GInfo;
  origin: readonly [number, number, number];
  base: readonly [number, number, number];
  length: number;
};

export type Revit2027GBiFlipControlDecodeResult =
  | { ok: true; value: Revit2027GBiFlipControl }
  | { ok: false; error: string };

function finiteTuple(values: readonly number[]): boolean {
  return values.every(Number.isFinite);
}

/**
 * Decode one schema-complete Revit 2027 `GBiFlipControl` body.
 *
 * `Formats/Latest` defines the derived fields, in persisted order, as the
 * double triples `m_origin` and `m_base`, followed by the double
 * `m_length`. `GControl` adds no persisted field, while its `GNode` base
 * contributes the common 20-byte GInfo prefix.
 *
 * A flip control is a non-solid annotation/control node. Consuming it is
 * necessary to keep the native FIFO aligned, but it intentionally contributes
 * no triangles to the certified browser mesh.
 */
export function decodeRevit2027GBiFlipControl(
  data: Uint8Array,
  byteOffset: number,
  bodyEndOffset: number,
  revitVersion: number,
): Revit2027GBiFlipControlDecodeResult {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "Revit 2027 GBiFlipControl decoding requires release 2027",
    };
  }
  if (
    !Number.isSafeInteger(byteOffset) ||
    !Number.isSafeInteger(bodyEndOffset) ||
    byteOffset < 0 ||
    bodyEndOffset > data.byteLength ||
    bodyEndOffset - byteOffset !== REVIT_2027_GBI_FLIP_CONTROL_BODY_BYTES
  ) {
    return {
      ok: false,
      error: "Revit 2027 GBiFlipControl body is not exactly 76 bytes",
    };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const origin = [
    view.getFloat64(byteOffset + ORIGIN_OFFSET, true),
    view.getFloat64(byteOffset + ORIGIN_OFFSET + 8, true),
    view.getFloat64(byteOffset + ORIGIN_OFFSET + 16, true),
  ] as const;
  const base = [
    view.getFloat64(byteOffset + BASE_OFFSET, true),
    view.getFloat64(byteOffset + BASE_OFFSET + 8, true),
    view.getFloat64(byteOffset + BASE_OFFSET + 16, true),
  ] as const;
  const length = view.getFloat64(byteOffset + LENGTH_OFFSET, true);
  if (!finiteTuple(origin) || !finiteTuple(base) || !Number.isFinite(length)) {
    return {
      ok: false,
      error: "Revit 2027 GBiFlipControl contains a non-finite scalar",
    };
  }
  if (length < 0) {
    return {
      ok: false,
      error: "Revit 2027 GBiFlipControl length is negative",
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
      origin,
      base,
      length,
    },
  };
}
