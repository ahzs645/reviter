/**
 * The element-header sequence: every element's own header record, and the
 * category it names.
 *
 * A partition stream interleaves three logical sequences, named in each
 * block's header (`readPartitionBlockHeader`). Sequence 101 is a run of
 * fixed-framed records, one per element:
 *
 * ```text
 * i64  elementId          // all ones for a null record, which has an empty body
 * u32  bodyBytes
 * u16  classIndex         // ElementHeader, in the file's own schema
 * u16  entryCount         // the reference entries that open the body
 * ...  body
 * ```
 *
 * Measured 2026-09-11: the walk stays aligned to the last byte on a Revit 2024
 * file (257,890 records), a 2025 file (59,707) and the 2027 project (112,893),
 * and every record's class is `ElementHeader`. The body opens with
 * `entryCount` 22-byte reference entries and then, behind a field tag that
 * varies, the element's `BuiltInCategory` as a negative i64 followed by
 * `ff ff ff ff`; a record whose category is null carries none. The category is
 * therefore read as the first value in the BuiltInCategory window inside the
 * record's own body — so its owner is the record's id, exactly, rather than
 * the nearest preceding id in a page as the token scan has to guess.
 *
 * Against the 2027 project's token-derived categories the two agree on 38,718
 * of 38,788 elements; the 70 disagreements are drawing aids whose token was
 * donated by a neighbour. On the 2024 Snowdon model the token scan labelled
 * 45 walls the Autodesk viewer draws as `Sun Path`; their headers say `Walls`,
 * behind 105 reference entries, at body offset 2,312.
 */

import { registerReleaseMarker } from "./release-markers.ts";

/** `ElementHeader` in the 2027 schema; resolved per file like every marker. */
export let ELEMENT_HEADER_CLASS = registerReleaseMarker("ElementHeader", 0x0604, (value) => { ELEMENT_HEADER_CLASS = value; });

const RECORD_HEADER_BYTES = 16;

/** Revit BuiltInCategory ids are dense in this window; anything else is noise. */
const CATEGORY_ID_MIN = -2_100_000;
const CATEGORY_ID_MAX = -1_999_000;

export type ElementHeaderRecord = {
  elementId: number;
  /** The element's own BuiltInCategory, or null when the header carries none. */
  categoryId: number | null;
  bodyBytes: number;
  entryCount: number;
};

export type ElementHeaderWalk = {
  records: ElementHeaderRecord[];
  /** Records whose class was not ElementHeader; counted, not decoded. */
  otherClassRecords: number;
  /** Set when the framing stopped fitting before the block's end. */
  misalignedAt: number | null;
};

/** The first BuiltInCategory value in a record body, or null. */
function categoryInBody(view: DataView, data: Uint8Array, start: number, end: number): number | null {
  for (let at = start; at + 12 <= end; at += 1) {
    if (data[at + 4] !== 0xff || data[at + 5] !== 0xff || data[at + 6] !== 0xff || data[at + 7] !== 0xff) continue;
    if (data[at + 8] !== 0xff || data[at + 9] !== 0xff || data[at + 10] !== 0xff || data[at + 11] !== 0xff) continue;
    const categoryId = view.getUint32(at, true) - 0x1_0000_0000;
    if (categoryId > CATEGORY_ID_MIN && categoryId < CATEGORY_ID_MAX) return categoryId;
  }
  return null;
}

/**
 * Walk one whole-records block of the element-header sequence.
 *
 * Only blocks whose header says "whole records only" are walked; a block
 * that opens mid-record would need the previous block's tail, and no
 * sequence-101 block on the measured files has ever needed one.
 */
export function walkElementHeaderBlock(page: Uint8Array): ElementHeaderWalk {
  const records: ElementHeaderRecord[] = [];
  let otherClassRecords = 0;
  let misalignedAt: number | null = null;
  const view = new DataView(page.buffer, page.byteOffset, page.byteLength);
  let at = 0;
  while (at + RECORD_HEADER_BYTES <= page.byteLength) {
    const elementId = view.getUint32(at, true);
    const idHigh = view.getUint32(at + 4, true);
    const bodyBytes = view.getUint32(at + 8, true);
    const classIndex = view.getUint16(at + 12, true);
    const entryCount = view.getUint16(at + 14, true);
    const nullRecord = elementId === 0xffff_ffff && idHigh === 0xffff_ffff;
    const bodyStart = at + RECORD_HEADER_BYTES;
    const bodyEnd = bodyStart + bodyBytes;
    if ((idHigh !== 0 && !nullRecord) || bodyEnd > page.byteLength) {
      misalignedAt = at;
      break;
    }
    if (!nullRecord) {
      if (classIndex === ELEMENT_HEADER_CLASS) {
        records.push({
          elementId,
          categoryId: categoryInBody(view, page, bodyStart, bodyEnd),
          bodyBytes,
          entryCount,
        });
      } else {
        otherClassRecords += 1;
      }
    }
    at = bodyEnd;
  }
  return { records, otherClassRecords, misalignedAt };
}
