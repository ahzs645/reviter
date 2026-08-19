/**
 * Per-element parameter tables in `Partitions/*`.
 *
 * An element's instance parameters are written as a flat table of
 * `(BuiltInParameter id, value)` pairs:
 *
 * ```text
 * [u32 count] [count x ( i64 negative parameter id, f64 value in feet )]
 * ```
 *
 * The table carries no element id. Ownership comes from the anchor that
 * precedes it, in which the element restates its own id:
 *
 * ```text
 * ff ff ff ff 10 03 01 00 00 00 [u64 element id]
 * ```
 *
 * Using that anchor matters. Resolving ownership by "nearest preceding record
 * start" instead is wrong in a specific and costly way: the type-reference slot
 * inside an element also passes a record-start test and steals ownership, which
 * collapses the assignment from 15,059 elements to 1,262 and misfiles most wall
 * tables onto ids the IFC export has never heard of.
 *
 * Verification against the paired IFC export: over the 6,277 walls that have
 * both a decoded table and an IFC swept-solid depth, the value stored under one
 * parameter id reproduces that depth to within 1e-6 ft on **6,271 of them**.
 * That single check confirms the table framing, the f64-in-feet encoding, and
 * the element join together. Parameter *names* come from the published Revit
 * enumeration and are corroborating evidence rather than part of the decode.
 *
 * What that check could not confirm is *ownership*, and the window was wrong
 * about it. Reading a table for every anchor gave 11,492 elements a table on
 * the supplied project; 2,007 of them do not have one. Their values are real —
 * 99.5% of the 14,522 are ids Autodesk declares `Double` — because they are a
 * neighbour's, which is why nothing about a table's contents can catch this.
 * Gating on the element's own `m_pParamValueSetDouble` pointer leaves the
 * remaining 9,485 tables byte-identical and drops the rest.
 *
 * `Element` declares four value sets, not one: doubles, integers, strings and
 * element ids. Three of them are read here. "Only f64 values appear" was true
 * of the table this decoder used to find, not of the record — the integer table
 * holds every boolean and enumerated instance parameter, and the string table
 * holds `Mark`, `Type Mark`, `Description`, `Comments` and `Keynote`, which a
 * model has no other source for. Each is a separate object the element points
 * at.
 *
 * The element-id set is not read. It locates as reliably as the others and is
 * worth nothing on the supplied project: all 1,823 of its values are `-1`.
 *
 * Every value is checked against the storage type Autodesk declares for that
 * parameter in `oda-parameter-descriptors.json`, which is a table from a
 * different binary than any of this. On the supplied project all 67,228 double
 * values, all 114 integer values and all 44 text values agree with it.
 *
 * Type parameters use a different mechanism again: positional, schema-tagged
 * fields inside the type record, not decoded here.
 *
 * Each decoded parameter also carries its `BuiltInParameter` enumerator where a
 * published source names it, so a consumer can join on `WALL_USER_HEIGHT_PARAM`
 * instead of on a display label that changes with release and locale.
 */

import { builtInParameterEnumName, parameterDisplayName } from "./built-in-parameters.ts";

/**
 * `ff ff ff ff 10 03 01 00 00 00` — the element-id anchor preceding a table.
 *
 * Not a signature. It is three consecutive `Element` fields: `m_cellList` as a
 * pointer whose handle is `-1` and whose class is `CellList` (`0x0310`), then
 * `m_docAccess.m_pDoc` as the stub `01 00 00 00`. The element id follows because
 * `m_id` is the very next field.
 */
const ANCHOR = [0xff, 0xff, 0xff, 0xff, 0x10, 0x03, 0x01, 0x00, 0x00, 0x00] as const;
const ANCHOR_LENGTH = ANCHOR.length;

/**
 * `Element`'s fields before `m_cellList`, in declaration order: the four
 * parameter value sets, then the two geometry pointers, then `m_constrInfo`.
 *
 * Each is a pointer written as `[i32 handle]`, followed by `[u16 class]` when
 * the handle is non-zero — so four bytes for a null and six for a live one.
 * `m_constrInfo` is a counted collection: `[i32 count]` and then that many
 * pointers, which is zero on all but three objects in the supplied project.
 */
const LEADING_POINTER_FIELDS = 6;

/** Positions of the four parameter value sets among those pointers. */
const DOUBLE_SET_POINTER = 0;
const INTEGER_SET_POINTER = 1;
const STRING_SET_POINTER = 2;

