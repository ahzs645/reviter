/**
 * The element object envelope in `Partitions/*`.
 *
 * Elements are length-delimited, and the length is written **behind** the
 * object, not in front of it:
 *
 * ```text
 * S+0            u64 element id
 * S+8            u32 near-unique discriminator (not decoded)
 * S+12           u32 objLen        // object length, counted from S
 * S+16           u16 marker        // the object's schema class index
 * S+18           ...               // the class's fields, then the objects its
 *                                  // pointer fields deferred
 * S+objLen+16    u32 objLen        // echoed
 * S+objLen+20    next object
 * ```
 *
 * The body runs from S+18 to S+objLen+16 with nothing spare: the sixteen bytes
 * before the echo used to read as release-specific padding, and they are
 * ordinary fields. Records that defer no objects at all end exactly there, so
 * the reading does not depend on knowing what the deferred region holds.
 *
 * The marker is the class index in the file's own `Formats/Latest`, which
 * `schema-reader.ts` reads; `0x08c6` is `GElement` in the 2027 project. It is
 * still measured from the file rather than assumed, because a class index moves
 * between releases.
 *
 * The echo is what makes the framing safe to walk. Over the 2027 project it
 * holds for 99.51% of known records, while probing the echo at +12 or +20
 * instead of +16, or testing for `objLen ± 4`, all score 0%, and shifting the
 * whole probe a megabyte away scores 0.06%. Reading the length as a *header*
 * instead scores only 61.7%, and its failures come in symmetric pairs — the
 * signature of reading the previous object's length — so the trailer reading is
 * the correct one.
 *
 * Chaining from known records recovers substantially more elements than
 * scanning for bounds records alone, because objects without a bounds record
 * are still linked into the chain.
 */

import { frameHeaderBytes, narrowElementIds } from "./element-id-width.ts";
import { REVIT_2027_ELEMENT_HEADER_CLASS } from "./element-headers.ts";
import { canonicalClassTag, fileClassDeclared, fileClassTag } from "./revit-class-tags.ts";

/**
 * General page-scanner ceiling. Most element frames are below 64 KB; the
 * bounded release-specific collectors handle the proven large collection
 * carriers without weakening this broad byte-by-byte scanner's false-positive
 * guard.
 */
export const MAX_SCANNED_OBJECT_BYTES = 0xffff;

/** Below this an "object" cannot hold even its own header and trailer. */
const MIN_OBJECT_BYTES = 40;

/**
 * Bytes after the stored object-length boundary through the echo. Exact
 * Revit 2027 GLine records prove the first 16 can still be serialized payload
 * in that release.
 */
const TRAILER_BYTES = 20;

/** Offset within the trailer at which the length is echoed. */
const ECHO_OFFSET = 16;

/**
 * The same envelope where element ids are 32-bit (Revit 2023 and older; see
 * `element-id-width.ts`): `[u32 id][u32 discriminator][u32 length][u16 class]`.
 * The length still counts from the class to the echo, so the echo is at
 * `S + length + 12` and the next object at `S + length + 16`.
 */
const NARROW_HEADER_BYTES = 12;
const NARROW_ECHO_OFFSET = 12;
const NARROW_TRAILER_BYTES = 16;

export type ElementObject = {
  /** Offset of the object start within the inflated page. */
  offset: number;
  elementId: number;
  /**
   * Stored object-length boundary. Release-specific decoding may continue for
   * 16 bytes before the echoed length; the next independently framed object
   * begins at +20.
   */
  objectLength: number;
  /**
   * The object's class at `offset + 16` (`offset + 12` where ids are 32-bit),
   * in the 2027 numbering: the file's own index translated by class name (see
   * `revit-class-tags.ts`).
   */
  marker: number;
  /** The first u32 after the class: `offset + 18` (`offset + 14` where ids are 32-bit). */
  typeCode: number;
};

