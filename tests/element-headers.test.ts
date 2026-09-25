import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIT_2027_ELEMENT_HEADER_CLASS,
  scanElementHeaders,
} from "../lib/reviter/element-headers.ts";
import { nonModelElementIds, nonModelReason } from "../lib/reviter/model-elements.ts";

/**
 * One header as a file writes it: the owner's u64 id, a u32, the class index,
 * the `m_regenHistory` list, then the category and the id fields after it.
 */
function header(
  elementId: number,
  { category = -2000011, history = 0, ownerView = -1, designOption = -1 } = {},
): number[] {
  const bytes: number[] = [];
  const u32 = (value: number) => bytes.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff);
  const i64 = (value: number) => {
    const buffer = Buffer.alloc(8);
    buffer.writeBigInt64LE(BigInt(value));
    bytes.push(...buffer);
  };
  i64(elementId);
  u32(0x159);
  bytes.push(REVIT_2027_ELEMENT_HEADER_CLASS & 0xff, REVIT_2027_ELEMENT_HEADER_CLASS >> 8);
  u32(history);
  for (let entry = 0; entry < history; entry += 1) {
    i64(-1001103 - entry);
    i64(-1);
    bytes.push(0x04, 0x00);
    u32(0x340);
  }
  i64(category);
  i64(-1); // m_familyId
  i64(ownerView);
  i64(designOption);
  i64(-1);
  i64(-1);
  return bytes;
}

const page = (...records: number[][]) =>
  Uint8Array.from([...new Array(16).fill(0), ...records.flat(), ...new Array(16).fill(0)]);

test("a header states its own owner, category and owning view", () => {
  const headers = scanElementHeaders(page(
    header(139854),
    header(978609, { category: -2000011, history: 2 }),
    header(213581, { category: -2000300, ownerView: 312 }),
    header(4242, { category: -1 }),
  ));
  assert.deepEqual(headers, [
    { elementId: 139854, categoryId: -2000011, ownerViewId: null, designOptionId: null },
    { elementId: 978609, categoryId: -2000011, ownerViewId: null, designOptionId: null },
    { elementId: 213581, categoryId: -2000300, ownerViewId: 312, designOptionId: null },
    { elementId: 4242, categoryId: null, ownerViewId: null, designOptionId: null },
  ]);
});

test("a class-index match whose fields are not a header's is rejected", () => {
  // A category outside the BuiltInCategory band, and an owning view that is
  // neither -1 nor an element id.
  assert.deepEqual(scanElementHeaders(page(header(1, { category: 12 }))), []);
  assert.deepEqual(scanElementHeaders(page(header(1, { ownerView: -7 }))), []);
});

test("view-owned, category-less and non-model-category elements are not part of the model", () => {
  const wall = { elementId: 1, categoryId: -2000011, ownerViewId: null, designOptionId: null };
  assert.equal(nonModelReason(wall, undefined), null);
  assert.equal(nonModelReason({ ...wall, ownerViewId: 312 }, undefined), "view-owned");
  assert.equal(nonModelReason({ ...wall, categoryId: null }, undefined), "no-category");
  assert.equal(nonModelReason({ ...wall, categoryId: -2000530 }, undefined), "non-model-category");
  // With no header, a category from another source still decides it.
  assert.equal(nonModelReason(undefined, -2000095), "non-model-category");
  assert.equal(nonModelReason(undefined, -2000011), null);

  const excluded = nonModelElementIds(
    [{ elementId: 1, categoryId: -2000011 }, { elementId: 2, categoryId: -2000530 }],
    new Map([[3, { ...wall, elementId: 3, ownerViewId: 99 }]]),
  );
  assert.deepEqual([...excluded].sort(), [[2, "non-model-category"], [3, "view-owned"]]);
});
