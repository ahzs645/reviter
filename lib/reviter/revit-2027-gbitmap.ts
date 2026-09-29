import { registerReleaseMarker, releaseDecodersApply } from "./release-markers.ts";

export let REVIT_GBITMAP_SOURCE_CLASS_SLOT = registerReleaseMarker("GBitmap", 2221, value => { REVIT_GBITMAP_SOURCE_CLASS_SLOT = value; });
export const REVIT_GBITMAP_BODY_BYTES = 60;

/** GBitmap v3, verified against the embedded 2025 and 2027 schemas: GInfo,
 * three float64 coordinates, two int32 sizes, bitmap type and alignment.
 * This is a display marker, not a solid. Reading its exact span lets the
 * FIFO reach subsequent geometry without inventing a face for the bitmap.
 */
export function decodeRevitGBitmap(data: Uint8Array, byteOffset: number, bodyEndOffset: number, revitVersion: number) {
  if (!releaseDecodersApply(revitVersion) || !Number.isSafeInteger(byteOffset) ||
      !Number.isSafeInteger(bodyEndOffset) || byteOffset < 0 || bodyEndOffset > data.length ||
      bodyEndOffset - byteOffset !== REVIT_GBITMAP_BODY_BYTES)
    return { ok: false as const, error: "GBitmap requires its exact 60-byte body and a supported release" };
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const point = [20,28,36].map(at => v.getFloat64(byteOffset + at, true));
  const size = [44,48].map(at => v.getInt32(byteOffset + at, true));
  if (!point.every(Number.isFinite) || size.some(x => x < 0))
    return { ok: false as const, error: "GBitmap has invalid point or size" };
  return { ok: true as const, value: { byteOffset, endOffset: bodyEndOffset,
    gInfo: { gStyleElementId: v.getBigInt64(byteOffset, true), tag: v.getInt32(byteOffset + 8, true),
      controlCommand: v.getInt32(byteOffset + 12, true), flags: v.getUint32(byteOffset + 16, true) },
    point, size, bitmapType: v.getInt32(byteOffset + 52, true), alignment: v.getInt32(byteOffset + 56, true) } };
}
