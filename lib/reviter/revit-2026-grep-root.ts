import type { CondInt16QueueEntry } from "./dynamic-geometry-queue.ts";
import { narrowElementIds } from "./element-id-width.ts";
import type { ElementObject } from "./element-objects.ts";
import type { Revit2026GInfoStatic } from "./revit-2026-object-dispatch.ts";
import { readRevit2027GInfo } from "./revit-2027-grep-prefixes.ts";
import { canonicalClassTag } from "./revit-class-tags.ts";

/**
 * `Formats/Latest` gives the framed GElement schema tag 2247, whose persisted
 * object marker is the class's own index. It is not an ObjectPtrInit source slot.
 */
export const REVIT_2026_GELEMENT_OBJECT_MARKER = 2246;
/** Independently resolved by the release-scoped native direct reader. */
export const REVIT_2026_GELEMENT_SOURCE_CLASS_SLOT = 2206;
export const REVIT_2026_GREP_SOURCE_CLASS_SLOT = 2207;

const FRAME_MARKER_OFFSET = 16;
const BODY_OFFSET = 18;
const FRAME_ECHO_OFFSET = 16;
const FRAME_TRAILER_BYTES = 20;
const GINFO_BYTES = 20;
const EXTENTS_BYTES = 48;
const GREP_TAIL_BYTES = 16;
const MAX_CHILDREN = 10_000;

/**
 * The same prefix where ids are 32-bit (Revit 2023 and older): a 12-byte
 * frame header, a 16-byte `GInfo`, and a `GRep` tail of `m_gElemType` and
 * `m_flags` only. The 2023 schema's `GRep` (version 5) has no `m_elementId`;
 * 2024's (version 6) added it, and the frame's own id stands in for it.
 */
const NARROW = {
  markerOffset: 12,
  bodyOffset: 14,
  echoOffset: 12,
  trailerBytes: 16,
  gInfoBytes: 16,
  grepTailBytes: 8,
} as const;
const WIDE = {
  markerOffset: FRAME_MARKER_OFFSET,
  bodyOffset: BODY_OFFSET,
  echoOffset: FRAME_ECHO_OFFSET,
  trailerBytes: FRAME_TRAILER_BYTES,
  gInfoBytes: GINFO_BYTES,
  grepTailBytes: GREP_TAIL_BYTES,
} as const;

export type RevitExtents3d = {
  minimum: readonly [number, number, number];
  maximum: readonly [number, number, number];
  valid: boolean;
};

export type Revit2026GRepRoot = {
  frameOffset: number;
  frameEndOffset: number;
  dynamicPayloadOffset: number;
  dynamicPayloadEndOffset: number;
  ownerElementId: bigint;
  gInfo: Revit2026GInfoStatic;
  children: readonly CondInt16QueueEntry[];
  localExtents: RevitExtents3d;
  worldExtents: RevitExtents3d;
  objectType: number;
  flags: number;
};

export type Revit2026GRepRootResult =
  | { ok: true; value: Revit2026GRepRoot }
  | { ok: false; error: string };

function fitsWithin(
  offset: number,
  byteLength: number,
  startOffset: number,
  endOffset: number,
): boolean {
  return (
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(byteLength) &&
    Number.isSafeInteger(startOffset) &&
    Number.isSafeInteger(endOffset) &&
    byteLength >= 0 &&
    offset >= startOffset &&
    endOffset >= startOffset &&
    offset <= endOffset - byteLength
  );
}

function decodeExtents(view: DataView, offset: number): RevitExtents3d {
  const minimum = [
    view.getFloat64(offset, true),
    view.getFloat64(offset + 8, true),
    view.getFloat64(offset + 16, true),
  ] as const;
  const maximum = [
    view.getFloat64(offset + 24, true),
    view.getFloat64(offset + 32, true),
    view.getFloat64(offset + 40, true),
  ] as const;
  const valid =
    minimum.every(Number.isFinite) &&
    maximum.every(Number.isFinite) &&
    minimum[0] <= maximum[0] &&
    minimum[1] <= maximum[1] &&
    minimum[2] <= maximum[2];
  return { minimum, maximum, valid };
}

/**
 * Decode the inherited `GElement -> GRep -> GGroup -> GNode/GInfo` static
 * prefix of one independently length/echo-framed Revit 2026 object.
 *
 * This is deliberately stricter than a byte-shape probe. It revalidates the
 * frame marker, length echo, owner id, conditional child descriptors, and
 * every static-field boundary. The returned dynamic payload starts only after
 * the complete derived `GRep` tail; it is not evidence that any particular
 * queued child owns the next bytes.
 */