/**
 * Bytes from the anchor to the end of `Element`'s own fields: `m_cellList` and
 * `m_docAccess` (the anchor itself), `m_id`, the seven element ids from
 * `m_assocLevelId` to `m_designOptionId`, and three flags.
 */
const BASE_FIELDS_AFTER_ANCHOR = 10 + 8 + 7 * 8 + 3;

/** Bytes from an object's start to its first field: the 18-byte frame header. */
const OBJECT_BODY_OFFSET = 18;

/**
 * Widest span from an object's start to the anchor: the header, six live
 * pointers and an empty collection. The narrowest is six null pointers.
 */
const MAX_ANCHOR_DISTANCE = OBJECT_BODY_OFFSET + LEADING_POINTER_FIELDS * 6 + 4;
const MIN_ANCHOR_DISTANCE = OBJECT_BODY_OFFSET + LEADING_POINTER_FIELDS * 4 + 4;

/** Smallest and largest object length the framing admits. */
const MIN_OBJECT_LENGTH = 40;
const MAX_OBJECT_LENGTH = 0xffff;

/**
 * Bytes searched forward from an anchor for that element's table. Sweeping this
 * window against the IFC wall-height check: 256 bytes reaches 10,248 elements,
 * 1,024 reaches 17,846, and 4,096 reaches 33,174, with the wall check holding at
 * 99.9% throughout. The middle value is taken because the wall check only proves
 * attribution for elements that *have* a table — a wider window cannot be shown
 * not to borrow a neighbour's table for an element that has none.
 */
const TABLE_SEARCH_BYTES = 1_024;

/** Revit BuiltInParameter ids sit in this window; anything else is noise. */
const PARAMETER_ID_MIN = -2_000_000;
const PARAMETER_ID_MAX = -1_000;

const MIN_PARAMETERS = 1;
const MAX_PARAMETERS = 256;

/** Model coordinates and dimensions in feet stay well inside this bound. */
const MAX_PARAMETER_VALUE = 1e7;

/** Characters one text parameter can hold. Revit's own limit is far lower. */
const MAX_PARAMETER_TEXT = 4_096;

export type ElementParameter = {
  parameterId: number;
  /** Published parameter label, or `Parameter <id>` when Autodesk omits it. */
  name: string;
  /**
   * `BuiltInParameter` enumerator, such as `WALL_USER_HEIGHT_PARAM`. Absent for
   * ids the ODA label resource does not carry, which includes 12 that the
   * transcribed table does name, so its absence says nothing about the id.
   */
  enumName?: string;
  /**
   * Value in Revit's internal units — feet for lengths — or the text, for the
   * parameters Revit stores in its string value set.
   */
  value: number | string;
};

export type ElementParameterTable = {
  elementId: number;
  parameters: ElementParameter[];
};

function readTableAt(
  view: DataView,
  offset: number,
  byteLength: number,
): { parameters: ElementParameter[]; end: number } | null {
  if (offset + 4 > byteLength) return null;
  const count = view.getUint32(offset, true);
  if (count < MIN_PARAMETERS || count > MAX_PARAMETERS) return null;
  const end = offset + 4 + count * 16;
  if (end > byteLength) return null;

  const parameters: ElementParameter[] = [];
  for (let index = 0; index < count; index += 1) {
    const entry = offset + 4 + index * 16;
    // Parameter ids are negative and small in magnitude, so the high word is
    // all ones and the low word carries the value.
    if (view.getUint32(entry + 4, true) !== 0xffff_ffff) return null;
    const parameterId = view.getUint32(entry, true) - 0x1_0000_0000;
    if (parameterId < PARAMETER_ID_MIN || parameterId > PARAMETER_ID_MAX) return null;
    const value = view.getFloat64(entry + 8, true);
    if (!Number.isFinite(value) || Math.abs(value) > MAX_PARAMETER_VALUE) return null;
    const enumName = builtInParameterEnumName(parameterId);
    parameters.push({
      parameterId,
      name: parameterDisplayName(parameterId),
      ...(enumName ? { enumName } : {}),
      value,
    });
  }
  return { parameters, end };
}

/**
 * One `ParamValueSetInt` table: the same framing as the double one, with a
 * four-byte value.
 *
 * Revit stores every integer, boolean and enumerated instance parameter here.
 * Nothing separates them from the double table by content — the parameter ids
 * come from one enumeration — so the two are told apart by which of `Element`'s
 * pointers is live, and by both tables parsing back to back when both are.
 */