/**
 * A 12-byte-header object at `offset`, or null.
 *
 * Where ids are 32-bit there is no zero high word to test, and two things the
 * wide layout's high word rules out have to be ruled out explicitly:
 *
 *  - **An `ElementHeader` read four bytes early.** An element's
 *    `ElementHeader` is written as a plain record, `[id][u32 length][class]`,
 *    with no discriminator; in the 2025 RAC sample 85,740 records of that class
 *    are written so and none with a discriminator, and no other class is
 *    written so more than a few dozen times. Read from four bytes before it,
 *    the previous object's echo becomes an id, the header's own id a
 *    discriminator, and the length and echo still agree. So a frame headed by
 *    `ElementHeader` is never a frame (85,268 such readings in the 2023 RAC
 *    sample).
 *  - **Repetitive data.** A run of equal words (`00 01 00 00` repeated, 99,449
 *    readings in the 2023 RAC sample) frames itself: id, discriminator, length,
 *    class and echo all read the same value. The class must be one the
 *    file's schema declares, the id a non-negative `int32`, and the
 *    discriminator, a hash-like word that differs between the 2023 and 2025
 *    copies of the same element, must not repeat the length.
 */
function readNarrowObject(view: DataView, offset: number, byteLength: number): ElementObject | null {
  if (offset < 0 || offset + NARROW_HEADER_BYTES + 6 > byteLength) return null;
  const objectLength = view.getUint32(offset + 8, true);
  if (
    objectLength < MIN_OBJECT_BYTES ||
    objectLength > MAX_SCANNED_OBJECT_BYTES
  ) return null;
  const echoAt = offset + objectLength + NARROW_ECHO_OFFSET;
  if (echoAt + 4 > byteLength) return null;
  if (view.getUint32(echoAt, true) !== objectLength) return null;

  // `Identifier.m_id` is an int32, and a negative id is a built-in or invalid one.
  const elementId = view.getUint32(offset, true);
  if (!elementId || elementId > 0x7fff_ffff) return null;
  const discriminator = view.getUint32(offset + 4, true);
  if (discriminator === objectLength) return null;
  const fileClass = view.getUint16(offset + 12, true);
  if (!fileClassDeclared(fileClass)) return null;
  // Tables of small counts written a word apart (`00 01 00 00 00 02 00 00`)
  // put a zero low byte under the discriminator, the length and the class at
  // once; a real frame's hash-like discriminator does that one time in 256.
  if ((discriminator & 0xff) === 0 && (objectLength & 0xff) === 0 && (fileClass & 0xff) === 0) {
    return null;
  }
  const marker = canonicalClassTag(fileClass);
  if (marker === REVIT_2027_ELEMENT_HEADER_CLASS) return null;

  return {
    offset,
    elementId,
    objectLength,
    marker,
    typeCode: view.getUint32(offset + 14, true),
  };
}

/**
 * Every narrow-layout object on a page. A length of at most 0xffff has two
 * zero high bytes, which rejects most offsets before the echo is read.
 */
function scanNarrowFrames(data: Uint8Array): ElementObject[] {
  const objects: ElementObject[] = [];
  if (data.byteLength < 64) return objects;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let offset = 0; offset + 20 <= data.byteLength; offset += 1) {
    if (data[offset + 10] !== 0 || data[offset + 11] !== 0) continue;
    const object = readNarrowObject(view, offset, data.byteLength);
    if (object) objects.push(object);
  }
  return objects;
}

function readObject(view: DataView, offset: number, byteLength: number): ElementObject | null {
  if (narrowElementIds()) return readNarrowObject(view, offset, byteLength);
  if (offset < 0 || offset + 20 > byteLength) return null;
  const objectLength = view.getUint32(offset + 12, true);
  if (
    objectLength < MIN_OBJECT_BYTES ||
    objectLength > MAX_SCANNED_OBJECT_BYTES
  ) return null;
  const echoAt = offset + objectLength + ECHO_OFFSET;
  if (echoAt + 4 > byteLength) return null;
  if (view.getUint32(echoAt, true) !== objectLength) return null;

  const elementId = view.getUint32(offset, true);
  if (!elementId || view.getUint32(offset + 4, true) !== 0) return null;

  return {
    offset,
    elementId,
    objectLength,
    marker: canonicalClassTag(view.getUint16(offset + 16, true)),
    // Read as u32: the field is 64-bit but element class codes are small, and
    // 0xffffffff is itself a real code in the corpus.
    typeCode: view.getUint32(offset + 18, true),
  };
}

