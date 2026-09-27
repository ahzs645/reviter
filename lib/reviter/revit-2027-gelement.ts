import {
  decodeCondInt16QueueCollection,
  type CondInt16QueueEntry,
} from "./dynamic-geometry-queue.ts";
import { narrowElementIds } from "./element-id-width.ts";
import type { RevitExtents3d } from "./revit-2026-grep-root.ts";
import {
  readRevit2027GInfo,
  revit2027GInfoBytes,
  type Revit2027GInfo,
} from "./revit-2027-grep-prefixes.ts";
import { usesRevit2027RecordLayout } from "./revit-class-tags.ts";

/** Selector-free ObjectPtrInit source slot for a queued Revit 2027 GElement. */
export const REVIT_2027_GELEMENT_SOURCE_CLASS_SLOT = 2246;

const GREP_STATIC_SUFFIX_BYTES = 112;

/**
 * The suffix where ids are 32-bit: the 2019 to 2023 `GRep` (version 5) has no
 * `m_elementId`, so the two boxes are followed directly by `m_gElemType` and
 * `m_flags`. The element's id is then the one its `GInfo.m_tag` carries, as
 * it does at a framed root in every release.
 */
const NARROW_GREP_STATIC_SUFFIX_BYTES = 104;

export type Revit2027GElementStatic = {
  byteOffset: number;
  endOffset: number;
  gInfo: Revit2027GInfo;
  children: readonly CondInt16QueueEntry[];
  localExtents: RevitExtents3d;
  worldExtents: RevitExtents3d;
  elementId: bigint;
  objectType: number;
  flags: number;
};

export type Revit2027GElementStaticDecodeResult =
  | { ok: true; value: Revit2027GElementStatic }
  | { ok: false; error: string };

function decodeGInfo(view: DataView, byteOffset: number): Revit2027GInfo {
  return readRevit2027GInfo(view, byteOffset);
}

function decodeExtents(view: DataView, byteOffset: number): RevitExtents3d {
  const minimum = [
    view.getFloat64(byteOffset, true),
    view.getFloat64(byteOffset + 8, true),
    view.getFloat64(byteOffset + 16, true),
  ] as const;
  const maximum = [
    view.getFloat64(byteOffset + 24, true),
    view.getFloat64(byteOffset + 32, true),
    view.getFloat64(byteOffset + 40, true),
  ] as const;
  return {
    minimum,
    maximum,
    valid:
      minimum.every(Number.isFinite) &&
      maximum.every(Number.isFinite) &&
      minimum[0] <= maximum[0] &&
      minimum[1] <= maximum[1] &&
      minimum[2] <= maximum[2],
  };
}

/**
 * Decode the selector-free queued `GElement -> GRep -> GGroup` body.
 *
 * `Formats/Latest` proves that the counted `m_subNodes` collection is followed
 * by `m_bBox`, `m_tightbBox`, `m_elementId`, `m_gElemType`, and `m_flags`.
 * Child bodies remain in the enclosing FIFO and are never consumed inline.
 */
export function decodeRevit2027GElementStatic(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
  revitVersion: number,
): Revit2027GElementStaticDecodeResult {
  if (!usesRevit2027RecordLayout(revitVersion)) {
    return {
      ok: false,
      error: "Revit 2027 GElement decoding requires release 2027",
    };
  }
  if (
    !Number.isSafeInteger(byteOffset) ||
    !Number.isSafeInteger(enclosingEndOffset) ||
    byteOffset < 0 ||
    enclosingEndOffset > data.byteLength ||
    byteOffset > enclosingEndOffset - revit2027GInfoBytes() - 4
  ) {
    return { ok: false, error: "Revit 2027 GElement boundary is invalid" };
  }

  const narrow = narrowElementIds();
  const decodedChildren = decodeCondInt16QueueCollection(
    data,
    byteOffset + revit2027GInfoBytes(),
  );
  if (!decodedChildren.ok) return decodedChildren;
  const suffixOffset = decodedChildren.collection.endOffset;
  const endOffset = suffixOffset +
    (narrow ? NARROW_GREP_STATIC_SUFFIX_BYTES : GREP_STATIC_SUFFIX_BYTES);
  if (
    !Number.isSafeInteger(endOffset) ||
    endOffset > enclosingEndOffset
  ) {
    return {
      ok: false,
      error: "Revit 2027 GElement bounds or static tail is truncated",
    };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const localExtents = decodeExtents(view, suffixOffset);
  const worldExtents = decodeExtents(view, suffixOffset + 48);
  // Embedded GReps in the exact corpus carry an invalid tight/world sentinel;
  // their local box is the geometry-space envelope transformed by
  // InstanceInfo. Only that consumed association box must be valid.
  if (!localExtents.valid) {
    return {
      ok: false,
      error: "Revit 2027 GElement contains invalid local extents",
    };
  }

  const gInfo = decodeGInfo(view, byteOffset);
  const tailOffset = suffixOffset + (narrow ? 96 : 104);
  return {
    ok: true,
    value: {
      byteOffset,
      endOffset,
      gInfo,
      children: decodedChildren.collection.entries,
      localExtents,
      worldExtents,
      elementId: narrow ? BigInt(gInfo.tag) : view.getBigInt64(suffixOffset + 96, true),
      objectType: view.getInt32(tailOffset, true),
      flags: view.getUint32(tailOffset + 4, true),
    },
  };
}
