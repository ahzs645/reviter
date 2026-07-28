import {
  decodeCondInt16QueueCollection,
  type CondInt16QueueEntry,
} from "./dynamic-geometry-queue.ts";
import type { RevitExtents3d } from "./revit-2026-grep-root.ts";
import type { Revit2027GInfo } from "./revit-2027-grep-prefixes.ts";

/** Selector-free ObjectPtrInit source slot for a queued Revit 2027 GElement. */
export const REVIT_2027_GELEMENT_SOURCE_CLASS_SLOT = 2246;

const GINFO_BYTES = 20;
const GREP_STATIC_SUFFIX_BYTES = 112;

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
  return {
    gStyleElementId: view.getBigInt64(byteOffset, true),
    tag: view.getInt32(byteOffset + 8, true),
    controlCommand: view.getInt32(byteOffset + 12, true),
    flags: view.getUint32(byteOffset + 16, true),
  };
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
  if (revitVersion !== 2027) {
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
    byteOffset > enclosingEndOffset - GINFO_BYTES - 4
  ) {
    return { ok: false, error: "Revit 2027 GElement boundary is invalid" };
  }

  const decodedChildren = decodeCondInt16QueueCollection(
    data,
    byteOffset + GINFO_BYTES,
  );
  if (!decodedChildren.ok) return decodedChildren;
  const suffixOffset = decodedChildren.collection.endOffset;
  const endOffset = suffixOffset + GREP_STATIC_SUFFIX_BYTES;
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

  return {
    ok: true,
    value: {
      byteOffset,
      endOffset,
      gInfo: decodeGInfo(view, byteOffset),
      children: decodedChildren.collection.entries,
      localExtents,
      worldExtents,
      elementId: view.getBigInt64(suffixOffset + 96, true),
      objectType: view.getInt32(suffixOffset + 104, true),
      flags: view.getUint32(suffixOffset + 108, true),
    },
  };
}
