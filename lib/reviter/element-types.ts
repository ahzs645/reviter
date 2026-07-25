/**
 * Instance-to-type linkage and type names.
 *
 * A Revit element does not carry its family or type name. It carries the
 * element id of a *type* element, and that type element holds the name. Two
 * decoders are needed, and both work off the same record framing:
 *
 * ```text
 * ro+0    u32 element id
 * ro+4    u32 0
 * ro+8    8 bytes, neither all-zero nor all-ones
 * ro+16   u16 class discriminator A
 * ro+18   ff ff ff ff            // null-field marker
 * ro+22   u16 class discriminator B
 * ```
 *
 * **Type reference.** In records whose discriminator B is `0x0c93` — walls,
 * curtain walls, and openings — the type id follows the `0x116f` field slot:
 * skip its `[u32 n][n x (u32, u16)]` index list, then take the 64-bit value that
 * begins where the following zero run ends. Jumping to the *end* of the run
 * rather than assuming a fixed pad is what makes this work on curtain walls,
 * which otherwise return the type id shifted left by a byte.
 *
 * **Type name.** A type record stores its name behind the `0x1104` field slot,
 * as `ff ff ff ff 04 11 [u32 charCount][UTF-16LE]`.
 *
 * Verification against the paired IFC export, whose product names have the form
 * `Family:Type:ElementId`: the type reference is correct for **8,009 of 8,013**
 * walls, curtain walls and openings — 99.95% — and following it through to the
 * name reproduces the IFC family and type strings for **5,146 elements with no
 * disagreements**, across 34 distinct wall types.
 *
 * Scope: this covers system families, whose type records live in the same
 * partition. Loadable families — mullions, columns, furniture — keep their type
 * names inside family-document blobs elsewhere, and are not decoded here.
 */

/** Discriminator B of the records whose type reference this decoder reads. */
const TYPED_RECORD_DISCRIMINATOR = 0x0c93;

/** Field slot that precedes the type reference. */
const TYPE_REFERENCE_SLOT = [0xff, 0xff, 0xff, 0xff, 0x6f, 0x11] as const;

/** Field slot that precedes a type record's name string. */
const TYPE_NAME_SLOT = [0xff, 0xff, 0xff, 0xff, 0x04, 0x11] as const;

/** Bytes of a record searched for the type-reference slot. */
const RECORD_SEARCH_BYTES = 1_200;

/** Bytes searched past the slot's index list for the zero run. */
const ZERO_RUN_SEARCH_BYTES = 400;

/** Zero bytes that must precede the type id. */
const MIN_ZERO_RUN = 8;

const MIN_TYPE_ID = 8;
const MAX_TYPE_ID = 1 << 23;

const MAX_INDEX_ENTRIES = 500;
const MAX_NAME_CHARS = 200;

export type TypeReference = { elementId: number; typeId: number };
export type TypeNameRecord = { typeId: number; name: string };

export type TypeLinks = {
  references: TypeReference[];
  names: TypeNameRecord[];
};

function matchesAt(data: Uint8Array, offset: number, pattern: readonly number[]): boolean {
  if (offset + pattern.length > data.byteLength) return false;
  for (let index = 0; index < pattern.length; index += 1) {
    if (data[offset + index] !== pattern[index]) return false;
  }
  return true;
}

function findPattern(
  data: Uint8Array,
  pattern: readonly number[],
  from: number,
  to: number,
): number {
  const limit = Math.min(to, data.byteLength - pattern.length);
  for (let offset = Math.max(0, from); offset <= limit; offset += 1) {
    if (matchesAt(data, offset, pattern)) return offset;
  }
  return -1;
}

/** Read the type id that follows the `0x116f` slot, or `null`. */
function readTypeReference(
  data: Uint8Array,
  view: DataView,
  recordOffset: number,
): number | null {
  const slot = findPattern(
    data,
    TYPE_REFERENCE_SLOT,
    recordOffset,
    recordOffset + RECORD_SEARCH_BYTES,
  );
  if (slot < 0 || slot + 10 > data.byteLength) return null;

  const entries = view.getUint32(slot + 6, true);
  if (entries > MAX_INDEX_ENTRIES) return null;
  const afterIndex = slot + 10 + entries * 6;

  const limit = Math.min(data.byteLength - 8, afterIndex + ZERO_RUN_SEARCH_BYTES);
  let run = 0;
  for (let cursor = afterIndex + 4; cursor < limit; cursor += 1) {
    if (data[cursor] === 0) {
      run += 1;
      continue;
    }
    if (run >= MIN_ZERO_RUN) {
      // The id begins where the run ends, not at a fixed pad from the slot.
      if (view.getUint32(cursor + 4, true) !== 0) return null;
      const typeId = view.getUint32(cursor, true);
      return typeId >= MIN_TYPE_ID && typeId < MAX_TYPE_ID ? typeId : null;
    }
    run = 0;
  }
  return null;
}

/** Read the UTF-16 name behind the `0x1104` slot, or `null`. */
function readTypeName(data: Uint8Array, view: DataView, recordOffset: number): string | null {
  const slot = findPattern(data, TYPE_NAME_SLOT, recordOffset, recordOffset + RECORD_SEARCH_BYTES);
  if (slot < 0 || slot + 10 > data.byteLength) return null;
  const chars = view.getUint32(slot + 6, true);
  if (chars < 1 || chars > MAX_NAME_CHARS) return null;
  const start = slot + 10;
  if (start + chars * 2 > data.byteLength) return null;
  for (let index = 0; index < chars; index += 1) {
    const unit = view.getUint16(start + index * 2, true);
    if (unit < 0x20 || unit > 0x7e) return null;
  }
  return new TextDecoder("utf-16le").decode(data.subarray(start, start + chars * 2));
}

/**
 * Decode type references and type names from one inflated page. Records are
 * found structurally, by the null-field marker at `+18` and the zero word at
 * `+4`, so no prior list of element ids is needed.
 */
export function collectTypeLinks(data: Uint8Array): TypeLinks {
  const references: TypeReference[] = [];
  const names: TypeNameRecord[] = [];
  if (data.byteLength < 64) return { references, names };
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const seenReference = new Set<number>();
  const seenName = new Set<number>();

  for (
    let marker = data.indexOf(0xff, 18);
    marker >= 18 && marker + 6 <= data.byteLength;
    marker = data.indexOf(0xff, marker + 1)
  ) {
    if (view.getUint32(marker, true) !== 0xffff_ffff) continue;
    const recordOffset = marker - 18;
    if (recordOffset + 24 > data.byteLength) continue;

    const elementId = view.getUint32(recordOffset, true);
    if (!elementId || view.getUint32(recordOffset + 4, true) !== 0) continue;
    // The 8 bytes at +8 are a per-record stamp; all-zero or all-ones means this
    // is padding or a null slot rather than a record head.
    const low = view.getUint32(recordOffset + 8, true);
    const high = view.getUint32(recordOffset + 12, true);
    if ((low === 0 && high === 0) || (low === 0xffff_ffff && high === 0xffff_ffff)) continue;

    if (!seenName.has(elementId)) {
      const name = readTypeName(data, view, recordOffset);
      if (name) {
        seenName.add(elementId);
        names.push({ typeId: elementId, name });
      }
    }

    if (view.getUint16(recordOffset + 22, true) !== TYPED_RECORD_DISCRIMINATOR) continue;
    if (seenReference.has(elementId)) continue;
    const typeId = readTypeReference(data, view, recordOffset);
    if (typeId == null) continue;
    seenReference.add(elementId);
    references.push({ elementId, typeId });
  }

  return { references, names };
}