function readIntegerTableAt(
  view: DataView,
  offset: number,
  byteLength: number,
): { parameters: ElementParameter[]; end: number } | null {
  if (offset + 4 > byteLength) return null;
  const count = view.getUint32(offset, true);
  if (count < MIN_PARAMETERS || count > MAX_PARAMETERS) return null;
  const end = offset + 4 + count * 12;
  if (end > byteLength) return null;

  const parameters: ElementParameter[] = [];
  for (let index = 0; index < count; index += 1) {
    const entry = offset + 4 + index * 12;
    if (view.getUint32(entry + 4, true) !== 0xffff_ffff) return null;
    const parameterId = view.getUint32(entry, true) - 0x1_0000_0000;
    if (parameterId < PARAMETER_ID_MIN || parameterId > PARAMETER_ID_MAX) return null;
    const enumName = builtInParameterEnumName(parameterId);
    parameters.push({
      parameterId,
      name: parameterDisplayName(parameterId),
      ...(enumName ? { enumName } : {}),
      value: view.getInt32(entry + 8, true),
    });
  }
  return { parameters, end };
}

/**
 * One `ParamValueSetAString` table.
 *
 * The entries are variable width — a parameter id, a character count, then that
 * many UTF-16LE code units — so this walks rather than indexes. These are the
 * parameters that carry identity a model has no other source for: `Mark`,
 * `Type Mark`, `Description`, `Comments`, `Keynote`.
 */
function readStringTableAt(
  view: DataView,
  data: Uint8Array,
  offset: number,
  byteLength: number,
): { parameters: ElementParameter[]; end: number } | null {
  if (offset + 4 > byteLength) return null;
  const count = view.getUint32(offset, true);
  if (count < MIN_PARAMETERS || count > MAX_PARAMETERS) return null;

  const parameters: ElementParameter[] = [];
  let cursor = offset + 4;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 12 > byteLength) return null;
    if (view.getUint32(cursor + 4, true) !== 0xffff_ffff) return null;
    const parameterId = view.getUint32(cursor, true) - 0x1_0000_0000;
    if (parameterId < PARAMETER_ID_MIN || parameterId > PARAMETER_ID_MAX) return null;
    const characters = view.getUint32(cursor + 8, true);
    if (characters > MAX_PARAMETER_TEXT) return null;
    const textEnd = cursor + 12 + characters * 2;
    if (textEnd > byteLength) return null;
    const text = new TextDecoder("utf-16le").decode(data.subarray(cursor + 12, textEnd));
    // A control character means the walk is reading something else.
    if (/[\u0000-\u0008\u000e-\u001f\ufffd]/.test(text)) return null;
    const enumName = builtInParameterEnumName(parameterId);
    parameters.push({
      parameterId,
      name: parameterDisplayName(parameterId),
      ...(enumName ? { enumName } : {}),
      value: text,
    });
    cursor = textEnd;
  }
  return { parameters, end: cursor };
}

/**
 * The value sets an element declares, read from where they are written.
 *
 * A pointer field defers its target, and the deferred objects follow the
 * owner's own fields in the order the fields appear — so the value sets a
 * record has are the first things after it, contiguous and in declaration
 * order. Requiring every declared set to parse from one offset, back to back,
 * is what makes the position trustworthy: a lone table can be matched almost
 * anywhere, two of different shapes in sequence essentially cannot.
 */
function readParameterSets(
  view: DataView,
  offset: number,
  byteLength: number,
  sets: { double: boolean; integer: boolean; text: boolean },
  data: Uint8Array,
): ElementParameter[] | null {
  let cursor = offset;
  const parameters: ElementParameter[] = [];
  if (sets.double) {
    const table = readTableAt(view, cursor, byteLength);
    if (!table) return null;
    parameters.push(...table.parameters);
    cursor = table.end;
  }
  if (sets.integer) {
    const table = readIntegerTableAt(view, cursor, byteLength);
    if (!table) return null;
    parameters.push(...table.parameters);
    cursor = table.end;
  }
  if (sets.text) {
    const table = readStringTableAt(view, data, cursor, byteLength);
    if (!table) return null;
    parameters.push(...table.parameters);
  }
  return parameters.length ? parameters : null;
}

/**
 * Whether the object owning this anchor declares a double parameter set.
 *
 * The anchor sits in the middle of `Element`'s fields, so the object it belongs
 * to starts a bounded distance behind it, and the fields in between are the
 * pointers that say which value sets exist. Walking them backwards from the
 * anchor answers two questions at once: whether this really is an element
 * record — the walk has to land exactly on the anchor, from a frame whose own
 * header restates the same id — and whether that element has a table at all.
 *
 * The second question is the one that matters. Searching forward from the
 * anchor for anything that parses finds a neighbour's table when an element has
 * none of its own: of the 20,524 tables that search produces on the supplied
 * project, 6,962 belong to elements whose `m_pParamValueSetDouble` is null. A
 * borrowed table is not detectable from its contents — 87% of the values in
 * those 6,962 are declared `Double` by Autodesk's own parameter table, because
 * they are real values, just another element's.
 *
 * Returns `null` when no frame explains the anchor.
 */
