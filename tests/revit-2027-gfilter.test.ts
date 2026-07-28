import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027GFilter,
  REVIT_2027_GFILTER_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-gfilter.ts";
import {
  createRevit2027GRepReplayRegistry,
} from "../lib/reviter/revit-2027-grep-replay.ts";

function fixture(): Uint8Array {
  // GInfo(20), inherited subnode count + two six-byte descriptors,
  // condition count + one descriptor, and the final bool.
  const data = new Uint8Array(20 + 4 + 12 + 4 + 6 + 1);
  const view = new DataView(data.buffer);
  view.setBigInt64(0, -1n, true);
  view.setInt32(8, -1, true);
  view.setInt32(12, 0, true);
  view.setUint32(16, 0x0008_8004, true);
  view.setInt32(20, 2, true);
  view.setInt32(24, 6, true);
  view.setInt16(28, REVIT_2027_GFILTER_SOURCE_CLASS_SLOT, true);
  view.setInt32(30, 7, true);
  view.setInt16(34, 2215, true);
  view.setInt32(36, 1, true);
  view.setInt32(40, 8, true);
  view.setInt16(44, 2279, true);
  data[46] = 1;
  return data;
}

test("decodes GFilter collections in native FIFO insertion order", () => {
  const data = fixture();
  const decoded = decodeRevit2027GFilter(
    data,
    0,
    data.byteLength,
    2027,
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual(
    decoded.value.group.children.map((entry) => [
      entry.token,
      entry.sourceClassSlot,
    ]),
    [
      [6, REVIT_2027_GFILTER_SOURCE_CLASS_SLOT],
      [7, 2215],
    ],
  );
  assert.deepEqual(
    decoded.value.conditions.map((entry) => [
      entry.token,
      entry.sourceClassSlot,
    ]),
    [[8, 2279]],
  );
  assert.deepEqual(
    decoded.value.queuedProperties.map((entry) => entry.token),
    [6, 7, 8],
  );
  assert.equal(decoded.value.isNestedDetailFamily, true);
  assert.equal(decoded.value.endOffset, data.byteLength);
});

test("GFilter decoder fails closed on release, boundary, and boolean", () => {
  const data = fixture();
  assert.equal(decodeRevit2027GFilter(data, 0, data.byteLength, 2026).ok, false);
  assert.equal(
    decodeRevit2027GFilter(data, 0, data.byteLength - 1, 2027).ok,
    false,
  );
  data[data.byteLength - 1] = 2;
  assert.equal(decodeRevit2027GFilter(data, 0, data.byteLength, 2027).ok, false);
});

test("default Revit 2027 FIFO registry includes GFilter", () => {
  assert.equal(
    createRevit2027GRepReplayRegistry().get(
      REVIT_2027_GFILTER_SOURCE_CLASS_SLOT,
    )?.id,
    "Revit2027GFilter",
  );
});
