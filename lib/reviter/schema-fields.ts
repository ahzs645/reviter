/**
 * Browser-safe readers for the part of `Formats/Latest` needed by faceted
 * topology. This is intentionally a narrow decoder: it rejects an unrecognised
 * property descriptor instead of guessing its length.
 *
 * Verified native reader boundaries:
 * - polymorphic object selection is a signed little-endian int16 class id;
 * - a dynamically sized collection begins with a signed little-endian int32
 *   item count;
 * - a high-bit class definition recursively embeds its parent definition.
 */

const MAX_SCHEMA_NAME = 256;
const MAX_SCHEMA_FIELDS = 512;
const MAX_SCHEMA_DEPTH = 32;

export type SchemaArrayElement = {
  typeCode: number;
  tupleWidth: number;
};

export type DecodedSchemaField = {
  name: string;
  offset: number;
  descriptorOffset: number;
  descriptorByteLength: number;
  typeCode: number;
  mode: number;
  arrayElement?: SchemaArrayElement;
};

export type DecodedSchemaLayer = {
  name: string;
  classId: number;
  definition: boolean;
  offset: number;
  version: number;
  fields: DecodedSchemaField[];
  parent?: DecodedSchemaLayer;
  endOffset: number;
};

export type SchemaClassDecodeResult =
  | { ok: true; layer: DecodedSchemaLayer }
  | { ok: false; error: string; offset: number };

function rangeFits(data: Uint8Array, offset: number, byteLength: number): boolean {
  return (
    Number.isSafeInteger(offset) &&
    offset >= 0 &&
    Number.isSafeInteger(byteLength) &&
    byteLength >= 0 &&
    offset <= data.byteLength - byteLength
  );
}

function ascii(data: Uint8Array, offset: number, byteLength: number): string | null {
  if (!rangeFits(data, offset, byteLength)) return null;
  for (let index = offset; index < offset + byteLength; index += 1) {
    if (data[index]! < 0x20 || data[index]! > 0x7e) return null;
  }
  return new TextDecoder("ascii").decode(data.subarray(offset, offset + byteLength));
}

function readName16(
  data: Uint8Array,
  view: DataView,
  offset: number,
): { name: string; endOffset: number } | null {
  if (!rangeFits(data, offset, 2)) return null;
  const length = view.getUint16(offset, true);
  if (length < 1 || length > MAX_SCHEMA_NAME) return null;
  const name = ascii(data, offset + 2, length);
  return name == null ? null : { name, endOffset: offset + 2 + length };
}

function readName32(
  data: Uint8Array,
  view: DataView,
  offset: number,
): { name: string; endOffset: number } | null {
  if (!rangeFits(data, offset, 4)) return null;
  const length = view.getUint32(offset, true);
  if (length < 1 || length > MAX_SCHEMA_NAME) return null;
  const name = ascii(data, offset + 4, length);
  return name == null ? null : { name, endOffset: offset + 4 + length };
}

/**
 * Decode the descriptor forms used by the topology fields:
 *
 * - scalar: `[type:u8, mode:u8, 0:u16]`
 * - fixed tuple: scalar header plus `[tupleWidth:u32]`
 * - PArray tuple: `[0x0d,0x50,0,0][1:u32][0x20]`, followed by a
 *   fixed-tuple header and a zero u32 terminator
 * - byte PArray: `[0x02,0x50,0,0][0:u32]`
 */
function readTopologyDescriptor(
  data: Uint8Array,
  view: DataView,
  offset: number,
): Omit<DecodedSchemaField, "name" | "offset" | "descriptorOffset"> | null {
  if (!rangeFits(data, offset, 4)) return null;
  const typeCode = data[offset]!;
  const mode = data[offset + 1]!;
  if (data[offset + 2] !== 0 || data[offset + 3] !== 0) return null;

  if (mode === 0) {
    return { descriptorByteLength: 4, typeCode, mode };
  }

  if (mode === 0x10 && rangeFits(data, offset, 8)) {
    const tupleWidth = view.getUint32(offset + 4, true);
    if (tupleWidth < 1 || tupleWidth > 16) return null;
    return {
      descriptorByteLength: 8,
      typeCode,
      mode,
      arrayElement: { typeCode, tupleWidth },
    };
  }

  if (mode !== 0x50 || !rangeFits(data, offset, 8)) return null;
  const argumentCount = view.getUint32(offset + 4, true);
  if (typeCode === 0x02 && argumentCount === 0) {
    return { descriptorByteLength: 8, typeCode, mode };
  }
  if (
    typeCode !== 0x0d ||
    argumentCount !== 1 ||
    !rangeFits(data, offset, 21) ||
    data[offset + 8] !== 0x20
  ) {
    return null;
  }
  const elementTypeCode = data[offset + 9]!;
  const elementMode = data[offset + 10]!;
  const tupleWidth = view.getUint32(offset + 13, true);
  const terminator = view.getUint32(offset + 17, true);
  if (
    data[offset + 11] !== 0 ||
    data[offset + 12] !== 0 ||
    elementMode !== 0x10 ||
    tupleWidth < 1 ||
    tupleWidth > 16 ||
    terminator !== 0
  ) {
    return null;
  }
  return {
    descriptorByteLength: 21,
    typeCode,
    mode,
    arrayElement: { typeCode: elementTypeCode, tupleWidth },
  };
}

