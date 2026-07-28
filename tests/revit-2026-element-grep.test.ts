import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2026ElementAndGRepStatic,
  REVIT_2026_ELEMENT_AND_GREP_SOURCE_CLASS,
} from "../lib/reviter/revit-2026-element-grep.ts";

test("decodes the complete Revit 2026 ElementAndGRep static carrier", () => {
  const data = new Uint8Array(24);
  const view = new DataView(data.buffer);
  view.setBigUint64(2, 400_237n, true);
  view.setInt32(10, -1, true);
  view.setInt16(14, 754, true);
  view.setInt32(16, 1, true);
  view.setInt16(20, 2206, true);

  const result = decodeRevit2026ElementAndGRepStatic(data, 2);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(REVIT_2026_ELEMENT_AND_GREP_SOURCE_CLASS, 1479);
  assert.equal(result.value.elementId, 400_237n);
  assert.deepEqual(result.value.elementDescriptor, {
    byteOffset: 10,
    endOffset: 16,
    token: -1,
    sourceClassSlot: 754,
  });
  assert.deepEqual(result.value.gRepDescriptor, {
    byteOffset: 16,
    endOffset: 22,
    token: 1,
    sourceClassSlot: 2206,
  });
  assert.equal(result.endOffset, 22);
});

test("preserves null ElementAndGRep pointers without reading class slots", () => {
  const data = new Uint8Array(16);
  const view = new DataView(data.buffer);
  view.setBigUint64(0, 9n, true);
  view.setInt32(8, 0, true);
  view.setInt32(12, 0, true);

  const result = decodeRevit2026ElementAndGRepStatic(data, 0);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.elementDescriptor.sourceClassSlot, null);
  assert.equal(result.value.gRepDescriptor.sourceClassSlot, null);
  assert.equal(result.endOffset, 16);
});

test("fails closed on truncated or invalid ElementAndGRep descriptors", () => {
  const truncatedId = decodeRevit2026ElementAndGRepStatic(
    new Uint8Array(7),
    0,
  );
  assert.equal(truncatedId.ok, false);
  if (!truncatedId.ok) assert.match(truncatedId.error, /element id is truncated/);

  const truncatedGRep = new Uint8Array(13);
  const truncatedView = new DataView(truncatedGRep.buffer);
  truncatedView.setInt32(8, 0, true);
  const missing = decodeRevit2026ElementAndGRepStatic(truncatedGRep, 0);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /GRep descriptor/);

  const invalidSlot = new Uint8Array(20);
  const invalidView = new DataView(invalidSlot.buffer);
  invalidView.setInt32(8, 1, true);
  invalidView.setInt16(12, -1, true);
  const invalid = decodeRevit2026ElementAndGRepStatic(invalidSlot, 0);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.match(invalid.error, /element descriptor.*not positive/i);
});
