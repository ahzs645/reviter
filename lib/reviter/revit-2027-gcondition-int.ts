/** Exact Revit 2027 source slot for persisted `GConditionInt`. */
export const REVIT_2027_GCONDITION_INT_SOURCE_CLASS_SLOT = 2238;
export const REVIT_2027_GCONDITION_INT_BODY_BYTES = 12;

export type Revit2027GConditionInt = {
  byteOffset: number;
  endOffset: number;
  compareMode: number;
  parameter: number;
  value: number;
};

export type Revit2027GConditionIntDecodeResult =
  | { ok: true; value: Revit2027GConditionInt }
  | { ok: false; error: string };

/**
 * Decode one schema-complete Revit 2027 `GConditionInt` body.
 *
 * The inherited GConditionBase contributes the int32 comparison mode; the
 * derived schema then persists `m_param` and `m_value`. Conditions control
 * visibility and do not emit geometry.
 */
export function decodeRevit2027GConditionInt(
  data: Uint8Array,
  byteOffset: number,
  bodyEndOffset: number,
  revitVersion: number,
): Revit2027GConditionIntDecodeResult {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "Revit 2027 GConditionInt decoding requires release 2027",
    };
  }
  if (
    !Number.isSafeInteger(byteOffset) ||
    !Number.isSafeInteger(bodyEndOffset) ||
    byteOffset < 0 ||
    bodyEndOffset > data.byteLength ||
    bodyEndOffset - byteOffset !== REVIT_2027_GCONDITION_INT_BODY_BYTES
  ) {
    return {
      ok: false,
      error: "Revit 2027 GConditionInt body is not exactly 12 bytes",
    };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: bodyEndOffset,
      compareMode: view.getInt32(byteOffset, true),
      parameter: view.getInt32(byteOffset + 4, true),
      value: view.getInt32(byteOffset + 8, true),
    },
  };
}