function decodeLayer(
  data: Uint8Array,
  view: DataView,
  offset: number,
  depth: number,
): SchemaClassDecodeResult {
  if (depth > MAX_SCHEMA_DEPTH) {
    return { ok: false, error: "schema inheritance exceeds the depth bound", offset };
  }
  const named = readName16(data, view, offset);
  if (!named || !rangeFits(data, named.endOffset, 2)) {
    return { ok: false, error: "invalid class-definition name", offset };
  }
  const rawId = view.getUint16(named.endOffset, true);
  const definition = (rawId & 0x8000) !== 0;
  let cursor = named.endOffset + 2;
  let parent: DecodedSchemaLayer | undefined;

  if (definition) {
    if (!rangeFits(data, cursor, 2) || view.getUint16(cursor, true) !== 0) {
      return { ok: false, error: "high-bit class definition lacks its zero marker", offset: cursor };
    }
    const parentResult = decodeLayer(data, view, cursor + 2, depth + 1);
    if (!parentResult.ok) return parentResult;
    parent = parentResult.layer;
    cursor = parent.endOffset;
  }

  if (!rangeFits(data, cursor, 8)) {
    return { ok: false, error: "truncated class version/field-count pair", offset: cursor };
  }
  const version = view.getUint32(cursor, true);
  const fieldCount = view.getUint32(cursor + 4, true);
  cursor += 8;
  if (fieldCount > MAX_SCHEMA_FIELDS) {
    return { ok: false, error: "class field count exceeds the safety bound", offset: cursor - 4 };
  }

  const fields: DecodedSchemaField[] = [];
  for (let index = 0; index < fieldCount; index += 1) {
    const fieldOffset = cursor;
    const fieldName = readName32(data, view, cursor);
    if (!fieldName) {
      return { ok: false, error: `invalid field name at index ${index}`, offset: cursor };
    }
    cursor = fieldName.endOffset;
    const descriptor = readTopologyDescriptor(data, view, cursor);
    if (!descriptor) {
      return {
        ok: false,
        error: `unresolved property descriptor for ${fieldName.name}`,
        offset: cursor,
      };
    }
    fields.push({
      name: fieldName.name,
      offset: fieldOffset,
      descriptorOffset: cursor,
      ...descriptor,
    });
    cursor += descriptor.descriptorByteLength;
  }

  return {
    ok: true,
    layer: {
      name: named.name,
      classId: rawId & 0x7fff,
      definition,
      offset,
      version,
      fields,
      parent,
      endOffset: cursor,
    },
  };
}

/** Decode one recursive class definition beginning at its u16 name length. */
export function decodeSchemaClassAt(data: Uint8Array, offset: number): SchemaClassDecodeResult {
  if (data.byteLength < 2) {
    return { ok: false, error: "schema data is empty", offset };
  }
  return decodeLayer(
    data,
    new DataView(data.buffer, data.byteOffset, data.byteLength),
    offset,
    0,
  );
}

