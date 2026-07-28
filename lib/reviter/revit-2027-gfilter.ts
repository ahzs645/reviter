import {
  decodeCondInt16QueueCollection,
  type CondInt16QueueEntry,
} from "./dynamic-geometry-queue.ts";
import {
  decodeRevit2027GGroupStatic,
  type Revit2027GGroupStatic,
} from "./revit-2027-ggroup-fifo.ts";

/** Exact Revit 2027 source slot for `GFilter`. */
export const REVIT_2027_GFILTER_SOURCE_CLASS_SLOT = 2254;

export type Revit2027GFilter = {
  byteOffset: number;
  endOffset: number;
  group: Revit2027GGroupStatic;
  conditions: readonly CondInt16QueueEntry[];
  isNestedDetailFamily: boolean;
  /** Native insertion order: inherited subnodes, then derived conditions. */
  queuedProperties: readonly CondInt16QueueEntry[];
};

export type Revit2027GFilterDecodeResult =
  | { ok: true; value: Revit2027GFilter }
  | { ok: false; error: string };

/**
 * Decode the complete selector-free Revit 2027 `GFilter` static body.
 *
 * The embedded schema identifies `GFilter` as a `GGroup` derivative. After
 * the inherited GInfo and `m_subNodes` CondInt16 collection it persists
 * `m_oConditions` as a second CondInt16 collection, followed by the one-byte
 * `m_bIsNestedDetailFamily` flag. Both collections append their non-null
 * properties to the same native FIFO in field order.
 *
 * A filter controls which grouped nodes are visible. It does not itself add
 * triangles, but its subnodes must be replayed to reach the symbol's geometry.
 */
export function decodeRevit2027GFilter(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
  revitVersion: number,
): Revit2027GFilterDecodeResult {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "Revit 2027 GFilter decoding requires release 2027",
    };
  }
  const group = decodeRevit2027GGroupStatic(
    data,
    byteOffset,
    enclosingEndOffset,
    revitVersion,
  );
  if (!group.ok) return group;

  const boundedData =
    enclosingEndOffset === data.byteLength
      ? data
      : data.subarray(0, enclosingEndOffset);
  const conditions = decodeCondInt16QueueCollection(
    boundedData,
    group.value.endOffset,
  );
  if (!conditions.ok) {
    return {
      ok: false,
      error: `Revit 2027 GFilter conditions: ${conditions.error}`,
    };
  }
  const flagOffset = conditions.collection.endOffset;
  if (flagOffset >= enclosingEndOffset) {
    return {
      ok: false,
      error: "Revit 2027 GFilter nested-detail flag is truncated",
    };
  }
  const flag = data[flagOffset]!;
  if (flag !== 0 && flag !== 1) {
    return {
      ok: false,
      error: "Revit 2027 GFilter nested-detail flag is not boolean",
    };
  }

  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: flagOffset + 1,
      group: group.value,
      conditions: conditions.collection.entries,
      isNestedDetailFamily: flag === 1,
      queuedProperties: [
        ...group.value.children,
        ...conditions.collection.entries,
      ],
    },
  };
}
