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
 * S+16           u16 marker        // constant per release, e.g. 0x08c6 in 2027
 * S+18           u64 type code     // element class discriminator
 * S+26           u64 element id, repeated
 * ...            payload, including the duplicated-bounds sub-record
 * S+objLen+16    u32 objLen        // echoed
 * S+objLen+20    next object
 * ```
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

/** Objects are well under 64 KB; anything larger is a misread length. */
const MAX_OBJECT_BYTES = 0xffff;

/** Below this an "object" cannot hold even its own header and trailer. */
const MIN_OBJECT_BYTES = 40;

/** Bytes of trailer after the object body, the last four being the echo. */
const TRAILER_BYTES = 20;

/** Offset within the trailer at which the length is echoed. */
const ECHO_OFFSET = 16;

export type ElementObject = {
  /** Offset of the object start within the inflated page. */
  offset: number;
  elementId: number;
  /** Object length in bytes, excluding the 20-byte trailer. */
  objectLength: number;
  /** Release-specific object marker at `offset + 16`. */
  marker: number;
  /** Element class discriminator at `offset + 18`. */
  typeCode: number;
};

function readObject(view: DataView, offset: number, byteLength: number): ElementObject | null {
  if (offset < 0 || offset + 20 > byteLength) return null;
  const objectLength = view.getUint32(offset + 12, true);
  if (objectLength < MIN_OBJECT_BYTES || objectLength > MAX_OBJECT_BYTES) return null;
  const echoAt = offset + objectLength + ECHO_OFFSET;
  if (echoAt + 4 > byteLength) return null;
  if (view.getUint32(echoAt, true) !== objectLength) return null;

  const elementId = view.getUint32(offset, true);
  if (!elementId || view.getUint32(offset + 4, true) !== 0) return null;

  return {
    offset,
    elementId,
    objectLength,
    marker: view.getUint16(offset + 16, true),
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
export const DEFAULT_OBJECT_MARKER = 0x08c6;

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
export function scanFramedObjectClasses(data: Uint8Array): Map<number, number> {
  const classes = new Map<number, number>();
  if (data.byteLength < 64) return classes;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let offset = 0; offset + 24 <= data.byteLength; offset += 1) {
    if (data[offset + 4] !== 0 || data[offset + 5] !== 0) continue;
    if (data[offset + 6] !== 0 || data[offset + 7] !== 0) continue;
    const object = readObject(view, offset, data.byteLength);
    if (!object || classes.has(object.elementId)) continue;
    classes.set(object.elementId, object.marker);
  }
  return classes;
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
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const low = marker & 0xff;
  const high = (marker >> 8) & 0xff;

  for (
    let offset = data.indexOf(low, 16);
    offset >= 0 && offset + 1 < data.byteLength;
    offset = data.indexOf(low, offset + 1)
  ) {
    if (data[offset + 1] !== high) continue;
    if (readObject(view, offset - 16, data.byteLength)) seeds.push(offset - 16);
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

  for (const seed of seeds) {
    if (found.has(seed)) continue;
    const start = readObject(view, seed, data.byteLength);
    if (!start) continue;
    found.set(seed, start);

    // Forward: the next object begins immediately after this one's trailer.
    let cursor = seed;
    let current: ElementObject | null = start;
    while (current) {
      cursor = cursor + current.objectLength + TRAILER_BYTES;
      if (found.has(cursor)) break;
      current = readObject(view, cursor, data.byteLength);
      if (current) found.set(cursor, current);
    }

    // Backward: the previous object's length sits four bytes before this one.
    cursor = seed;
    while (cursor >= TRAILER_BYTES + 4) {
      const previousLength = view.getUint32(cursor - 4, true);
      if (previousLength < MIN_OBJECT_BYTES || previousLength > MAX_OBJECT_BYTES) break;
      const previous = cursor - TRAILER_BYTES - previousLength;
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
