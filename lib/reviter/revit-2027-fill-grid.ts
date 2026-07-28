/** Exact Revit 2027 source-class slot reached from `FillPatternData.m_fillGrids`. */
export const REVIT_2027_FILL_GRID_SOURCE_CLASS_SLOT = 2085;

const DOUBLE_BYTES = 8;
const FIXED_DOUBLE_COUNT = 5;
const COUNT_BYTES = 4;
const FIXED_BODY_BYTES = FIXED_DOUBLE_COUNT * DOUBLE_BYTES + COUNT_BYTES;
const DEFAULT_MAX_SEGMENTS = 1_000_000;

export type Revit2027FillGrid = {
  byteOffset: number;
  endOffset: number;
  angle: number;
  /** `m_origin`, retained as persisted two-dimensional coordinates. */
  origin: readonly [number, number];
  /** `m_deltas`, retained in persisted fixed-array order. */
  deltas: readonly [number, number];
  /** `m_segs`, retained in persisted collection order. */
  segments: readonly number[];
};

export type Revit2027FillGridDecodeResult =
  | { ok: true; value: Revit2027FillGrid }
  | { ok: false; error: string };

function bounded(
  data: Uint8Array,
  byteOffset: number,
  byteLength: number,
  enclosingEndOffset: number,
): boolean {
  return (
    Number.isSafeInteger(byteOffset) &&
    byteOffset >= 0 &&
    Number.isSafeInteger(byteLength) &&
    byteLength >= 0 &&
    Number.isSafeInteger(enclosingEndOffset) &&
    enclosingEndOffset >= byteOffset &&
    enclosingEndOffset <= data.byteLength &&
    byteOffset <= enclosingEndOffset - byteLength
  );
}

/**
 * Decode the schema-complete Revit 2027 `FillGrid` body.
 *
 * The common native reader consumes one float64 angle, a two-float64 point,
 * a fixed two-float64 delta array, and an `OdArray<double>` encoded as a
 * signed int32 count followed by that many float64 segment values.
 */
export function decodeRevit2027FillGrid(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
  revitVersion: number,
  options: { maxSegments?: number } = {},
): Revit2027FillGridDecodeResult {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "Revit 2027 FillGrid decoding requires release 2027",
    };
  }
  const maxSegments = options.maxSegments ?? DEFAULT_MAX_SEGMENTS;
  if (!Number.isSafeInteger(maxSegments) || maxSegments < 0) {
    return {
      ok: false,
      error: "maxSegments must be a non-negative safe integer",
    };
  }
  if (!bounded(data, byteOffset, FIXED_BODY_BYTES, enclosingEndOffset)) {
    return {
      ok: false,
      error: "Revit 2027 FillGrid fixed body or segment count is truncated",
    };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const angle = view.getFloat64(byteOffset, true);
  const origin: [number, number] = [
    view.getFloat64(byteOffset + DOUBLE_BYTES, true),
    view.getFloat64(byteOffset + DOUBLE_BYTES * 2, true),
  ];
  const deltas: [number, number] = [
    view.getFloat64(byteOffset + DOUBLE_BYTES * 3, true),
    view.getFloat64(byteOffset + DOUBLE_BYTES * 4, true),
  ];
  if (![angle, ...origin, ...deltas].every(Number.isFinite)) {
    return {
      ok: false,
      error: "Revit 2027 FillGrid contains a non-finite fixed scalar",
    };
  }

  const countOffset = byteOffset + FIXED_DOUBLE_COUNT * DOUBLE_BYTES;
  const count = view.getInt32(countOffset, true);
  if (count < 0 || count > maxSegments) {
    return {
      ok: false,
      error: "Revit 2027 FillGrid segment count is outside the safety bound",
    };
  }
  const segmentOffset = countOffset + COUNT_BYTES;
  const availableSegments = Math.floor(
    (enclosingEndOffset - segmentOffset) / DOUBLE_BYTES,
  );
  if (count > availableSegments) {
    return {
      ok: false,
      error: "Revit 2027 FillGrid segment collection is truncated",
    };
  }

  const segments: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const value = view.getFloat64(
      segmentOffset + index * DOUBLE_BYTES,
      true,
    );
    if (!Number.isFinite(value)) {
      return {
        ok: false,
        error: `Revit 2027 FillGrid segment ${index} is non-finite`,
      };
    }
    segments.push(value);
  }

  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: segmentOffset + count * DOUBLE_BYTES,
      angle,
      origin,
      deltas,
      segments,
    },
  };
}
