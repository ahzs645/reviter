import type { CondInt16QueueEntry } from "./dynamic-geometry-queue.ts";
import type { ElementObject } from "./element-objects.ts";
import type { Revit2026GInfoStatic } from "./revit-2026-object-dispatch.ts";

/**
 * The persisted selector is zero-based. `Formats/Latest` identifies the
 * corresponding `GElement` class as release slot 2247.
 */
export const REVIT_2026_GELEMENT_WIRE_SELECTOR = 2246;
export const REVIT_2026_GELEMENT_SOURCE_CLASS_SLOT = 2247;
export const REVIT_2026_GREP_SOURCE_CLASS_SLOT = 2207;

const FRAME_MARKER_OFFSET = 16;
const BODY_OFFSET = 18;
const FRAME_ECHO_OFFSET = 16;
const FRAME_TRAILER_BYTES = 20;
const GINFO_BYTES = 20;
const EXTENTS_BYTES = 48;
const GREP_TAIL_BYTES = 16;
const MAX_CHILDREN = 10_000;

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
  if (
    !Number.isSafeInteger(frame.offset) ||
    !Number.isSafeInteger(frame.objectLength) ||
    frame.offset < 0 ||
    frame.objectLength < BODY_OFFSET + GINFO_BYTES + 4 + 2 * EXTENTS_BYTES + GREP_TAIL_BYTES
  ) {
    return { ok: false, error: "GElement frame boundary is invalid" };
  }
  const frameEndOffset = frame.offset + frame.objectLength;
  const trailerEndOffset = frameEndOffset + FRAME_TRAILER_BYTES;
  if (
    !Number.isSafeInteger(frameEndOffset) ||
    !fitsWithin(frame.offset, trailerEndOffset - frame.offset, 0, data.byteLength)
  ) {
    return { ok: false, error: "GElement frame is truncated" };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (
    view.getUint32(frame.offset + 12, true) !== frame.objectLength ||
    view.getUint32(frameEndOffset + FRAME_ECHO_OFFSET, true) !== frame.objectLength
  ) {
    return { ok: false, error: "GElement frame length echo does not match" };
  }
  if (
    frame.marker !== REVIT_2026_GELEMENT_WIRE_SELECTOR ||
    view.getUint16(frame.offset + FRAME_MARKER_OFFSET, true) !==
      REVIT_2026_GELEMENT_WIRE_SELECTOR
  ) {
    return { ok: false, error: "frame is not a Revit 2026 GElement" };
  }

  const frameElementId = view.getBigUint64(frame.offset, true);
  if (
    frameElementId === 0n ||
    frameElementId > BigInt(Number.MAX_SAFE_INTEGER) ||
    frame.elementId !== Number(frameElementId)
  ) {
    return { ok: false, error: "GElement frame owner id is invalid or inconsistent" };
  }

  const bodyOffset = frame.offset + BODY_OFFSET;
  if (!fitsWithin(bodyOffset, GINFO_BYTES + 4, bodyOffset, frameEndOffset)) {
    return { ok: false, error: "GRep static prefix is truncated" };
  }
  const gInfo: Revit2026GInfoStatic = {
    gStyleElementId: view.getBigUint64(bodyOffset, true),
    tag: view.getInt32(bodyOffset + 8, true),
    controlCommand: view.getInt32(bodyOffset + 12, true),
    flags: view.getUint32(bodyOffset + 16, true),
  };

  const childCountOffset = bodyOffset + GINFO_BYTES;
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
      sourceClassSlot = view.getInt16(offset, true);
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
      2 * EXTENTS_BYTES + GREP_TAIL_BYTES,
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

  const ownerElementId = view.getBigInt64(offset, true);
  offset += 8;
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
