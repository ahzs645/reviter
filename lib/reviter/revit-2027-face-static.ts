import {
  decodeCondInt16PropertyDescriptor,
  decodeCondInt16QueueCollection,
  type CondInt16QueueCollection,
  type CondInt16QueueEntry,
} from "./dynamic-geometry-queue.ts";
import type { Revit2027GInfo } from "./revit-2027-grep-prefixes.ts";

/** Exact Revit 2027 source-class slot for persisted `Face`. */
export const REVIT_2027_FACE_SOURCE_CLASS_SLOT = 1825;

const GINFO_BYTES = 20;
const ELEMENT_ID_BYTES = 8;
const INT32_BYTES = 4;
const DEFAULT_MAX_FACE_REGIONS = 1_000_000;

export type Revit2027FaceStatic = {
  byteOffset: number;
  endOffset: number;
  gInfo: Revit2027GInfo;
  /** `GFace.m_pFirstLoop`; its body is replayed later through the FIFO. */
  firstLoop: CondInt16QueueEntry;
  /** `GFace.m_faceRegions`; region bodies are replayed in collection order. */
  faceRegions: CondInt16QueueCollection;
  /** `GFace.m_pGFilling`, exposed by the runtime as foreground filling. */
  foregroundFilling: CondInt16QueueEntry;
  /** `GFace.m_oBackgroundFilling`. */
  backgroundFilling: CondInt16QueueEntry;
  renderStyleElementId: bigint;
  cutType: number;
  faceFlags: number;
  /** `Face.m_pSurf`; the analytic surface body is queued, not inline. */
  surface: CondInt16QueueEntry;
  /** Every property appended by this body, in native insertion order. */
  queuedProperties: readonly CondInt16QueueEntry[];
};

export type Revit2027FaceStaticDecodeResult =
  | { ok: true; value: Revit2027FaceStatic }
  | { ok: false; error: string };

export type Revit2027FaceDecodeOptions = {
  maxFaceRegions?: number;
};

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

function decodeGInfo(view: DataView, byteOffset: number): Revit2027GInfo {
  return {
    gStyleElementId: view.getBigInt64(byteOffset, true),
    tag: view.getInt32(byteOffset + 8, true),
    controlCommand: view.getInt32(byteOffset + 12, true),
    flags: view.getUint32(byteOffset + 16, true),
  };
}

function propertyAt(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
  label: string,
): { ok: true; value: CondInt16QueueEntry } | { ok: false; error: string } {
  const boundedData =
    enclosingEndOffset === data.byteLength
      ? data
      : data.subarray(0, enclosingEndOffset);
  const result = decodeCondInt16PropertyDescriptor(boundedData, byteOffset);
  return result.ok
    ? { ok: true, value: result.descriptor }
    : { ok: false, error: `Face ${label}: ${result.error}` };
}

/**
 * Decode the selector-free static body of Revit 2027 source slot 1,825
 * (`Face`, inheriting persisted `GFace`).
 *
 * Exact `Formats/Latest` schema fields and the available native 2026 reader
 * agree on the base-to-derived order represented here. Conditional values
 * only describe FIFO-owned objects; this function never guesses their body
 * widths and stops immediately after `Face.m_pSurf`.
 */
export function decodeRevit2027FaceStatic(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
  revitVersion: number,
  options: Revit2027FaceDecodeOptions = {},
): Revit2027FaceStaticDecodeResult {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "Revit 2027 Face decoding requires release 2027",
    };
  }

  const maxFaceRegions =
    options.maxFaceRegions ?? DEFAULT_MAX_FACE_REGIONS;
  if (!Number.isSafeInteger(maxFaceRegions) || maxFaceRegions < 0) {
    return {
      ok: false,
      error: "maxFaceRegions must be a non-negative safe integer",
    };
  }

  if (!bounded(data, byteOffset, GINFO_BYTES + 4, enclosingEndOffset)) {
    return { ok: false, error: "Revit 2027 Face/GFace prefix is truncated" };
  }

  const firstLoop = propertyAt(
    data,
    byteOffset + GINFO_BYTES,
    enclosingEndOffset,
    "first loop",
  );
  if (!firstLoop.ok) return firstLoop;

  const boundedData =
    enclosingEndOffset === data.byteLength
      ? data
      : data.subarray(0, enclosingEndOffset);
  const faceRegions = decodeCondInt16QueueCollection(
    boundedData,
    firstLoop.value.endOffset,
    { maxEntries: maxFaceRegions },
  );
  if (!faceRegions.ok) {
    return { ok: false, error: `Face regions: ${faceRegions.error}` };
  }

  const foregroundFilling = propertyAt(
    data,
    faceRegions.collection.endOffset,
    enclosingEndOffset,
    "foreground filling",
  );
  if (!foregroundFilling.ok) return foregroundFilling;
  const backgroundFilling = propertyAt(
    data,
    foregroundFilling.value.endOffset,
    enclosingEndOffset,
    "background filling",
  );
  if (!backgroundFilling.ok) return backgroundFilling;

  const scalarOffset = backgroundFilling.value.endOffset;
  const scalarBytes = ELEMENT_ID_BYTES + INT32_BYTES + INT32_BYTES;
  if (!bounded(data, scalarOffset, scalarBytes + 4, enclosingEndOffset)) {
    return {
      ok: false,
      error: "Revit 2027 Face style, flags, or surface is truncated",
    };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const surface = propertyAt(
    data,
    scalarOffset + scalarBytes,
    enclosingEndOffset,
    "surface",
  );
  if (!surface.ok) return surface;

  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: surface.value.endOffset,
      gInfo: decodeGInfo(view, byteOffset),
      firstLoop: firstLoop.value,
      faceRegions: faceRegions.collection,
      foregroundFilling: foregroundFilling.value,
      backgroundFilling: backgroundFilling.value,
      renderStyleElementId: view.getBigInt64(scalarOffset, true),
      cutType: view.getInt32(scalarOffset + ELEMENT_ID_BYTES, true),
      faceFlags: view.getUint32(
        scalarOffset + ELEMENT_ID_BYTES + INT32_BYTES,
        true,
      ),
      surface: surface.value,
      queuedProperties: [
        firstLoop.value,
        ...faceRegions.collection.entries,
        foregroundFilling.value,
        backgroundFilling.value,
        surface.value,
      ].filter((entry) => entry.token !== 0),
    },
  };
}
