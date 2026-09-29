import { readRevit2027GInfo, revit2027GInfoShrink, type Revit2027GInfo } from "./revit-2027-grep-prefixes.ts";
import { fileClassFieldCount, usesRevit2027RecordLayout } from "./revit-class-tags.ts";

/** Exact Revit 2027 source slot for persisted `GPoint`. */
export const REVIT_2027_GPOINT_SOURCE_CLASS_SLOT = 2271;
export const REVIT_2027_GPOINT_BODY_BYTES = 56;

const GINFO_BYTES = 20;

/**
 * Whether the file's `GPoint` has no `m_borderSize`: the 2019 to 2022 schemas
 * declare version 3, three fields (`m_coord`, `m_size`, `m_pointFlags`), and
 * the body is four bytes shorter.
 */
function withoutBorderSize(): boolean {
  return fileClassFieldCount(REVIT_2027_GPOINT_SOURCE_CLASS_SLOT) === 3;
}

/** Bytes of a `GPoint` body in the current file. */
export function revit2027GPointBodyBytes(): number {
  return REVIT_2027_GPOINT_BODY_BYTES - revit2027GInfoShrink() - (withoutBorderSize() ? 4 : 0);
}

export type Revit2027GPoint = {
  byteOffset: number;
  endOffset: number;
  gInfo: Revit2027GInfo;
  coordinate: readonly [number, number, number];
  size: number;
  /** 0 where the schema declares no border size. */
  borderSize: number;
  pointFlags: number;
};

export type Revit2027GPointDecodeResult =
  | { ok: true; value: Revit2027GPoint }
  | { ok: false; error: string };

/**
 * Decode one schema-complete Revit 2027 `GPoint` body.
 *
 * The embedded schema declares a GNode/GInfo base followed by the float64
 * coordinate triple and three int32 display fields. A point may participate
 * in a GFilter condition but contributes no solid triangles by itself.
 */
export function decodeRevit2027GPoint(
  data: Uint8Array,
  byteOffset: number,
  bodyEndOffset: number,
  revitVersion: number,
): Revit2027GPointDecodeResult {
  if (!usesRevit2027RecordLayout(revitVersion)) {
    return {
      ok: false,
      error: "Revit 2027 GPoint decoding requires release 2027",
    };
  }
  if (
    !Number.isSafeInteger(byteOffset) ||
    !Number.isSafeInteger(bodyEndOffset) ||
    byteOffset < 0 ||
    bodyEndOffset > data.byteLength ||
    bodyEndOffset - byteOffset !== revit2027GPointBodyBytes()
  ) {
    return {
      ok: false,
      error: "Revit 2027 GPoint body is not exactly 56 bytes",
    };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // Fields after GInfo sit 4 bytes nearer where ids are 32-bit.
  const fieldBase = byteOffset - revit2027GInfoShrink();
  const coordinate = [
    view.getFloat64(fieldBase + GINFO_BYTES, true),
    view.getFloat64(fieldBase + GINFO_BYTES + 8, true),
    view.getFloat64(fieldBase + GINFO_BYTES + 16, true),
  ] as const;
  if (!coordinate.every(Number.isFinite)) {
    return {
      ok: false,
      error: "Revit 2027 GPoint coordinate contains a non-finite scalar",
    };
  }
  const size = view.getInt32(fieldBase + 44, true);
  const bordered = !withoutBorderSize();
  const borderSize = bordered ? view.getInt32(fieldBase + 48, true) : 0;
  if (size < 0 || borderSize < 0) {
    return {
      ok: false,
      error: "Revit 2027 GPoint display size is negative",
    };
  }

  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: bodyEndOffset,
      gInfo: readRevit2027GInfo(view, byteOffset),
      coordinate,
      size,
      borderSize,
      pointFlags: view.getInt32(fieldBase + (bordered ? 52 : 48), true),
    },
  };
}