/**
 * The 2027 object marker, used to seed a page that yields no bounds record.
 * Measured per file elsewhere; here it is only a starting guess that every
 * candidate is then made to justify through the length echo.
 */
const DEFAULT_OBJECT_MARKER = 0x08c6;

/**
 * Which markers head verified objects on this page, and how many each heads.
 *
 * `0x08c6` is not the only object class in the stream. Scanning one page for the
 * framing itself — a zero high word on the id, a length in range, and the
 * trailer echoing that length — turns up several more, and one of them,
 * `0x07ef`, heads the objects of 4,312 elements the paired export knows about
 * and no other pass sees. The markers are therefore measured from the file
 * rather than listed in the source, which also keeps this working across
 * releases, where the tags drift.
 *
 * This walks every byte offset, so it is meant for calibrating on a sample of
 * pages, not for running over a whole stream.
 */
export function scanObjectMarkers(data: Uint8Array): Map<number, number> {
  const markers = new Map<number, number>();
  if (data.byteLength < 64) return markers;
  if (narrowElementIds()) {
    for (const object of scanNarrowFrames(data)) {
      markers.set(object.marker, (markers.get(object.marker) ?? 0) + 1);
    }
    return markers;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let offset = 0; offset + 24 <= data.byteLength; offset += 1) {
    // The id's high word is zero, which is four byte compares and rejects
    // almost every offset before anything more expensive happens.
    if (data[offset + 4] !== 0 || data[offset + 5] !== 0) continue;
    if (data[offset + 6] !== 0 || data[offset + 7] !== 0) continue;
    const object = readObject(view, offset, data.byteLength);
    if (!object) continue;
    markers.set(object.marker, (markers.get(object.marker) ?? 0) + 1);
  }
  return markers;
}

/**
 * Every framed object on a page, as `element id -> marker`.
 *
 * The chain is seeded from the markers a sample of pages says are common, and
 * that is the right trade for *recovering objects* — but it means a class with a
 * dozen members in the whole file is only ever reached by chaining off a
 * neighbour, and the small classes are exactly the ones written on their own
 * pages. Measured over the supplied project: **157,553 framed objects under 779
 * distinct markers**, against the one marker (`0x08c6`) that clears the sample
 * support floor. `0x0d7b` heads 12 objects in the entire file, `0x0d40` twenty,
 * `0x0ff0` eighteen.
 *
 * This is deliberately *not* used to add objects to the model. Its output is a
 * class key and nothing else: the marker is read, the object is not. Every
 * candidate still has to echo its own length, which is the same test the chain
 * applies, so a false marker costs a rejected candidate rather than a bad
 * object.
 *
 * The zero high word on the id rejects almost every offset in four byte
 * compares, which is what keeps a whole-stream walk affordable: over the
 * supplied project it reads 417 MB of inflated pages in **3.9 s**, against the
 * 12.9 s the same pages cost to inflate.
 */
