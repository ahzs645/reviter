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
 *
 * That limit is structural rather than a matter of searching harder. A "field
 * slot" is how the format writes a pointer: `ff ff ff ff` is the handle `-1`,
 * and the `u16` behind it is the schema class index of what it points at. Read
 * against the file's own `Formats/Latest`, the three constants below name
 * classes — `0x0c93` is `ParamValueSetDouble`, `0x116f` is `VWallDriver`, and
 * `0x1104` is `TaperableWallTypeWidthAtParametersCell`. The two slots this
 * decoder keys on are wall classes, and the discriminator only says the record
 * has a double parameter set. So the decoder is not looking for a type
 * reference in general; it is looking for the one walls write, which is why
 * widening the window cannot reach a loadable family. Doing that would be a new
 * decoder keyed on those families' own classes, with its own validation.
 *
 * **Why the slots are indexed first.** Both slots open with the same
 * `ff ff ff ff` marker that heads a record, so searching for one *from* a record
 * head means walking a 1,200-byte window a byte at a time — and on a real model
 * almost every window holds neither slot. A 70 MB building frames 2.7 million
 * record heads across its 422 MB of inflated pages, yet the whole file holds
 * just 57 name slots and 9,383 reference slots, and 2,981 of its 3,666 pages
 * hold none at all. Each page is therefore indexed by its slots up front, which
 * costs little because a slot ends in `0x11` — 0.17% of bytes, against the
 * marker's 12.8% — and a page with no slot is then dropped whole. Every record
 * head then reads its slot from that index rather than searching for it.
 *
 * **Where ids are 32-bit** (Revit 2023 and older; `element-id-width.ts`) the
 * record heads are the frames the shared frame walk finds, and the type
 * reference is read by `VWall`'s declared field order rather than by the zero
 * run, which only works where both offsets happen to be zero. After the
 * `m_pCurveDriver` slot (`VWallDriver`) and its `m_pRefFaces` list come
 * `m_embeddedTo` (`[u32 n]` ids), the `m_wallRunTimeData` pointer (four bytes
 * null, six live), `m_keyRefOffset` and `m_locLineOffset` as f64, and then
 * `m_WallAttributesId`, the wall's type. Measured on the walls whose type the
 * 2025 RAC sample names: the id sits 24 or 26 bytes past the list in both
 * files, as that order predicts.
 */
import { narrowElementIds } from "./element-id-width.ts";
import { scanFramedElementObjects } from "./element-objects.ts";
import { canonicalClassTag, fileClassTag } from "./revit-class-tags.ts";

/**
 * Discriminator B of the records whose type reference this decoder reads.
 *
 * A pointer at `ParamValueSetDouble`, so it marks a record that carries a
 * double parameter set rather than a kind of element.
 */
const TYPED_RECORD_DISCRIMINATOR = 0x0c93;

/** The `ff ff ff ff` that heads a record's null-field marker and every slot. */
const NULL_FIELD_MARKER = 0xffff_ffff;

/** A field slot: the null-field marker, then the field id as a u16. */
const SLOT_BYTES = 6;

/** Field id whose slot precedes the type reference: the class `VWallDriver`. */
const TYPE_REFERENCE_FIELD = 0x116f;

/**
 * Field id whose slot precedes a type record's name string: the class
 * `TaperableWallTypeWidthAtParametersCell`.
 */
const TYPE_NAME_FIELD = 0x1104;

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

/** Every `0x1104` and `0x116f` slot in a page, each list in offset order. */
type SlotIndex = { nameSlots: number[]; referenceSlots: number[] };

/**
 * Locate both kinds of field slot in one pass, keyed off the high byte of
 * their field ids (`0x11` in the 2027 numbering) so the native byte search
 * does the skipping.
 */
function indexFieldSlots(data: Uint8Array, view: DataView): SlotIndex {
  const nameSlots: number[] = [];
  const referenceSlots: number[] = [];
  const tail = SLOT_BYTES - 1;
  // The field ids are class indices, so the bytes hold the file's own; in a
  // 2025 file both classes sit under `0x10` rather than `0x11`.
  const nameField = fileClassTag(TYPE_NAME_FIELD);
  const referenceField = fileClassTag(TYPE_REFERENCE_FIELD);
  const highBytes = new Set(
    [nameField, referenceField]
      .filter((field) => field >= 0 && field <= 0xffff)
      .map((field) => field >> 8),
  );
  for (const highByte of highBytes) {
    for (
      let high = data.indexOf(highByte, tail);
      high >= 0;
      high = data.indexOf(highByte, high + 1)
    ) {
      const slot = high - tail;
      if (view.getUint32(slot, true) !== NULL_FIELD_MARKER) continue;
      const field = view.getUint16(slot + 4, true);
      if (field === nameField) nameSlots.push(slot);
      else if (field === referenceField) referenceSlots.push(slot);
    }
  }
  if (highBytes.size > 1) {
    nameSlots.sort((a, b) => a - b);
    referenceSlots.sort((a, b) => a - b);
  }
  return { nameSlots, referenceSlots };
}

/**
 * A forward-only reader over one page's slots of a single kind. Record heads
 * are visited in ascending offset order, so the slot each one searches for is
 * never behind the slot the previous head settled on.
 */
class SlotCursor {
  private readonly slots: readonly number[];
  private index = 0;

  constructor(slots: readonly number[]) {
    this.slots = slots;
  }

