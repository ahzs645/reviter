import assert from "node:assert/strict";
import test from "node:test";

import {
  locateDirectFacetedTuplePair,
  readClassSelector,
  readCountedArrayHeader,
} from "../lib/reviter/counted-arrays.ts";

test("reads signed class selectors and bounded dynamic collection counts", () => {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setInt16(1, 1869, true);
  view.setInt16(3, -1, true);
  view.setInt32(5, 42, true);

  assert.equal(readClassSelector(data, 1), 1869);
  assert.equal(readClassSelector(data, 3), -1);
  assert.deepEqual(readCountedArrayHeader(data, 5, 100), {
    ok: true,
    count: 42,
    itemsOffset: 9,
  });
  assert.equal(readCountedArrayHeader(data, 5, 10).ok, false);
  assert.equal(readCountedArrayHeader(data, 10).ok, false);
});

test("locates a direct counted point/facet tuple body without allocating", () => {
  const data = new Uint8Array(2 + 4 + 3 * 3 * 4 + 4 + 2 * 3 * 2);
  const view = new DataView(data.buffer);
  view.setInt16(0, 1869, true);
  view.setInt32(2, 3, true);
  [0, 0, 0, 2, 0, 0, 0, 3, 0].forEach((value, index) => {
    view.setFloat32(6 + index * 4, value, true);
  });
  view.setInt32(42, 2, true);
  [0, 1, 2, 2, 1, 0].forEach((value, index) => {
    view.setUint16(46 + index * 2, value, true);
  });

  const result = locateDirectFacetedTuplePair(data, 0, 4, 2);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pair.selector, 1869);
  assert.equal(result.pair.points.count, 3);
  assert.equal(result.pair.points.itemsOffset, 6);
  assert.equal(result.pair.facets.count, 2);
  assert.equal(result.pair.facets.itemsOffset, 46);
  assert.equal(result.pair.facets.endOffset, data.length);
});
