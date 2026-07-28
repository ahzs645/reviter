import {
  decodeCondInt16PropertyDescriptor,
  type CondInt16QueueEntry,
} from "./dynamic-geometry-queue.ts";

/** Exact Revit 2027 source-class slot reached from `GFilling.m_data`. */
export const REVIT_2027_FILL_PATTERN_DATA_SOURCE_CLASS_SLOT = 2087;

const DOUBLE_BYTES = 8;
const SCALAR_BYTES = DOUBLE_BYTES * 4;
const COUNT_BYTES = 4;
const DEFAULT_MAX_FILL_GRIDS = 1_000_000;

export type Revit2027FillPatternData = {
  byteOffset: number;
  endOffset: number;
  windowSize: number;
  lengthPerArea: number;
  strokesPerArea: number;
  linesPerLength: number;
  /** `m_fillGrids`, retained in persisted collection order. */
  fillGrids: readonly CondInt16QueueEntry[];
  /** Non-null children appended by the collection reader in the same order. */
  queuedProperties: readonly CondInt16QueueEntry[];
};

export type Revit2027FillPatternDataDecodeResult =
  | { ok: true; value: Revit2027FillPatternData }
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
 * Decode the schema-complete Revit 2027 `FillPatternData` body.
 *
 * The common native reader consumes four float64 statistics followed by an
 * `OdArray<OdBmCondInt16>`. The collection is encoded as a signed int32 count
 * and that many conditional descriptors. No GNode/GInfo base is present.
 */
export function decodeRevit2027FillPatternData(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
  revitVersion: number,
  options: { maxFillGrids?: number } = {},
): Revit2027FillPatternDataDecodeResult {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "Revit 2027 FillPatternData decoding requires release 2027",
    };
  }
  const maxFillGrids =
    options.maxFillGrids ?? DEFAULT_MAX_FILL_GRIDS;
  if (!Number.isSafeInteger(maxFillGrids) || maxFillGrids < 0) {
    return {
      ok: false,
      error: "maxFillGrids must be a non-negative safe integer",
    };
  }
  if (
    !bounded(
      data,
      byteOffset,
      SCALAR_BYTES + COUNT_BYTES,
      enclosingEndOffset,
    )
  ) {
    return {
      ok: false,
      error: "Revit 2027 FillPatternData scalars or grid count are truncated",
    };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const windowSize = view.getFloat64(byteOffset, true);
  const lengthPerArea = view.getFloat64(byteOffset + DOUBLE_BYTES, true);
  const strokesPerArea = view.getFloat64(byteOffset + DOUBLE_BYTES * 2, true);
  const linesPerLength = view.getFloat64(byteOffset + DOUBLE_BYTES * 3, true);
  if (
    ![
      windowSize,
      lengthPerArea,
      strokesPerArea,
      linesPerLength,
    ].every(Number.isFinite)
  ) {
    return {
      ok: false,
      error: "Revit 2027 FillPatternData contains a non-finite scalar",
    };
  }

  const countOffset = byteOffset + SCALAR_BYTES;
  const count = view.getInt32(countOffset, true);
  if (count < 0 || count > maxFillGrids) {
    return {
      ok: false,
      error: "Revit 2027 FillPatternData grid count is outside the safety bound",
    };
  }

  const boundedData =
    enclosingEndOffset === data.byteLength
      ? data
      : data.subarray(0, enclosingEndOffset);
  const fillGrids: CondInt16QueueEntry[] = [];
  let cursor = countOffset + COUNT_BYTES;
  for (let index = 0; index < count; index += 1) {
    const decoded = decodeCondInt16PropertyDescriptor(boundedData, cursor);
    if (!decoded.ok) {
      return {
        ok: false,
        error: `FillPatternData grid ${index}: ${decoded.error}`,
      };
    }
    fillGrids.push(decoded.descriptor);
    cursor = decoded.descriptor.endOffset;
  }

  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: cursor,
      windowSize,
      lengthPerArea,
      strokesPerArea,
      linesPerLength,
      fillGrids,
      queuedProperties: fillGrids.filter(
        ({ token, sourceClassSlot }) =>
          token !== 0 && sourceClassSlot != null,
      ),
    },
  };
}
