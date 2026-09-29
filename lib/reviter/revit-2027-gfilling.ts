import {
  decodeCondInt16PropertyDescriptor,
  type CondInt16QueueEntry,
} from "./dynamic-geometry-queue.ts";
import { narrowElementIds } from "./element-id-width.ts";
import {
  revit2027GInfoBytes,
  readRevit2027GInfo,
  type Revit2027GInfo,
} from "./revit-2027-grep-prefixes.ts";
import { fileClassFieldCount, usesRevit2027RecordLayout } from "./revit-class-tags.ts";

/** Exact Revit 2027 source-class slot for persisted `GFilling`. */
export const REVIT_2027_GFILLING_SOURCE_CLASS_SLOT = 2253;

const INT32_BYTES = 4;
const ELEMENT_ID_BYTES = 8;
const COLOR_BYTES = 4;
const DOUBLE_BYTES = 8;
const POINT_2D_BYTES = 16;
const FILL_PATTERN_PLACER_BYTES =
  DOUBLE_BYTES + POINT_2D_BYTES * 3 + 1 + 1;
/** `FillPatternPlacer`, in the 2027 numbering. */
const FILL_PATTERN_PLACER_CLASS = 2093;

/**
 * Whether the file's `FillPatternPlacer` has no `m_uvScale`: the 2019 to 2021
 * schemas declare version 2, five fields, and the placer is 16 bytes shorter.
 * Such a placer scales both directions by one.
 */
function placerWithoutUvScale(): boolean {
  return fileClassFieldCount(FILL_PATTERN_PLACER_CLASS) === 5;
}

function fillPatternPlacerBytes(): number {
  return FILL_PATTERN_PLACER_BYTES - (placerWithoutUvScale() ? POINT_2D_BYTES : 0);
}

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
  return readRevit2027GInfo(view, byteOffset);
}

function decodePlacer(
  data: Uint8Array,
  view: DataView,
  byteOffset: number,
  enclosingEndOffset: number,
):
  | { ok: true; value: Revit2027FillPatternPlacer }
  | { ok: false; error: string } {
  const placerBytes = fillPatternPlacerBytes();
  if (
    !bounded(
      data,
      byteOffset,
      placerBytes,
      enclosingEndOffset,
    )
  ) {
    return { ok: false, error: "Revit 2027 FillPatternPlacer is truncated" };
  }
  const scaled = !placerWithoutUvScale();
  const scale = view.getFloat64(byteOffset, true);
  const origin = point2d(view, byteOffset + DOUBLE_BYTES);
  const direction = point2d(
    view,
    byteOffset + DOUBLE_BYTES + POINT_2D_BYTES,
  );
  const uvScale: Revit2027Point2d = scaled
    ? point2d(view, byteOffset + DOUBLE_BYTES + POINT_2D_BYTES * 2)
    : [1, 1];
  const flagsOffset = byteOffset + placerBytes - 2;
  if (!finite([scale, ...origin, ...direction, ...uvScale])) {
    return {
      ok: false,
      error: "Revit 2027 FillPatternPlacer fields are not finite",
    };
  }
  const mirroredByte = data[flagsOffset];
  const placedDraftByte = data[flagsOffset + 1];
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
      endOffset: byteOffset + placerBytes,
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
  if (!usesRevit2027RecordLayout(revitVersion)) {
    return {
      ok: false,
      error: "Revit 2027 GFilling decoding requires release 2027",
    };
  }
  // `m_patternId` is an `ElementId`: four bytes where ids are 32-bit.
  const narrow = narrowElementIds();
  const idBytes = narrow ? 4 : ELEMENT_ID_BYTES;
  const minimumBytes =
    revit2027GInfoBytes() +
    INT32_BYTES +
    fillPatternPlacerBytes() +
    INT32_BYTES +
    idBytes +
    COLOR_BYTES +
    INT32_BYTES;
  if (!bounded(data, byteOffset, minimumBytes, enclosingEndOffset)) {
    return { ok: false, error: "Revit 2027 GFilling body is truncated" };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const faceIdOffset = byteOffset + revit2027GInfoBytes();
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
  const scalarBytes = idBytes + COLOR_BYTES + INT32_BYTES;
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
      patternElementId: narrow
        ? BigInt(view.getInt32(scalarOffset, true))
        : view.getBigInt64(scalarOffset, true),
      fillColor: view.getUint32(scalarOffset + idBytes, true),
      flags: view.getInt32(
        scalarOffset + idBytes + COLOR_BYTES,
        true,
      ),
      queuedProperties:
        dataProperty.descriptor.token === 0
          ? []
          : [dataProperty.descriptor],
    },
  };
}
