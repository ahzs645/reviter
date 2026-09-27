import {
  decodeCondInt16PropertyDescriptor,
  decodeTrf201120260,
  type CondInt16QueueEntry,
  type RevitTransform3d,
} from "./dynamic-geometry-queue.ts";
import { readRevit2027GInfo, revit2027GInfoBytes, type Revit2027GInfo } from "./revit-2027-grep-prefixes.ts";
import { usesRevit2027RecordLayout } from "./revit-class-tags.ts";

/** Exact Revit 2027 source-class slot for `GImposter`. */
export const REVIT_2027_GIMPOSTER_SOURCE_CLASS_SLOT = 2262;
/** Exact Revit 2027 source-class slot for the rendering `Asset` it names. */
export const REVIT_2027_ASSET_SOURCE_CLASS_SLOT = 425;
export const REVIT_2027_GIMPOSTER_BODY_BYTES = 122;


/**
 * A rendering stand-in: an appearance asset placed under a transform, which a
 * renderer draws in place of real geometry. Light fixtures carry one for the
 * lamp. It has no faces, and the Autodesk Viewer does not draw it.
 */
export type Revit2027GImposter = {
  byteOffset: number;
  endOffset: number;
  gInfo: Revit2027GInfo;
  transform: RevitTransform3d;
  /** The queued `m_oAsset`. */
  asset: CondInt16QueueEntry;
};

export type Revit2027GImposterDecodeResult =
  | { ok: true; value: Revit2027GImposter }
  | { ok: false; error: string };

/**
 * Decode the schema-complete Revit 2027 `GImposter` body: the 20-byte `GInfo`
 * prefix, the inline `m_trf` (the same 96-byte transform an `InstanceInfo`
 * holds), and one CondInt16 descriptor that queues its `Asset`.
 */
export function decodeRevit2027GImposter(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
  revitVersion: number,
): Revit2027GImposterDecodeResult {
  if (!usesRevit2027RecordLayout(revitVersion)) {
    return { ok: false, error: "Revit 2027 GImposter decoding requires release 2027" };
  }
  if (
    !Number.isSafeInteger(byteOffset) ||
    byteOffset < 0 ||
    !Number.isSafeInteger(enclosingEndOffset) ||
    enclosingEndOffset > data.byteLength ||
    byteOffset > enclosingEndOffset - (revit2027GInfoBytes() + 102)
  ) {
    return { ok: false, error: "Revit 2027 GImposter body is truncated or outside its owner" };
  }
  // GInfo, then the inline 96-byte transform, then the asset descriptor.
  const transformOffset = byteOffset + revit2027GInfoBytes();
  const bodyEnd = transformOffset + 96 + 6;
  const transform = decodeTrf201120260(data, transformOffset);
  if (!transform.ok) return transform;
  const asset = decodeCondInt16PropertyDescriptor(data, transformOffset + 96);
  if (!asset.ok) return asset;
  if (
    asset.descriptor.endOffset !== bodyEnd ||
    asset.descriptor.token !== -1 ||
    asset.descriptor.sourceClassSlot !== REVIT_2027_ASSET_SOURCE_CLASS_SLOT
  ) {
    return {
      ok: false,
      error: "Revit 2027 GImposter asset descriptor is not the token -1/source-slot 425 form",
    };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: bodyEnd,
      gInfo: readRevit2027GInfo(view, byteOffset),
      transform: transform.transform,
      asset: asset.descriptor,
    },
  };
}