  /** First slot within the record's search window, or `-1` if it holds none. */
  within(recordOffset: number): number {
    while (this.index < this.slots.length && this.slots[this.index]! < recordOffset) {
      this.index += 1;
    }
    const slot = this.slots[this.index];
    return slot != null && slot <= recordOffset + RECORD_SEARCH_BYTES ? slot : -1;
  }
}

/** Read the type id that follows a located `0x116f` slot, or `null`. */
function readTypeReference(data: Uint8Array, view: DataView, slot: number): number | null {
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

/** Read the UTF-16 name behind a located `0x1104` slot, or `null`. */
function readTypeName(data: Uint8Array, view: DataView, slot: number): string | null {
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

/** Ids `m_embeddedTo` may list before the walk stops trusting itself. */
const MAX_EMBEDDED_IDS = 1_000;

/**
 * `m_WallAttributesId` read by `VWall`'s field order from a located
 * `m_pCurveDriver` slot, where ids are 32-bit, or null. `end` bounds the walk
 * to the wall's own frame.
 */
function readNarrowTypeReference(view: DataView, slot: number, end: number): number | null {
  if (slot + 10 > end) return null;
  const faces = view.getUint32(slot + 6, true);
  if (faces > MAX_INDEX_ENTRIES) return null;
  let cursor = slot + 10 + faces * 6;
  if (cursor + 4 > end) return null;
  const embedded = view.getUint32(cursor, true);
  if (embedded > MAX_EMBEDDED_IDS) return null;
  cursor += 4 + embedded * 4;
  if (cursor + 4 > end) return null;
  cursor += view.getInt32(cursor, true) === 0 ? 4 : 6;
  for (const offset of [0, 8]) {
    if (cursor + offset + 8 > end || !Number.isFinite(view.getFloat64(cursor + offset, true))) return null;
  }
  cursor += 16;
  if (cursor + 4 > end) return null;
  const typeId = view.getUint32(cursor, true);
  return typeId >= MIN_TYPE_ID && typeId < MAX_TYPE_ID ? typeId : null;
}

/** `collectTypeLinks` where ids are 32-bit: one record per framed object. */
function collectNarrowTypeLinks(data: Uint8Array, view: DataView, slots: SlotIndex): TypeLinks {
  const references: TypeReference[] = [];
  const names: TypeNameRecord[] = [];
  const seenReference = new Set<number>();
  const seenName = new Set<number>();
  const nameCursor = new SlotCursor(slots.nameSlots);
  const referenceCursor = new SlotCursor(slots.referenceSlots);
  for (const frame of scanFramedElementObjects(data)) {
    const end = Math.min(data.byteLength, frame.offset + frame.objectLength + 12);
    const nameSlot = nameCursor.within(frame.offset);
    if (nameSlot >= 0 && nameSlot < end && !seenName.has(frame.elementId)) {
      const name = readTypeName(data, view, nameSlot);
      if (name) {
        seenName.add(frame.elementId);
        names.push({ typeId: frame.elementId, name });
      }
    }
    const referenceSlot = referenceCursor.within(frame.offset);
    if (referenceSlot < 0 || referenceSlot >= end || seenReference.has(frame.elementId)) continue;
    const typeId = readNarrowTypeReference(view, referenceSlot, end);
    if (typeId == null || typeId === frame.elementId) continue;
    seenReference.add(frame.elementId);
    references.push({ elementId: frame.elementId, typeId });
  }
  return { references, names };
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
  const { nameSlots, referenceSlots } = indexFieldSlots(data, view);
  // Without a slot of either kind no record on this page can yield anything,
  // and most pages of a real model are in that state.
  if (nameSlots.length === 0 && referenceSlots.length === 0) return { references, names };
  if (narrowElementIds()) return collectNarrowTypeLinks(data, view, { nameSlots, referenceSlots });

  const nameCursor = new SlotCursor(nameSlots);
  const referenceCursor = new SlotCursor(referenceSlots);
  const seenReference = new Set<number>();
  const seenName = new Set<number>();

  for (
    let marker = data.indexOf(0xff, 18);
    marker >= 18 && marker + 6 <= data.byteLength;
    marker = data.indexOf(0xff, marker + 1)
  ) {
    if (view.getUint32(marker, true) !== NULL_FIELD_MARKER) continue;
    const recordOffset = marker - 18;
    if (recordOffset + 24 > data.byteLength) continue;

    const elementId = view.getUint32(recordOffset, true);
    if (!elementId || view.getUint32(recordOffset + 4, true) !== 0) continue;
    // The 8 bytes at +8 are a per-record stamp; all-zero or all-ones means this
    // is padding or a null slot rather than a record head.
    const low = view.getUint32(recordOffset + 8, true);
    const high = view.getUint32(recordOffset + 12, true);
    if (
      (low === 0 && high === 0) ||
      (low === NULL_FIELD_MARKER && high === NULL_FIELD_MARKER)
    ) {
      continue;
    }

    const nameSlot = nameCursor.within(recordOffset);
    const referenceSlot = referenceCursor.within(recordOffset);

    if (!seenName.has(elementId)) {
      const name = readTypeName(data, view, nameSlot);
      if (name) {
        seenName.add(elementId);
        names.push({ typeId: elementId, name });
      }
    }

    if (
      canonicalClassTag(view.getUint16(recordOffset + 22, true)) !==
        TYPED_RECORD_DISCRIMINATOR
    ) continue;
    if (seenReference.has(elementId)) continue;
    const typeId = readTypeReference(data, view, referenceSlot);
    if (typeId == null) continue;
    seenReference.add(elementId);
    references.push({ elementId, typeId });
  }

  return { references, names };
}
