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
 * Only f64 values appear in these tables. Type parameters use a different
 * mechanism — positional, schema-tagged fields inside the type record — and are
 * not decoded here.
 */
import { parameterDisplayName } from "./built-in-parameters.ts";

/** `ff ff ff ff 10 03 01 00 00 00` — the element-id anchor preceding a table. */
const ANCHOR = [0xff, 0xff, 0xff, 0xff, 0x10, 0x03, 0x01, 0x00, 0x00, 0x00] as const;
const ANCHOR_LENGTH = ANCHOR.length;

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

export type ElementParameter = {
  parameterId: number;
  /** Published parameter label, or `Parameter <id>` when Autodesk omits it. */
  name: string;
  /** Value in Revit's internal units — feet for lengths. */
  value: number;
};

export type ElementParameterTable = {
  elementId: number;
  parameters: ElementParameter[];
};

function readTableAt(view: DataView, offset: number, byteLength: number): ElementParameter[] | null {
  if (offset + 4 > byteLength) return null;
  const count = view.getUint32(offset, true);
  if (count < MIN_PARAMETERS || count > MAX_PARAMETERS) return null;
  if (offset + 4 + count * 16 > byteLength) return null;

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
    parameters.push({ parameterId, name: parameterDisplayName(parameterId), value });
  }
  return parameters;
}

/**
 * Decode every element parameter table in one inflated page. Each anchor is
 * followed forward until a table validates against its own count header.
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

    const limit = Math.min(data.byteLength, idOffset + 8 + TABLE_SEARCH_BYTES);
    for (let cursor = idOffset + 8; cursor + 20 <= limit; cursor += 1) {
      const parameters = readTableAt(view, cursor, data.byteLength);
      if (!parameters) continue;
      tables.push({ elementId, parameters });
      break;
    }
    offset += ANCHOR_LENGTH - 1;
  }
  return tables;
}
