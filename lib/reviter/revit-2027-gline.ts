import type { Revit2027GInfo } from "./revit-2027-grep-prefixes.ts";

/** Exact Revit 2027 schema tag/source slot for `GLine`. */
export const REVIT_2027_GLINE_SOURCE_CLASS_SLOT = 1973;
export const REVIT_2027_GLINE_BODY_BYTES = 84;

const GINFO_BYTES = 20;
const END_PARAMETERS_OFFSET = GINFO_BYTES;
const ORIGIN_OFFSET = END_PARAMETERS_OFFSET + 16;
const DIRECTION_OFFSET = ORIGIN_OFFSET + 24;

export type Revit2027GLine = {
  byteOffset: number;
  endOffset: number;
  gInfo: Revit2027GInfo;
  endParameters: readonly [number, number];
  origin: readonly [number, number, number];
  direction: readonly [number, number, number];
};

export type Revit2027GLineDecodeResult =
  | { ok: true; value: Revit2027GLine }
  | { ok: false; error: string };

function finiteTuple(values: readonly number[]): boolean {
  return values.every(Number.isFinite);
}

/**
 * Decode the schema-complete Revit 2027 `GLine` body.
 *
 * `Formats/Latest` defines the inherited `GCurve.m_endParams` double pair,
 * followed by `GLine.m_origin` and `GLine.m_dirVec` double triples. The
 * inherited GNode contributes the 20-byte GInfo prefix. The resulting 84-byte
 * body is also measured exactly in all 1,700 single-child UNBC frames.
 */
export function decodeRevit2027GLine(
  data: Uint8Array,
  byteOffset: number,
  bodyEndOffset: number,
  revitVersion: number,
): Revit2027GLineDecodeResult {
  if (revitVersion !== 2027) {
    return { ok: false, error: "Revit 2027 GLine decoding requires release 2027" };
  }
  if (
    !Number.isSafeInteger(byteOffset) ||
    !Number.isSafeInteger(bodyEndOffset) ||
    byteOffset < 0 ||
    bodyEndOffset > data.byteLength ||
    bodyEndOffset - byteOffset !== REVIT_2027_GLINE_BODY_BYTES
  ) {
    return { ok: false, error: "Revit 2027 GLine body is not exactly 84 bytes" };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const endParameters = [
    view.getFloat64(byteOffset + END_PARAMETERS_OFFSET, true),
    view.getFloat64(byteOffset + END_PARAMETERS_OFFSET + 8, true),
  ] as const;
  const origin = [
    view.getFloat64(byteOffset + ORIGIN_OFFSET, true),
    view.getFloat64(byteOffset + ORIGIN_OFFSET + 8, true),
    view.getFloat64(byteOffset + ORIGIN_OFFSET + 16, true),
  ] as const;
  const direction = [
    view.getFloat64(byteOffset + DIRECTION_OFFSET, true),
    view.getFloat64(byteOffset + DIRECTION_OFFSET + 8, true),
    view.getFloat64(byteOffset + DIRECTION_OFFSET + 16, true),
  ] as const;
  if (
    !finiteTuple(endParameters) ||
    !finiteTuple(origin) ||
    !finiteTuple(direction)
  ) {
    return { ok: false, error: "Revit 2027 GLine contains a non-finite scalar" };
  }
  if (Math.hypot(...direction) <= Number.EPSILON) {
    return { ok: false, error: "Revit 2027 GLine direction is degenerate" };
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
      origin,
      direction,
    },
  };
}