function ownedParameterSets(
  view: DataView,
  anchorOffset: number,
  elementId: number,
): { double: boolean; integer: boolean; text: boolean } | null {
  for (
    let distance = MIN_ANCHOR_DISTANCE;
    distance <= MAX_ANCHOR_DISTANCE;
    distance += 1
  ) {
    const start = anchorOffset - distance;
    if (start < 0) break;
    // The frame restates the element id, and the id is a u64 whose high word is
    // zero for every id Revit persists.
    if (view.getUint32(start, true) !== elementId) continue;
    if (view.getUint32(start + 4, true) !== 0) continue;
    const objectLength = view.getUint32(start + 12, true);
    if (objectLength < MIN_OBJECT_LENGTH || objectLength > MAX_OBJECT_LENGTH) continue;
    // The length is echoed behind the object. Pages truncate objects, so this
    // is required only when the echo is on this page at all.
    const echo = start + objectLength + 16;
    if (echo + 4 <= view.byteLength && view.getUint32(echo, true) !== objectLength) continue;

    let cursor = start + OBJECT_BODY_OFFSET;
    let double = false;
    let integer = false;
    let text = false;
    let walked = true;
    for (let field = 0; field < LEADING_POINTER_FIELDS; field += 1) {
      if (cursor + 4 > anchorOffset) { walked = false; break; }
      const handle = view.getInt32(cursor, true);
      cursor += handle === 0 ? 4 : 6;
      if (field === DOUBLE_SET_POINTER) double = handle !== 0;
      if (field === INTEGER_SET_POINTER) integer = handle !== 0;
      if (field === STRING_SET_POINTER) text = handle !== 0;
    }
    if (!walked || cursor + 4 > anchorOffset) continue;
    // `m_constrInfo`, a counted collection of the same pointers.
    const constraints = view.getUint32(cursor, true);
    cursor += 4;
    for (let index = 0; index < constraints && cursor + 4 <= anchorOffset; index += 1) {
      const handle = view.getInt32(cursor, true);
      cursor += handle === 0 ? 4 : 6;
    }
    if (cursor !== anchorOffset) continue;
    return { double, integer, text };
  }
  return null;
}

/**
 * Decode every element parameter table in one inflated page.
 *
 * An anchor is read only when the object it belongs to says it has a table, and
 * then the table is looked for forward from the anchor as before.
 */
export function collectElementParameters(data: Uint8Array): ElementParameterTable[] {
  const tables: ElementParameterTable[] = [];
  if (data.byteLength < ANCHOR_LENGTH + 12) return tables;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  for (
    let offset = data.indexOf(ANCHOR[0]);
    offset >= 0 && offset + ANCHOR_LENGTH + 8 <= data.byteLength;
    offset = data.indexOf(ANCHOR[0], offset + 1)
  ) {
    let matched = true;
    for (let index = 1; index < ANCHOR_LENGTH; index += 1) {
      if (data[offset + index] !== ANCHOR[index]) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;

    const idOffset = offset + ANCHOR_LENGTH;
    if (view.getUint32(idOffset + 4, true) !== 0) continue;
    const elementId = view.getUint32(idOffset, true);
    if (!elementId) continue;

    // An element that declares no value set has no table to find, and searching
    // for one only borrows a neighbour's.
    const sets = ownedParameterSets(view, offset, elementId);
    if (!sets || (!sets.double && !sets.integer && !sets.text)) {
      offset += ANCHOR_LENGTH - 1;
      continue;
    }

    // The sets are the first objects deferred by this record, so they begin
    // after its own fields rather than at some distance from the anchor.
    const from = offset + BASE_FIELDS_AFTER_ANCHOR;
    const limit = Math.min(data.byteLength, from + TABLE_SEARCH_BYTES);
    for (let cursor = from; cursor + 12 <= limit; cursor += 1) {
      const parameters = readParameterSets(view, cursor, data.byteLength, sets, data);
      if (!parameters) continue;
      tables.push({ elementId, parameters });
      break;
    }
    offset += ANCHOR_LENGTH - 1;
  }
  return tables;
}