export function scanFramedObjectClassEvidence(
  data: Uint8Array,
  trackedMarkers: ReadonlySet<number> = new Set(),
  seedMarkers: ReadonlySet<number> = new Set(),
): {
  classes: Map<number, number>;
  trackedByElement: Map<number, Set<number>>;
  seedOffsets: number[];
} {
  const classes = new Map<number, number>();
  const trackedByElement = new Map<number, Set<number>>();
  const seedOffsets: number[] = [];
  if (data.byteLength < 64) return { classes, trackedByElement, seedOffsets };
  const record = (object: ElementObject): void => {
    if (seedMarkers.has(object.marker)) seedOffsets.push(object.offset);
    if (!classes.has(object.elementId)) {
      classes.set(object.elementId, object.marker);
    }
    if (trackedMarkers.has(object.marker)) {
      const markers = trackedByElement.get(object.elementId) ?? new Set<number>();
      markers.add(object.marker);
      trackedByElement.set(object.elementId, markers);
    }
  };
  if (narrowElementIds()) {
    for (const object of scanNarrowFrames(data)) record(object);
    return { classes, trackedByElement, seedOffsets };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let offset = 0; offset + 24 <= data.byteLength; offset += 1) {
    if (data[offset + 4] !== 0 || data[offset + 5] !== 0) continue;
    if (data[offset + 6] !== 0 || data[offset + 7] !== 0) continue;
    const object = readObject(view, offset, data.byteLength);
    if (object) record(object);
  }
  return { classes, trackedByElement, seedOffsets };
}

export function scanFramedObjectClasses(data: Uint8Array): Map<number, number> {
  return scanFramedObjectClassEvidence(data).classes;
}

/**
 * Every independently length/echo-framed object on one inflated page.
 *
 * Unlike `chainElementObjects`, this is an audit-oriented full-page scan: it
 * does not infer neighbours from a seed. Callers that need byte ownership can
 * therefore ask whether an opaque candidate is contained by a proven outer
 * element object without treating proximity as framing.
 */
export function scanFramedElementObjects(data: Uint8Array): ElementObject[] {
  if (narrowElementIds()) return scanNarrowFrames(data);
  const objects: ElementObject[] = [];
  if (data.byteLength < 64) return objects;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let offset = 0; offset + 24 <= data.byteLength; offset += 1) {
    if (data[offset + 4] !== 0 || data[offset + 5] !== 0) continue;
    if (data[offset + 6] !== 0 || data[offset + 7] !== 0) continue;
    const object = readObject(view, offset, data.byteLength);
    if (!object) continue;
    objects.push(object);
  }
  return objects;
}

/**
 * What category a marker's elements are, where its members agree outright.
 *
 * An element's `BuiltInCategory` token is not always written — the supplied
 * project holds exactly 8 `Ramps` tokens against 12 ramps — and an element with
 * no token is invisible to every rule gated on the category. The object marker
 * is a class discriminator the same element does have, so the members that *do*
 * carry a token can speak for the ones that do not.
 *
 * This is not a general category decoder and must not be used as one: the
 * README records that marker consensus applied to every element gives 4,859 of
 * them a category the export agrees with 456 times and **disagrees with 265**.
 * It is offered for the one question where an element's alternative is nothing
 * at all — whether a record-less element's boundary ring is a building
 * element's.
 *
 * Support and purity trade the way `deriveRecordCodeCategories` already trades
 * them, and the threshold is a plateau rather than a fit: over the supplied
 * project every floor from `support >= 1, purity 1` to `support >= 7, purity 1`
 * selects the same 42 elements, of which the paired export names **42**, against
 * 843 candidates of which it names 67. Loosening purity to 0.7 selects 35, so
 * nothing is bought by it. Null control — permuting which marker holds which
 * consensus category, over ten shifts — selects 23.1 elements per trial and the
 * export names 8.0 of them.
 */
export function markerCategoryConsensus(
  markerByElement: Map<number, number>,
  categoryByElement: Map<number, number>,
  { minSupport = 3, minPurity = 1 }: { minSupport?: number; minPurity?: number } = {},
): Map<number, number> {
  const tally = new Map<number, Map<number, number>>();
  for (const [elementId, categoryId] of categoryByElement) {
    const marker = markerByElement.get(elementId);
    if (marker == null) continue;
    const row = tally.get(marker) ?? new Map<number, number>();
    row.set(categoryId, (row.get(categoryId) ?? 0) + 1);
    tally.set(marker, row);
  }

  const consensus = new Map<number, number>();
  for (const [marker, row] of tally) {
    let best = 0;
    let bestCount = 0;
    let support = 0;
    for (const [categoryId, count] of row) {
      support += count;
      if (count > bestCount) {
        bestCount = count;
        best = categoryId;
      }
    }
    if (support >= minSupport && bestCount / support >= minPurity) consensus.set(marker, best);
  }
  return consensus;
}

