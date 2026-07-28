import {
  decodeCondInt16PropertyDescriptor,
  type CondInt16QueueEntry,
} from "./dynamic-geometry-queue.ts";
import type { Revit2027GInfo } from "./revit-2027-grep-prefixes.ts";

/** Exact Revit 2027 source-class slot for persisted `GFilling`. */
export const REVIT_2027_GFILLING_SOURCE_CLASS_SLOT = 2253;

const GINFO_BYTES = 20;
const INT32_BYTES = 4;
const ELEMENT_ID_BYTES = 8;
const COLOR_BYTES = 4;
const DOUBLE_BYTES = 8;
const POINT_2D_BYTES = 16;
const FILL_PATTERN_PLACER_BYTES =
  DOUBLE_BYTES + POINT_2D_BYTES * 3 + 1 + 1;

export type Revit2027Point2d = readonly [number, number];

export type Revit2027FillPatternPlacer = {
  byteOffset: number;
  endOffset: number;
  scale: number;
  origin: Revit2027Point2d;
  direction: Revit2027Point2d;
  uvScale: Revit2027Point2d;
  mirrored: boolean;
  placedDraft: boolean;
};

export type Revit2027GFilling = {
  byteOffset: number;
  endOffset: number;
  gInfo: Revit2027GInfo;
  /**
   * `m_pGFace` is a native `StaticIntegerReader` ID-reference, not a queued
   * object and not an inline face body.
   */
  faceIdReference: number;
  placer: Revit2027FillPatternPlacer;
  /** `m_data`; its `FillPatternData` body is replayed later through the FIFO. */
  data: CondInt16QueueEntry;
  patternElementId: bigint;
  fillColor: number;
  flags: number;
  /** Every object property appended by this body, in native insertion order. */
  queuedProperties: readonly CondInt16QueueEntry[];
};

export type Revit2027GFillingDecodeResult =
  | { ok: true; value: Revit2027GFilling }
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

function point2d(view: DataView, byteOffset: number): Revit2027Point2d {
  return [
    view.getFloat64(byteOffset, true),
    view.getFloat64(byteOffset + DOUBLE_BYTES, true),
  ];
}

function finite(values: readonly number[]): boolean {
  return values.every(Number.isFinite);
}

function decodeGInfo(view: DataView, byteOffset: number): Revit2027GInfo {
  return {
    gStyleElementId: view.getBigInt64(byteOffset, true),
    tag: view.getInt32(byteOffset + 8, true),
    controlCommand: view.getInt32(byteOffset + 12, true),
    flags: view.getUint32(byteOffset + 16, true),
  };
}

function decodePlacer(
  data: Uint8Array,
  view: DataView,
  byteOffset: number,
  enclosingEndOffset: number,
):
  | { ok: true; value: Revit2027FillPatternPlacer }
  | { ok: false; error: string } {
  if (
    !bounded(
      data,
      byteOffset,
      FILL_PATTERN_PLACER_BYTES,
      enclosingEndOffset,
    )
  ) {
    return { ok: false, error: "Revit 2027 FillPatternPlacer is truncated" };
  }
  const scale = view.getFloat64(byteOffset, true);
  const origin = point2d(view, byteOffset + DOUBLE_BYTES);
  const direction = point2d(
    view,
    byteOffset + DOUBLE_BYTES + POINT_2D_BYTES,
  );
  const uvScale = point2d(
    view,
    byteOffset + DOUBLE_BYTES + POINT_2D_BYTES * 2,
  );
  if (!finite([scale, ...origin, ...direction, ...uvScale])) {
    return {
      ok: false,
      error: "Revit 2027 FillPatternPlacer fields are not finite",
    };
  }
  const mirroredByte =
    data[byteOffset + DOUBLE_BYTES + POINT_2D_BYTES * 3];
  const placedDraftByte =
    data[byteOffset + DOUBLE_BYTES + POINT_2D_BYTES * 3 + 1];
  if (
    (mirroredByte !== 0 && mirroredByte !== 1) ||
    (placedDraftByte !== 0 && placedDraftByte !== 1)
  ) {
    return {
      ok: false,
      error: "Revit 2027 FillPatternPlacer flags are not boolean",
    };
  }
  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: byteOffset + FILL_PATTERN_PLACER_BYTES,
      scale,
      origin,
      direction,
      uvScale,
      mirrored: mirroredByte === 1,
      placedDraft: placedDraftByte === 1,
    },
  };
}

/**
 * Decode the selector-free static body of Revit 2027 source slot 2,253
 * (`GFilling`, inheriting persisted `GNode/GInfo`).
 *
 * The exact schema and native reference reader agree on this order:
 * GNode, int32 face ID-reference, inline FillPatternPlacer, conditional Data,
 * ElementId pattern, uint32 color, and int32 flags. The function stops before
 * the queued `FillPatternData` body and never treats `m_pGFace` as one.
 */
export function decodeRevit2027GFilling(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
  revitVersion: number,
): Revit2027GFillingDecodeResult {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "Revit 2027 GFilling decoding requires release 2027",
    };
  }
  const minimumBytes =
    GINFO_BYTES +
    INT32_BYTES +
    FILL_PATTERN_PLACER_BYTES +
    INT32_BYTES +
    ELEMENT_ID_BYTES +
    COLOR_BYTES +
    INT32_BYTES;
  if (!bounded(data, byteOffset, minimumBytes, enclosingEndOffset)) {
    return { ok: false, error: "Revit 2027 GFilling body is truncated" };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const faceIdOffset = byteOffset + GINFO_BYTES;
  const placer = decodePlacer(
    data,
    view,
    faceIdOffset + INT32_BYTES,
    enclosingEndOffset,
  );
  if (!placer.ok) return placer;

  const boundedData =
    enclosingEndOffset === data.byteLength
      ? data
      : data.subarray(0, enclosingEndOffset);
  const dataProperty = decodeCondInt16PropertyDescriptor(
    boundedData,
    placer.value.endOffset,
  );
  if (!dataProperty.ok) {
    return { ok: false, error: `GFilling data: ${dataProperty.error}` };
  }
  const scalarOffset = dataProperty.descriptor.endOffset;
  const scalarBytes = ELEMENT_ID_BYTES + COLOR_BYTES + INT32_BYTES;
  if (!bounded(data, scalarOffset, scalarBytes, enclosingEndOffset)) {
    return {
      ok: false,
      error: "Revit 2027 GFilling pattern, color, or flags are truncated",
    };
  }

  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: scalarOffset + scalarBytes,
      gInfo: decodeGInfo(view, byteOffset),
      faceIdReference: view.getInt32(faceIdOffset, true),
      placer: placer.value,
      data: dataProperty.descriptor,
      patternElementId: view.getBigInt64(scalarOffset, true),
      fillColor: view.getUint32(scalarOffset + ELEMENT_ID_BYTES, true),
      flags: view.getInt32(
        scalarOffset + ELEMENT_ID_BYTES + COLOR_BYTES,
        true,
      ),
      queuedProperties:
        dataProperty.descriptor.token === 0
          ? []
          : [dataProperty.descriptor],
    },
  };
}
