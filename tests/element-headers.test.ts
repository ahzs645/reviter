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
  { category = -2000011, history = 0, family = -1, ownerView = -1, designOption = -1, unplacedOwner = -1 } = {},
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
  i64(family); // m_familyId
  i64(ownerView);
  i64(designOption);
  i64(unplacedOwner);
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
    header(295447, { family: 295427 }),
  ));
  assert.deepEqual(headers, [
    { elementId: 139854, categoryId: -2000011, familyId: null, ownerViewId: null, designOptionId: null },
    { elementId: 978609, categoryId: -2000011, familyId: null, ownerViewId: null, designOptionId: null },
    { elementId: 213581, categoryId: -2000300, familyId: null, ownerViewId: 312, designOptionId: null },
    { elementId: 4242, categoryId: null, familyId: null, ownerViewId: null, designOptionId: null },
    { elementId: 295447, categoryId: -2000011, familyId: 295427, ownerViewId: null, designOptionId: null },
  ]);
});

test("a class-index match whose fields are not a header's is rejected", () => {
  // A category outside the BuiltInCategory band, and an owning view that is
  // neither -1 nor an element id.
  assert.deepEqual(scanElementHeaders(page(header(1, { category: 12 }))), []);
  assert.deepEqual(scanElementHeaders(page(header(1, { ownerView: -7 }))), []);
});

test("view-owned, category-less and non-model-category elements are not part of the model", () => {
  const wall = { elementId: 1, categoryId: -2000011, familyId: null, ownerViewId: null, designOptionId: null };
  assert.equal(nonModelReason(wall, undefined), null);
  assert.equal(nonModelReason({ ...wall, ownerViewId: 312 }, undefined), "view-owned");
  // A wall inside a loaded family's own definition, as in the 2025 school.
  assert.equal(nonModelReason({ ...wall, familyId: 295427 }, undefined), "family-internal");
  assert.equal(nonModelReason({ ...wall, categoryId: null }, undefined), "no-category");
  assert.equal(nonModelReason({ ...wall, categoryId: -2000530 }, undefined), "non-model-category");
  // A wall reveal is cut from its wall, as an opening is.
  assert.equal(nonModelReason({ ...wall, categoryId: -2000182 }, undefined), "non-model-category");
  // With no header, a category from another source still decides it.
  assert.equal(nonModelReason(undefined, -2000095), "non-model-category");
  assert.equal(nonModelReason(undefined, -2000011), null);

  const excluded = nonModelElementIds(
    [{ elementId: 1, categoryId: -2000011 }, { elementId: 2, categoryId: -2000530 }],
    new Map([[3, { ...wall, elementId: 3, ownerViewId: 99 }]]),
  );
  assert.deepEqual([...excluded].sort(), [[2, "non-model-category"], [3, "view-owned"]]);
});

test("a member of a group type that is never placed is not part of the model", () => {
  // The 2025 RAC sample's second copy of its terrain, a member of model group
  // type 800214, which has no placed instance.
  const [unplaced] = scanElementHeaders(page(header(800334, { category: -2001340, unplacedOwner: 800214 })));
  assert.equal(unplaced?.unplacedOwnerId, 800214);
  assert.equal(nonModelReason(unplaced, undefined), "unplaced");
  const [placed] = scanElementHeaders(page(header(411452, { category: -2001340 })));
  assert.equal(placed?.unplacedOwnerId, undefined);
  assert.equal(nonModelReason(placed, undefined), null);
});

test("a family type is not a placed element, whatever its category", () => {
  const records = [
    { elementId: 147401, categoryId: -2000023 }, // a door type's per-host copy
    { elementId: 147400, categoryId: -2000023 }, // the door itself
  ];
  const excluded = nonModelElementIds(records, undefined, new Set([147401]));
  assert.equal(excluded.get(147401), "type");
  assert.equal(excluded.has(147400), false);
});

test("slab edges and entourage without a bounds record may still be drawn", async () => {
  const { boundlessSceneElements } = await import("../lib/reviter/model-elements.ts");
  const header = (elementId: number, categoryId: number, extra = {}) =>
    [elementId, { elementId, categoryId, familyId: null, ownerViewId: null, designOptionId: null, ...extra }] as const;
  const elements = boundlessSceneElements(new Map([
    header(217846, -2001392), // a slab edge
    header(950367, -2001370), // placed entourage
    header(217850, -2001392, { familyId: 9 }), // inside a family's definition
    header(217851, -2000127), // a baluster: not listed
    header(217852, -2001392), // already has a record
  ]), new Set([217852]));
  assert.deepEqual([...elements], [[217846, -2001392], [950367, -2001370]]);
});