/**
 * Candidate object starts found from the marker alone.
 *
 * Chaining is normally seeded from bounds records, but a page that contains no
 * bounds record then goes unwalked entirely — and with it every placement and
 * shared shape it holds. The marker sits at a fixed `+16`, so a page can seed
 * itself: each hit is proposed as an object start and kept only if `readObject`
 * confirms it, which means its trailer echoes its own length. That is the same
 * test the chain walk applies, so a false marker costs a rejected candidate
 * rather than a bad object.
 */
export function markerObjectSeeds(
  data: Uint8Array,
  marker: number = DEFAULT_OBJECT_MARKER,
): number[] {
  const seeds: number[] = [];
  if (data.byteLength < 64) return seeds;
  // The bytes hold the file's own index for the class, not the 2027 one.
  const fileMarker = fileClassTag(marker);
  if (fileMarker < 0 || fileMarker > 0xffff) return seeds;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const low = fileMarker & 0xff;
  const high = (fileMarker >> 8) & 0xff;
  const header = frameHeaderBytes();

  for (
    let offset = data.indexOf(low, header);
    offset >= 0 && offset + 1 < data.byteLength;
    offset = data.indexOf(low, offset + 1)
  ) {
    if (data[offset + 1] !== high) continue;
    if (readObject(view, offset - header, data.byteLength)) seeds.push(offset - header);
  }
  return seeds;
}

/**
 * Walk the object chain through an inflated page, seeded from offsets already
 * known to be objects. Walking both directions from a seed recovers neighbours
 * that carry no bounds record and would otherwise be invisible.
 */
export function chainElementObjects(data: Uint8Array, seeds: Iterable<number>): ElementObject[] {
  const found = new Map<number, ElementObject>();
  if (data.byteLength < 64) return [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const trailer = narrowElementIds() ? NARROW_TRAILER_BYTES : TRAILER_BYTES;

  for (const seed of seeds) {
    if (found.has(seed)) continue;
    const start = readObject(view, seed, data.byteLength);
    if (!start) continue;
    found.set(seed, start);

    // Forward: the next object begins immediately after this one's trailer.
    let cursor = seed;
    let current: ElementObject | null = start;
    while (current) {
      cursor = cursor + current.objectLength + trailer;
      if (found.has(cursor)) break;
      current = readObject(view, cursor, data.byteLength);
      if (current) found.set(cursor, current);
    }

    // Backward: the previous object's length sits four bytes before this one.
    cursor = seed;
    while (cursor >= trailer + 4) {
      const previousLength = view.getUint32(cursor - 4, true);
      if (
        previousLength < MIN_OBJECT_BYTES ||
        previousLength > MAX_SCANNED_OBJECT_BYTES
      ) break;
      const previous = cursor - trailer - previousLength;
      if (previous < 0 || found.has(previous)) break;
      const object = readObject(view, previous, data.byteLength);
      if (!object || object.objectLength !== previousLength) break;
      found.set(previous, object);
      cursor = previous;
    }
  }

  return [...found.values()].sort((a, b) => a.offset - b.offset);
}

/**
 * The object marker drifts between Revit releases exactly as schema tags do —
 * 0x086d in 2024, 0x08a4 in 2025, 0x08cc in 2026, 0x08c6 in the 2027 project —
 * so it is measured from the file rather than hard-coded.
 */
export function dominantMarker(objects: ElementObject[]): number | null {
  if (!objects.length) return null;
  const counts = new Map<number, number>();
  for (const object of objects) counts.set(object.marker, (counts.get(object.marker) ?? 0) + 1);
  let best = 0;
  let bestCount = 0;
  for (const [marker, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = marker;
    }
  }
  return bestCount / objects.length >= 0.5 ? best : null;
}
