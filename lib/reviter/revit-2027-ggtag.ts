import type { CondInt16QueueEntry } from "./dynamic-geometry-queue.ts";
import {
  decodeRevit2027GGroupStatic,
  type Revit2027GGroupStatic,
} from "./revit-2027-ggroup-fifo.ts";

/** Exact Revit 2027 source slot for persisted `GGTag`. */
export const REVIT_2027_GGTAG_SOURCE_CLASS_SLOT = 2256;

const MODEL_TEST_POINT_BYTES = 24;
const BOOLEAN_BYTES = 1;

export type Revit2027GGTag = {
  byteOffset: number;
  endOffset: number;
  group: Revit2027GGroupStatic;
  modelTestPoint: readonly [number, number, number];
  useModelTestPoint: boolean;
  selectByModelTestPoint: boolean;
  /** `GGTag` adds no properties after its inherited `GGroup` children. */
  queuedProperties: readonly CondInt16QueueEntry[];
};

export type Revit2027GGTagDecodeResult =
  | { ok: true; value: Revit2027GGTag }
  | { ok: false; error: string };

/**
 * Decode one schema-complete Revit 2027 `GGTag` body.
 *
 * `Formats/Latest` identifies `GGTag` as a `GGroup` derivative and declares,
 * in persisted order, a float64 model-test-point triple followed by the
 * `m_bUseModelTestPoint` and `m_selectByModelTestPoint` booleans.
 */
export function decodeRevit2027GGTag(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
  revitVersion: number,
): Revit2027GGTagDecodeResult {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "Revit 2027 GGTag decoding requires release 2027",
    };
  }

  const group = decodeRevit2027GGroupStatic(
    data,
    byteOffset,
    enclosingEndOffset,
    revitVersion,
  );
  if (!group.ok) return group;

  const derivedBytes = MODEL_TEST_POINT_BYTES + BOOLEAN_BYTES * 2;
  const endOffset = group.value.endOffset + derivedBytes;
  if (
    !Number.isSafeInteger(endOffset) ||
    endOffset > enclosingEndOffset ||
    endOffset > data.byteLength
  ) {
    return {
      ok: false,
      error: "Revit 2027 GGTag derived fields are truncated",
    };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const modelTestPoint = [
    view.getFloat64(group.value.endOffset, true),
    view.getFloat64(group.value.endOffset + 8, true),
    view.getFloat64(group.value.endOffset + 16, true),
  ] as const;
  if (!modelTestPoint.every(Number.isFinite)) {
    return {
      ok: false,
      error: "Revit 2027 GGTag model test point contains a non-finite scalar",
    };
  }

  const useModelTestPointValue = data[group.value.endOffset + 24]!;
  const selectByModelTestPointValue = data[group.value.endOffset + 25]!;
  if (
    (useModelTestPointValue !== 0 && useModelTestPointValue !== 1) ||
    (selectByModelTestPointValue !== 0 &&
      selectByModelTestPointValue !== 1)
  ) {
    return {
      ok: false,
      error: "Revit 2027 GGTag contains a non-boolean selector flag",
    };
  }

  return {
    ok: true,
    value: {
      byteOffset,
      endOffset,
      group: group.value,
      modelTestPoint,
      useModelTestPoint: useModelTestPointValue === 1,
      selectByModelTestPoint: selectByModelTestPointValue === 1,
      queuedProperties: group.value.children,
    },
  };
}