/** Find and decode the first high-bit definition carrying an exact class name. */
export function findSchemaClassDefinition(
  data: Uint8Array,
  className: string,
): SchemaClassDecodeResult {
  const encoded = new TextEncoder().encode(className);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let offset = 0; offset + encoded.length + 4 <= data.byteLength; offset += 1) {
    if (view.getUint16(offset, true) !== encoded.length) continue;
    let matches = true;
    for (let index = 0; index < encoded.length; index += 1) {
      if (data[offset + 2 + index] !== encoded[index]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    const rawId = view.getUint16(offset + 2 + encoded.length, true);
    if (!(rawId & 0x8000)) continue;
    return decodeSchemaClassAt(data, offset);
  }
  return { ok: false, error: `class definition ${className} was not found`, offset: -1 };
}

/** Return fields in serialized base-to-derived order. */
export function flattenSchemaFields(layer: DecodedSchemaLayer): DecodedSchemaField[] {
  return [...(layer.parent ? flattenSchemaFields(layer.parent) : []), ...layer.fields];
}

export type CountedArrayHeader =
  | { ok: true; count: number; itemsOffset: number }
  | { ok: false; error: string };

/** Read the verified dynamic-collection int32 count without allocating. */
export function readCountedArrayHeader(
  data: Uint8Array,
  offset: number,
  maxItems = 10_000_000,
): CountedArrayHeader {
  if (!rangeFits(data, offset, 4)) return { ok: false, error: "truncated collection count" };
  const count = new DataView(data.buffer, data.byteOffset, data.byteLength).getInt32(offset, true);
  if (!Number.isSafeInteger(maxItems) || maxItems < 0) {
    return { ok: false, error: "maxItems must be a non-negative safe integer" };
  }
  if (count < 0 || count > maxItems) {
    return { ok: false, error: "collection count is outside the safety bound" };
  }
  return { ok: true, count, itemsOffset: offset + 4 };
}

/** Read the verified signed int16 selector used by polymorphic object fields. */
export function readClassSelector(data: Uint8Array, offset: number): number | null {
  if (!rangeFits(data, offset, 2)) return null;
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getInt16(offset, true);
}

export type CountedTupleArray = {
  count: number;
  countOffset: number;
  itemsOffset: number;
  endOffset: number;
  tupleWidth: number;
  scalarByteLength: number;
};

export type CountedTupleArrayResult =
  | { ok: true; array: CountedTupleArray }
  | { ok: false; error: string };

/**
 * Locate a counted fixed-width tuple array. This applies the verified int32
 * collection count while leaving the element scalar interpretation to callers.
 */
export function locateCountedTupleArray(
  data: Uint8Array,
  offset: number,
  tupleWidth: number,
  scalarByteLength: number,
  maxItems = 10_000_000,
): CountedTupleArrayResult {
  if (
    !Number.isSafeInteger(tupleWidth) ||
    tupleWidth < 1 ||
    tupleWidth > 16 ||
    !Number.isSafeInteger(scalarByteLength) ||
    scalarByteLength < 1 ||
    scalarByteLength > 8
  ) {
    return { ok: false, error: "invalid tuple layout" };
  }
  const header = readCountedArrayHeader(data, offset, maxItems);
  if (!header.ok) return header;
  const byteLength = header.count * tupleWidth * scalarByteLength;
  if (!Number.isSafeInteger(byteLength) || !rangeFits(data, header.itemsOffset, byteLength)) {
    return { ok: false, error: "tuple array extends past the supplied bytes" };
  }
  return {
    ok: true,
    array: {
      count: header.count,
      countOffset: offset,
      itemsOffset: header.itemsOffset,
      endOffset: header.itemsOffset + byteLength,
      tupleWidth,
      scalarByteLength,
    },
  };
}

export type FacetedTuplePair = {
  selector: number;
  selectorOffset: number;
  points: CountedTupleArray;
  facets: CountedTupleArray;
};

export type FacetedTuplePairResult =
  | { ok: true; pair: FacetedTuplePair }
  | { ok: false; error: string };

/**
 * Test the simplest fully framed topology body:
 *
 * `[i16 class][i32 pointCount][point triples][i32 facetCount][index triples]`
 *
 * A failure is useful evidence: it means another inherited-property or
 * collection token exists between the selector and arrays. The function does
 * not scan forward and accidentally re-label unrelated numeric data.
 */
export function locateDirectFacetedTuplePair(
  data: Uint8Array,
  selectorOffset: number,
  pointScalarByteLength: 4 | 8,
  indexScalarByteLength: 2 | 4,
  maxVertices = 10_000_000,
  maxFacets = 20_000_000,
): FacetedTuplePairResult {
  const selector = readClassSelector(data, selectorOffset);
  if (selector == null) return { ok: false, error: "truncated class selector" };
  const points = locateCountedTupleArray(
    data,
    selectorOffset + 2,
    3,
    pointScalarByteLength,
    maxVertices,
  );
  if (!points.ok) return points;
  if (points.array.count < 3) return { ok: false, error: "point array has fewer than 3 items" };

  const facets = locateCountedTupleArray(
    data,
    points.array.endOffset,
    3,
    indexScalarByteLength,
    maxFacets,
  );
  if (!facets.ok) return facets;
  if (facets.array.count < 1) return { ok: false, error: "facet array is empty" };

  return {
    ok: true,
    pair: {
      selector,
      selectorOffset,
      points: points.array,
      facets: facets.array,
    },
  };
}
