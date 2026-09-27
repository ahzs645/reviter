/**
 * A `Level` element's own name and elevation.
 *
 * `Level` derives from `DatumPlane`, whose first field `m_text` is the level's
 * name and follows directly on `Element`'s own fields. The elevation is written
 * twice in the record; one copy sits 40 bytes before the stored object-length
 * boundary in every level record of the supplied files, whatever the record's
 * length or release.
 *
 * Measured against the Autodesk Viewer property database of the same files,
 * both are exact for every level Autodesk lists: 13 of 13 in the 2027 UNBC
 * project, 5 of 5 in the 2025 technical school, 6 of 6 in the 2025 RAC sample
 * and 18 of 18 in the 2024 Snowdon sample, names character for character and
 * elevations to within 1e-4 ft.
 *
 * The storey list used to take each level's elevation as the median base of
 * its members, which is right only where a storey's elements start at its
 * level: in the technical school it put "01 - Entry Level" (elevation 0) at
 * 12.53 ft and "02 - Floor" (12.47 ft) at 19.05 ft.
 *
 * **Where ids are 32-bit** (Revit 2023 and older; `element-id-width.ts`) the
 * elevation copy is still 56 bytes before the echoed length, which the
 * 12-byte frame header puts 44 bytes before the stored boundary rather than
 * 40. The name starts 36 bytes earlier than in 2025, after `Element`'s fields
 * with their ids narrowed: at +91 to +97 from the frame for all 108 levels of
 * the 2023 RAC sample against +127 to +133 in the 2025 copy. Read so, the six
 * levels Autodesk lists for the 2025 copy come out of the 2023 file with the
 * same names and elevations.
 */
import { frameHeaderBytes, narrowElementIds } from "./element-id-width.ts";
import type { ElementObject } from "./element-objects.ts";

/** `Level` in the 2027 numbering. */
export const REVIT_2027_LEVEL_CLASS = 0x0a19;

/** Where `DatumPlane.m_text` may start, after `Element`'s own fields. */
const NAME_SEARCH_START = 100;
const NAME_SEARCH_END = 220;
const MAX_NAME_CHARS = 200;

/** How much earlier the name starts where ids are 32-bit. */
const NARROW_NAME_SHIFT = 36;

/** The elevation copy, measured back from the echoed length. */
const ELEVATION_BEFORE_ECHO = 56;

/** Elevations in feet stay well inside this. */
const MAX_ELEVATION_FEET = 100_000;

export type LevelDefinition = {
  levelId: number;
  name: string;
  /** In the same internal feet as every recovered record. */
  elevationFeet: number;
};

function readName(data: Uint8Array, view: DataView, frame: ElementObject): string | null {
  const end = frame.offset + frame.objectLength;
  const shift = narrowElementIds() ? NARROW_NAME_SHIFT : 0;
  for (
    let at = frame.offset + NAME_SEARCH_START - shift;
    at + 4 <= Math.min(end, frame.offset + NAME_SEARCH_END - shift);
    at += 1
  ) {
    const characters = view.getUint32(at, true);
    if (characters < 1 || characters > MAX_NAME_CHARS) continue;
    const stop = at + 4 + characters * 2;
    if (stop > end) continue;
    const text = new TextDecoder("utf-16le").decode(data.subarray(at + 4, stop));
    if (/^[^\u0000-\u001f\u007f�]+$/u.test(text) && /[\p{L}\p{N}]/u.test(text)) {
      return text.normalize("NFC");
    }
  }
  return null;
}

/** The level definition a framed `Level` object states, or null. */
export function readLevelDefinition(
  data: Uint8Array,
  frame: ElementObject,
): LevelDefinition | null {
  if (frame.marker !== REVIT_2027_LEVEL_CLASS) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const echoAt = frame.offset + frame.objectLength + frameHeaderBytes();
  const elevationAt = echoAt - ELEVATION_BEFORE_ECHO;
  if (elevationAt < frame.offset || elevationAt + 8 > data.byteLength) return null;
  const elevationFeet = view.getFloat64(elevationAt, true);
  if (!Number.isFinite(elevationFeet) || Math.abs(elevationFeet) > MAX_ELEVATION_FEET) return null;
  const name = readName(data, view, frame);
  if (!name) return null;
  return { levelId: frame.elementId, name, elevationFeet };
}
