/** Exact Revit 2027 source slot for `GConditionDir`. */
export const REVIT_2027_GCONDITION_DIR_SOURCE_CLASS_SLOT = 2235;
export const REVIT_2027_GCONDITION_DIR_BODY_BYTES = 29;

export type Revit2027GConditionDir = {
  byteOffset: number;
  endOffset: number;
  compareMode: number;
  direction: readonly [number, number, number];
  negateDirectionCondition: boolean;
};

export type Revit2027GConditionDirDecodeResult =
  | { ok: true; value: Revit2027GConditionDir }
  | { ok: false; error: string };

/**
 * Decode one exact Revit 2027 `GConditionDir` body.
 *
 * The inherited `GConditionBase` contributes its int32 comparison mode.
 * `Formats/Latest` then declares the double-triple `m_dir` and the one-byte
 * `m_negateDirCondition`. Conditions affect visibility only; they do not
 * contribute geometry to the browser mesh.
 */
export function decodeRevit2027GConditionDir(
  data: Uint8Array,
  byteOffset: number,
  bodyEndOffset: number,
  revitVersion: number,
): Revit2027GConditionDirDecodeResult {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "Revit 2027 GConditionDir decoding requires release 2027",
    };
  }
  if (
    !Number.isSafeInteger(byteOffset) ||
    !Number.isSafeInteger(bodyEndOffset) ||
    byteOffset < 0 ||
    bodyEndOffset > data.byteLength ||
    bodyEndOffset - byteOffset !== REVIT_2027_GCONDITION_DIR_BODY_BYTES
  ) {
    return {
      ok: false,
      error: "Revit 2027 GConditionDir body is not exactly 29 bytes",
    };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const direction = [
    view.getFloat64(byteOffset + 4, true),
    view.getFloat64(byteOffset + 12, true),
    view.getFloat64(byteOffset + 20, true),
  ] as const;
  if (
    !direction.every(Number.isFinite) ||
    Math.hypot(...direction) <= Number.EPSILON
  ) {
    return {
      ok: false,
      error: "Revit 2027 GConditionDir direction is non-finite or degenerate",
    };
  }
  const negate = data[byteOffset + 28]!;
  if (negate !== 0 && negate !== 1) {
    return {
      ok: false,
      error: "Revit 2027 GConditionDir negate flag is not boolean",
    };
  }
  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: bodyEndOffset,
      compareMode: view.getInt32(byteOffset, true),
      direction,
      negateDirectionCondition: negate === 1,
    },
  };
}
