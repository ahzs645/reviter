import {
  decodeCondInt16PropertyDescriptor,
  type CondInt16QueueEntry,
} from "./dynamic-geometry-queue.ts";
import { REVIT_2027_INSTANCE_INFO_SOURCE_CLASS_SLOT } from "./revit-2027-ginstance.ts";
import type { Revit2027GInfo } from "./revit-2027-grep-prefixes.ts";
import { usesRevit2027RecordLayout } from "./revit-class-tags.ts";

/** Exact Revit 2027 source-class slot for `GComponentRef`. */
export const REVIT_2027_GCOMPONENT_REF_SOURCE_CLASS_SLOT = 2230;
export const REVIT_2027_GCOMPONENT_REF_BODY_BYTES = 26;

const GINFO_BYTES = 20;

/**
 * A reference, inside one element's geometry, to a component that is its own
 * element in the project.
 *
 * A family that nests a shared family, such as a pile cap and its piles,
 * keeps each nested component as a separate project element with its own
 * geometry. The host's geometry names the component through this node rather
 * than repeating it, so the component is drawn once, by its own element.
 */
export type Revit2027GComponentRef = {
  byteOffset: number;
  endOffset: number;
  gInfo: Revit2027GInfo;
  /** The queued `m_instanceInfo`: which component, and where. */
  instanceInfo: CondInt16QueueEntry;
};

export type Revit2027GComponentRefDecodeResult =
  | { ok: true; value: Revit2027GComponentRef }
  | { ok: false; error: string };

/**
 * Decode the schema-complete Revit 2027 `GComponentRef` body: the 20-byte
 * `GInfo` prefix and one CondInt16 descriptor that queues its `InstanceInfo`,
 * the same token -1 form a `GInstance` uses.
 */
export function decodeRevit2027GComponentRef(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
  revitVersion: number,
): Revit2027GComponentRefDecodeResult {
  if (!usesRevit2027RecordLayout(revitVersion)) {
    return { ok: false, error: "Revit 2027 GComponentRef decoding requires release 2027" };
  }
  if (
    !Number.isSafeInteger(byteOffset) ||
    byteOffset < 0 ||
    !Number.isSafeInteger(enclosingEndOffset) ||
    enclosingEndOffset > data.byteLength ||
    byteOffset > enclosingEndOffset - REVIT_2027_GCOMPONENT_REF_BODY_BYTES
  ) {
    return { ok: false, error: "Revit 2027 GComponentRef body is truncated or outside its owner" };
  }
  const instanceInfo = decodeCondInt16PropertyDescriptor(data, byteOffset + GINFO_BYTES);
  if (!instanceInfo.ok) return instanceInfo;
  if (
    instanceInfo.descriptor.endOffset !== byteOffset + REVIT_2027_GCOMPONENT_REF_BODY_BYTES ||
    instanceInfo.descriptor.token !== -1 ||
    instanceInfo.descriptor.sourceClassSlot !== REVIT_2027_INSTANCE_INFO_SOURCE_CLASS_SLOT
  ) {
    return {
      ok: false,
      error: "Revit 2027 GComponentRef instanceInfo descriptor is not the certified token -1/source-slot 2513 form",
    };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: byteOffset + REVIT_2027_GCOMPONENT_REF_BODY_BYTES,
      gInfo: {
        gStyleElementId: view.getBigInt64(byteOffset, true),
        tag: view.getInt32(byteOffset + 8, true),
        controlCommand: view.getInt32(byteOffset + 12, true),
        flags: view.getUint32(byteOffset + 16, true),
      },
      instanceInfo: instanceInfo.descriptor,
    },
  };
}
