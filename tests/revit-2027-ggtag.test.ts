import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027GGTag,
  REVIT_2027_GGTAG_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-ggtag.ts";
import {
  createRevit2027GRepReplayRegistry,
} from "../lib/reviter/revit-2027-grep-replay.ts";

function fixture(): Uint8Array {
  // GInfo(20), inherited child collection, point triple, and two booleans.
  const data = new Uint8Array(20 + 4 + 6 + 24 + 2);
  const view = new DataView(data.buffer);
  view.setBigInt64(0, -1n, true);
  view.setInt32(8, -1, true);
  view.setInt32(12, 0, true);
  view.setUint32(16, 0x0008_8004, true);
  view.setInt32(20, 1, true);
  view.setInt32(24, 8, true);
  view.setInt16(28, 2343, true);
  view.setFloat64(30, 1.25, true);
  view.setFloat64(38, -2.5, true);
  view.setFloat64(46, 3.75, true);
  data[54] = 1;
  data[55] = 0;
  return data;
}

test("decodes GGTag group children and exact derived fields", () => {
  const data = fixture();
  const decoded = decodeRevit2027GGTag(
    data,
    0,
    data.byteLength,
    2027,
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual(decoded.value.modelTestPoint, [1.25, -2.5, 3.75]);
  assert.equal(decoded.value.useModelTestPoint, true);
  assert.equal(decoded.value.selectByModelTestPoint, false);
  assert.deepEqual(
    decoded.value.queuedProperties.map((entry) => [
      entry.token,
      entry.sourceClassSlot,
    ]),
    [[8, 2343]],
  );
  assert.equal(decoded.value.endOffset, data.byteLength);
});

test("GGTag rejects release, truncation, non-finite point, and bad booleans", () => {
  const data = fixture();
  assert.equal(
    decodeRevit2027GGTag(data, 0, data.byteLength, 2026).ok,
    false,
  );
  assert.equal(
    decodeRevit2027GGTag(data, 0, data.byteLength - 1, 2027).ok,
    false,
  );

  const nonFinite = fixture();
  new DataView(nonFinite.buffer).setFloat64(30, Number.NaN, true);
  assert.equal(
    decodeRevit2027GGTag(nonFinite, 0, nonFinite.byteLength, 2027).ok,
    false,
  );

  const badBoolean = fixture();
  badBoolean[55] = 2;
  assert.equal(
    decodeRevit2027GGTag(
      badBoolean,
      0,
      badBoolean.byteLength,
      2027,
    ).ok,
    false,
  );
});

test("default Revit 2027 FIFO registry includes GGTag", () => {
  assert.equal(
    createRevit2027GRepReplayRegistry().get(
      REVIT_2027_GGTAG_SOURCE_CLASS_SLOT,
    )?.id,
    "Revit2027GGTag",
  );
});
