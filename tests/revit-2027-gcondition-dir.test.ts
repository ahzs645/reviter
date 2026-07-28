import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027GConditionDir,
  REVIT_2027_GCONDITION_DIR_BODY_BYTES,
  REVIT_2027_GCONDITION_DIR_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-gcondition-dir.ts";
import {
  createRevit2027GRepReplayRegistry,
} from "../lib/reviter/revit-2027-grep-replay.ts";

function fixture(): Uint8Array {
  const data = new Uint8Array(REVIT_2027_GCONDITION_DIR_BODY_BYTES);
  const view = new DataView(data.buffer);
  view.setInt32(0, 8, true);
  view.setFloat64(4, 0, true);
  view.setFloat64(12, 0, true);
  view.setFloat64(20, 1, true);
  data[28] = 1;
  return data;
}

test("decodes the exact Revit 2027 GConditionDir body", () => {
  const data = fixture();
  const decoded = decodeRevit2027GConditionDir(data, 0, data.byteLength, 2027);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.compareMode, 8);
  assert.deepEqual(decoded.value.direction, [0, 0, 1]);
  assert.equal(decoded.value.negateDirectionCondition, true);
  assert.equal(decoded.value.endOffset, 29);
});

test("GConditionDir decoder fails closed", () => {
  const data = fixture();
  assert.equal(
    decodeRevit2027GConditionDir(data, 0, data.byteLength, 2026).ok,
    false,
  );
  assert.equal(
    decodeRevit2027GConditionDir(data, 0, data.byteLength - 1, 2027).ok,
    false,
  );
  new DataView(data.buffer).setFloat64(20, Number.NaN, true);
  assert.equal(
    decodeRevit2027GConditionDir(data, 0, data.byteLength, 2027).ok,
    false,
  );
});

test("default Revit 2027 FIFO registry includes GConditionDir", () => {
  assert.equal(REVIT_2027_GCONDITION_DIR_SOURCE_CLASS_SLOT, 2235);
  assert.equal(
    createRevit2027GRepReplayRegistry().get(
      REVIT_2027_GCONDITION_DIR_SOURCE_CLASS_SLOT,
    )?.id,
    "Revit2027GConditionDir",
  );
});
