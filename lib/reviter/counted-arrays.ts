/**
 * Counted collections and class selectors, read out of instance records.
 *
 * These are readers for the bytes an object writes, not for the schema that
 * describes them: a dynamic collection is an `i32` count followed by its items,
 * and a class selector is the `u16` class index behind a `ff ff ff ff` handle.
 * Both are shapes the schema explains — `itemMode` 5 for the collection, a
 * polymorphic pointer for the selector — and both are read here directly
 * because a probe walking a page has the bytes and not the class.
 *
 * They were part of `schema-fields.ts`, which also tried to parse the schema
 * stream and did so wrongly; `schema-reader.ts` replaced that half. These
 * survived it because they never depended on it.
 */

/** Whether `byteLength` bytes starting at `offset` are inside `data`. */
function rangeFits(data: Uint8Array, offset: number, byteLength: number): boolean {
  return (
    Number.isSafeInteger(offset) &&
    offset >= 0 &&
    Number.isSafeInteger(byteLength) &&
    byteLength >= 0 &&
    offset <= data.byteLength - byteLength
  );
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
