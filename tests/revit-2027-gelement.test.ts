import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027GElementStatic,
} from "../lib/reviter/revit-2027-gelement.ts";

function writeExtents(
  view: DataView,
  byteOffset: number,
  values: readonly number[],
): void {
  values.forEach((value, index) =>
    view.setFloat64(byteOffset + index * 8, value, true));
}

test("decodes the complete selector-free queued GElement body", () => {
  const data = new Uint8Array(148);
  const view = new DataView(data.buffer);
  view.setBigInt64(0, -1n, true);
  view.setInt32(8, 17, true);
  view.setUint32(16, 0x0008_8004, true);
  view.setInt32(20, 2, true);
  view.setInt32(24, 8, true);
  view.setInt16(28, 2_254, true);
  view.setInt32(30, 9, true);
  view.setInt16(34, 2_254, true);
  writeExtents(view, 36, [-1, -2, -3, 1, 2, 3]);
  writeExtents(view, 84, [9, 18, 27, 11, 22, 33]);
  view.setBigInt64(132, 1_731_963n, true);
  view.setInt32(140, 3, true);
  view.setUint32(144, 2, true);

  const decoded = decodeRevit2027GElementStatic(
    data,
    0,
    data.byteLength,
    2027,
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.endOffset, 148);
  assert.deepEqual(
    decoded.value.children.map((child) => [
      child.token,
      child.sourceClassSlot,
    ]),
    [[8, 2_254], [9, 2_254]],
  );
  assert.deepEqual(decoded.value.localExtents.minimum, [-1, -2, -3]);
  assert.deepEqual(decoded.value.worldExtents.maximum, [11, 22, 33]);
  assert.equal(decoded.value.elementId, 1_731_963n);
  assert.equal(decoded.value.objectType, 3);
  assert.equal(decoded.value.flags, 2);
});

test("queued GElement fails closed on release, tail, and invalid extents", () => {
  const data = new Uint8Array(136);
  const view = new DataView(data.buffer);
  view.setInt32(20, 0, true);
  writeExtents(view, 24, [-1, -2, -3, 1, 2, 3]);
  writeExtents(view, 72, [-1, -2, -3, 1, 2, 3]);

  assert.equal(
    decodeRevit2027GElementStatic(data, 0, data.byteLength, 2026).ok,
    false,
  );
  assert.equal(
    decodeRevit2027GElementStatic(data, 0, data.byteLength - 1, 2027).ok,
    false,
  );
  view.setFloat64(24, Number.NaN, true);
  const invalid = decodeRevit2027GElementStatic(
    data,
    0,
    data.byteLength,
    2027,
  );
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.match(invalid.error, /invalid local extents/);
});
