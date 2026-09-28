/**
 * Two small non-geometric nodes the geometry replay has to read past.
 *
 * `GBitmap` is a screen-space marker drawn at a model point (the technical
 * school's roofs carry one): `GInfo`, `m_point` (three doubles), `m_size`
 * (two u32 pixels), `m_bitmapType` and `m_alignment`. In the technical school
 * the next queued node starts exactly 60 bytes on, where ids are 64-bit.
 *
 * `GConditionSelected` is a filter condition, `GConditionBase.m_comp` and the
 * view id `m_dbViewId`: 12 bytes, 8 where ids are 32-bit. Every one of the 40
 * sampled in the UNBC project holds -1 in both.
 */
import { activeElementIdBytes } from "./element-id-width.ts";
import { readRevit2027GInfo, revit2027GInfoBytes, type Revit2027GInfo } from "./revit-2027-grep-prefixes.ts";
import { usesRevit2027RecordLayout } from "./revit-class-tags.ts";

export const REVIT_2027_GBITMAP_SOURCE_CLASS_SLOT = 2221;
export const REVIT_2027_GCONDITION_SELECTED_SOURCE_CLASS_SLOT = 2239;

export type Revit2027GBitmap = {
  byteOffset: number;
  endOffset: number;
  gInfo: Revit2027GInfo;
  point: readonly [number, number, number];
  sizePixels: readonly [number, number];
  bitmapType: number;
  alignment: number;
};

export type Revit2027GConditionSelected = {
  byteOffset: number;
  endOffset: number;
  compareMode: number;
  viewElementId: number;
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Body length of a `GBitmap` in the current file. */
export function revit2027GBitmapBytes(): number {
  return revit2027GInfoBytes() + 24 + 8 + 4 + 4;
}

/** Body length of a `GConditionSelected` in the current file. */
export function revit2027GConditionSelectedBytes(): number {
  return 4 + activeElementIdBytes();
}

export function decodeRevit2027GBitmap(
  data: Uint8Array,
  byteOffset: number,
  bodyEndOffset: number,
  revitVersion: number,
): Result<Revit2027GBitmap> {
  if (!usesRevit2027RecordLayout(revitVersion)) {
    return { ok: false, error: "Revit 2027 GBitmap decoding requires release 2027" };
  }
  if (
    !Number.isSafeInteger(byteOffset) ||
    byteOffset < 0 ||
    bodyEndOffset > data.byteLength ||
    bodyEndOffset - byteOffset !== revit2027GBitmapBytes()
  ) {
    return { ok: false, error: "Revit 2027 GBitmap body has the wrong length" };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const at = byteOffset + revit2027GInfoBytes();
  const point = [view.getFloat64(at, true), view.getFloat64(at + 8, true), view.getFloat64(at + 16, true)] as const;
  if (!point.every(Number.isFinite)) {
    return { ok: false, error: "Revit 2027 GBitmap point is not finite" };
  }
  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: bodyEndOffset,
      gInfo: readRevit2027GInfo(view, byteOffset),
      point,
      sizePixels: [view.getUint32(at + 24, true), view.getUint32(at + 28, true)],
      bitmapType: view.getInt32(at + 32, true),
      alignment: view.getInt32(at + 36, true),
    },
  };
}

export function decodeRevit2027GConditionSelected(
  data: Uint8Array,
  byteOffset: number,
  bodyEndOffset: number,
  revitVersion: number,
): Result<Revit2027GConditionSelected> {
  if (!usesRevit2027RecordLayout(revitVersion)) {
    return { ok: false, error: "Revit 2027 GConditionSelected decoding requires release 2027" };
  }
  if (
    !Number.isSafeInteger(byteOffset) ||
    byteOffset < 0 ||
    bodyEndOffset > data.byteLength ||
    bodyEndOffset - byteOffset !== revit2027GConditionSelectedBytes()
  ) {
    return { ok: false, error: "Revit 2027 GConditionSelected body has the wrong length" };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const viewElementId = activeElementIdBytes() === 8
    ? Number(view.getBigInt64(byteOffset + 4, true))
    : view.getInt32(byteOffset + 4, true);
  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: bodyEndOffset,
      compareMode: view.getInt32(byteOffset, true),
      viewElementId,
    },
  };
}