export function decodeRevit2026GRepRoot(
  data: Uint8Array,
  frame: ElementObject,
): Revit2026GRepRootResult {
  const narrow = narrowElementIds();
  const layout = narrow ? NARROW : WIDE;
  if (
    !Number.isSafeInteger(frame.offset) ||
    !Number.isSafeInteger(frame.objectLength) ||
    frame.offset < 0 ||
    frame.objectLength <
      layout.bodyOffset + layout.gInfoBytes + 4 + 2 * EXTENTS_BYTES + layout.grepTailBytes
  ) {
    return { ok: false, error: "GElement frame boundary is invalid" };
  }
  const frameEndOffset = frame.offset + frame.objectLength;
  const trailerEndOffset = frameEndOffset + layout.trailerBytes;
  if (
    !Number.isSafeInteger(frameEndOffset) ||
    !fitsWithin(frame.offset, trailerEndOffset - frame.offset, 0, data.byteLength)
  ) {
    return { ok: false, error: "GElement frame is truncated" };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (
    view.getUint32(frame.offset + layout.markerOffset - 4, true) !== frame.objectLength ||
    view.getUint32(frameEndOffset + layout.echoOffset, true) !== frame.objectLength
  ) {
    return { ok: false, error: "GElement frame length echo does not match" };
  }
  if (
    frame.marker !== REVIT_2026_GELEMENT_OBJECT_MARKER ||
    canonicalClassTag(view.getUint16(frame.offset + layout.markerOffset, true)) !==
      REVIT_2026_GELEMENT_OBJECT_MARKER
  ) {
    return { ok: false, error: "frame is not a Revit 2026 GElement" };
  }

  const frameElementId = narrow
    ? BigInt(view.getUint32(frame.offset, true))
    : view.getBigUint64(frame.offset, true);
  if (
    frameElementId === 0n ||
    frameElementId > BigInt(Number.MAX_SAFE_INTEGER) ||
    frame.elementId !== Number(frameElementId)
  ) {
    return { ok: false, error: "GElement frame owner id is invalid or inconsistent" };
  }

  const bodyOffset = frame.offset + layout.bodyOffset;
  if (!fitsWithin(bodyOffset, layout.gInfoBytes + 4, bodyOffset, frameEndOffset)) {
    return { ok: false, error: "GRep static prefix is truncated" };
  }
  const gInfo: Revit2026GInfoStatic = narrow
    ? {
        ...readRevit2027GInfo(view, bodyOffset),
        // Unsigned, as the wide reading takes it.
        gStyleElementId: BigInt.asUintN(64, BigInt(view.getInt32(bodyOffset + 8, true))),
      }
    : {
        gStyleElementId: view.getBigUint64(bodyOffset, true),
        tag: view.getInt32(bodyOffset + 8, true),
        controlCommand: view.getInt32(bodyOffset + 12, true),
        flags: view.getUint32(bodyOffset + 16, true),
      };

  const childCountOffset = bodyOffset + layout.gInfoBytes;
  const childCount = view.getInt32(childCountOffset, true);
  if (childCount < 0 || childCount > MAX_CHILDREN) {
    return { ok: false, error: "GGroup child count is outside the allowed range" };
  }
  const children: CondInt16QueueEntry[] = [];
  let offset = childCountOffset + 4;
  for (let index = 0; index < childCount; index += 1) {
    if (!fitsWithin(offset, 4, bodyOffset, frameEndOffset)) {
      return { ok: false, error: "GGroup child token is truncated" };
    }
    const byteOffset = offset;
    const token = view.getInt32(offset, true);
    offset += 4;
    let sourceClassSlot: number | null = null;
    if (token !== 0) {
      if (!fitsWithin(offset, 2, bodyOffset, frameEndOffset)) {
        return { ok: false, error: "GGroup child source-class slot is truncated" };
      }
      sourceClassSlot = canonicalClassTag(view.getInt16(offset, true));
      if (sourceClassSlot <= 0) {
        return { ok: false, error: "GGroup child source-class slot is invalid" };
      }
      offset += 2;
    }
    children.push({ byteOffset, endOffset: offset, token, sourceClassSlot });
  }

  if (
    !fitsWithin(
      offset,
      2 * EXTENTS_BYTES + layout.grepTailBytes,
      bodyOffset,
      frameEndOffset,
    )
  ) {
    return { ok: false, error: "GRep bounds or inline tail is truncated" };
  }
  const localExtents = decodeExtents(view, offset);
  offset += EXTENTS_BYTES;
  const worldExtents = decodeExtents(view, offset);
  offset += EXTENTS_BYTES;

  const ownerElementId = narrow ? frameElementId : view.getBigInt64(offset, true);
  if (!narrow) offset += 8;
  if (ownerElementId <= 0n || ownerElementId !== frameElementId) {
    return { ok: false, error: "GRep owner id does not match its framed element" };
  }
  const objectType = view.getInt32(offset, true);
  offset += 4;
  const flags = view.getUint32(offset, true);
  offset += 4;

  return {
    ok: true,
    value: {
      frameOffset: frame.offset,
      frameEndOffset,
      dynamicPayloadOffset: offset,
      dynamicPayloadEndOffset: frameEndOffset,
      ownerElementId,
      gInfo,
      children,
      localExtents,
      worldExtents,
      objectType,
      flags,
    },
  };
}
