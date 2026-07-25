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
