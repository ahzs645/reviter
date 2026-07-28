/** Revit 2027 framed-object marker for persisted `BaseRailing`. */
export const REVIT_2027_BASE_RAILING_MARKER = 598;

const BASE_RAILING_SUFFIX_BYTES = 58;
const FRAME_ECHO_OFFSET = 16;
const FRAME_ECHO_BYTES = 20;

export type Revit2027BaseRailingModelTreeRelation = {
  childId: number;
  parentId: number;
  source: "BaseRailing.m_stairsId";
  evidence: "persisted-revit-2027-base-railing-suffix";
};

export type Revit2027BaseRailingStairsRelation = {
  railingId: number;
  stairsId: number | null;
  placementOffset: number;
  sketchId: number | null;
  stairsComponentId: number | null;
  stairsRailingAttributeId: number | null;
  registeredLocation: number;
  registeredLocationBackup: number;
  version: number;
  flipped: boolean;
  usesCurveLoopsFromSketch: boolean;
  objectOffset: number;
  objectLength: number;
  stairsIdOffset: number;
  endOffset: number;
  /** Ready for later `ConvertResult.modelTree` integration. */
  relation: Revit2027BaseRailingModelTreeRelation | null;
};

export type Revit2027BaseRailingStairsDecodeResult =
  | { ok: true; value: Revit2027BaseRailingStairsRelation }
  | { ok: false; error: string };

function fits(
  data: Uint8Array,
  byteOffset: number,
  byteLength: number,
): boolean {
  return (
    Number.isSafeInteger(byteOffset) &&
    byteOffset >= 0 &&
    Number.isSafeInteger(byteLength) &&
    byteLength >= 0 &&
    byteOffset <= data.byteLength - byteLength
  );
}

function nullableObjectId(
  view: DataView,
  byteOffset: number,
): number | null | undefined {
  const low = view.getUint32(byteOffset, true);
  const high = view.getUint32(byteOffset + 4, true);
  if (
    (low === 0 && high === 0) ||
    (low === 0xffff_ffff && high === 0xffff_ffff)
  ) {
    return null;
  }
  return high === 0 && low > 0 ? low : undefined;
}

/**
 * Decode the exact final 58-byte suffix of a Revit 2027 `BaseRailing`.
 *
 * `Formats/Latest` names the fields, in order, as:
 *
 * `m_stairsId, m_placementOffset, m_sketchId, m_stairsComponentId,
 * m_stairsRailingAttrId, m_registeredLocation,
 * m_registeredLocationBackup, m_version, m_flipped,
 * m_useCurveLoopsFromSketch`.
 *
 * The suffix terminates at the independently echoed object boundary, so this
 * reader never searches the body for an id-shaped byte sequence.
 */
export function decodeRevit2027BaseRailingStairsRelation(
  data: Uint8Array,
  objectOffset: number,
  objectLength: number,
  revitVersion: number,
  options: { knownStairsElementIds?: ReadonlySet<number> } = {},
): Revit2027BaseRailingStairsDecodeResult {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "BaseRailing stairs decoding requires Revit 2027",
    };
  }
  if (
    !Number.isSafeInteger(objectLength) ||
    objectLength < BASE_RAILING_SUFFIX_BYTES ||
    !fits(data, objectOffset, objectLength + FRAME_ECHO_BYTES)
  ) {
    return { ok: false, error: "BaseRailing framed object is truncated" };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(objectOffset + 12, true) !== objectLength) {
    return { ok: false, error: "BaseRailing object length does not match" };
  }
  if (
    view.getUint32(
      objectOffset + objectLength + FRAME_ECHO_OFFSET,
      true,
    ) !== objectLength
  ) {
    return { ok: false, error: "BaseRailing object length echo does not match" };
  }
  if (
    view.getUint16(objectOffset + 16, true) !==
    REVIT_2027_BASE_RAILING_MARKER
  ) {
    return { ok: false, error: "BaseRailing marker does not match" };
  }
  if (view.getUint32(objectOffset + 18, true) !== 0xffff_ffff) {
    return { ok: false, error: "BaseRailing type code does not match" };
  }
  const railingId = view.getUint32(objectOffset, true);
  if (
    railingId === 0 ||
    view.getUint32(objectOffset + 4, true) !== 0
  ) {
    return { ok: false, error: "BaseRailing element id is invalid" };
  }

  const stairsIdOffset =
    objectOffset + objectLength - BASE_RAILING_SUFFIX_BYTES;
  const stairsId = nullableObjectId(view, stairsIdOffset);
  const sketchId = nullableObjectId(view, stairsIdOffset + 16);
  const stairsComponentId = nullableObjectId(view, stairsIdOffset + 24);
  const stairsRailingAttributeId = nullableObjectId(
    view,
    stairsIdOffset + 32,
  );
  if (
    stairsId === undefined ||
    sketchId === undefined ||
    stairsComponentId === undefined ||
    stairsRailingAttributeId === undefined
  ) {
    return { ok: false, error: "BaseRailing suffix contains an invalid ObjectId" };
  }
  if (
    stairsId != null &&
    options.knownStairsElementIds &&
    !options.knownStairsElementIds.has(stairsId)
  ) {
    return {
      ok: false,
      error: "BaseRailing stairs id does not resolve to a StairsElement",
    };
  }
  const placementOffset = view.getFloat64(stairsIdOffset + 8, true);
  if (!Number.isFinite(placementOffset)) {
    return { ok: false, error: "BaseRailing placement offset is non-finite" };
  }
  const flipped = data[stairsIdOffset + 56]!;
  const usesCurveLoopsFromSketch = data[stairsIdOffset + 57]!;
  if (flipped > 1 || usesCurveLoopsFromSketch > 1) {
    return { ok: false, error: "BaseRailing suffix contains an invalid boolean" };
  }
  const version = view.getInt32(stairsIdOffset + 52, true);
  if (version < 0) {
    return { ok: false, error: "BaseRailing version is negative" };
  }

  return {
    ok: true,
    value: {
      railingId,
      stairsId,
      placementOffset,
      sketchId,
      stairsComponentId,
      stairsRailingAttributeId,
      registeredLocation: view.getInt32(stairsIdOffset + 40, true),
      registeredLocationBackup: view.getInt32(
        stairsIdOffset + 44,
        true,
      ),
      version,
      flipped: flipped === 1,
      usesCurveLoopsFromSketch: usesCurveLoopsFromSketch === 1,
      objectOffset,
      objectLength,
      stairsIdOffset,
      endOffset: objectOffset + objectLength,
      relation:
        stairsId == null
          ? null
          : {
              childId: railingId,
              parentId: stairsId,
              source: "BaseRailing.m_stairsId",
              evidence: "persisted-revit-2027-base-railing-suffix",
            },
    },
  };
}
