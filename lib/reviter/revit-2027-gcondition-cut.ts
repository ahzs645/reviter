import {
  decodeRevit2027GConditionDir,
  REVIT_2027_GCONDITION_DIR_BODY_BYTES,
  type Revit2027GConditionDir,
} from "./revit-2027-gcondition-dir.ts";

/** Exact Revit 2027 source slot for `GConditionCut`. */
export const REVIT_2027_GCONDITION_CUT_SOURCE_CLASS_SLOT = 2234;
export const REVIT_2027_GCONDITION_CUT_BODY_BYTES =
  REVIT_2027_GCONDITION_DIR_BODY_BYTES + 16;

export type Revit2027GConditionCut = Revit2027GConditionDir & {
  rangeLow: number;
  rangeHigh: number;
};

export type Revit2027GConditionCutDecodeResult =
  | { ok: true; value: Revit2027GConditionCut }
  | { ok: false; error: string };

/**
 * Decode one exact Revit 2027 `GConditionCut` body.
 *
 * `GConditionCut` persists the complete `GConditionDir` base followed by the
 * two float64 schema fields `m_rangeLo` and `m_rangeHi`.
 */
export function decodeRevit2027GConditionCut(
  data: Uint8Array,
  byteOffset: number,
  bodyEndOffset: number,
  revitVersion: number,
): Revit2027GConditionCutDecodeResult {
  if (
    !Number.isSafeInteger(bodyEndOffset) ||
    bodyEndOffset - byteOffset !== REVIT_2027_GCONDITION_CUT_BODY_BYTES
  ) {
    return {
      ok: false,
      error: "Revit 2027 GConditionCut body is not exactly 45 bytes",
    };
  }
  const directionEndOffset =
    byteOffset + REVIT_2027_GCONDITION_DIR_BODY_BYTES;
  const direction = decodeRevit2027GConditionDir(
    data,
    byteOffset,
    directionEndOffset,
    revitVersion,
  );
  if (!direction.ok) return direction;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const rangeLow = view.getFloat64(directionEndOffset, true);
  const rangeHigh = view.getFloat64(directionEndOffset + 8, true);
  if (!Number.isFinite(rangeLow) || !Number.isFinite(rangeHigh)) {
    return {
      ok: false,
      error: "Revit 2027 GConditionCut contains a non-finite range",
    };
  }
  if (rangeLow > rangeHigh) {
    return {
      ok: false,
      error: "Revit 2027 GConditionCut range is reversed",
    };
  }
  return {
    ok: true,
    value: {
      ...direction.value,
      endOffset: bodyEndOffset,
      rangeLow,
      rangeHigh,
    },
  };
}
