import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027GConditionCut,
  REVIT_2027_GCONDITION_CUT_BODY_BYTES,
  REVIT_2027_GCONDITION_CUT_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-gcondition-cut.ts";
import {
  createRevit2027GRepReplayRegistry,
} from "../lib/reviter/revit-2027-grep-replay.ts";

function fixture(): Uint8Array {
  const data = new Uint8Array(REVIT_2027_GCONDITION_CUT_BODY_BYTES);
  const view = new DataView(data.buffer);
  view.setInt32(0, 6, true);
  view.setFloat64(4, 0, true);
  view.setFloat64(12, 0, true);
  view.setFloat64(20, 1, true);
  data[28] = 0;
  view.setFloat64(29, -0.25, true);
  view.setFloat64(37, 4.125, true);
  return data;
}

test("decodes the exact Revit 2027 GConditionCut body", () => {
  const data = fixture();
  const decoded = decodeRevit2027GConditionCut(data, 0, data.byteLength, 2027);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.compareMode, 6);
  assert.deepEqual(decoded.value.direction, [0, 0, 1]);
  assert.equal(decoded.value.negateDirectionCondition, false);
  assert.equal(decoded.value.rangeLow, -0.25);
  assert.equal(decoded.value.rangeHigh, 4.125);
  assert.equal(decoded.value.endOffset, 45);
});

test("GConditionCut decoder fails closed", () => {
  const data = fixture();
  assert.equal(
    decodeRevit2027GConditionCut(data, 0, data.byteLength - 1, 2027).ok,
    false,
  );
  new DataView(data.buffer).setFloat64(29, 5, true);
  assert.equal(
    decodeRevit2027GConditionCut(data, 0, data.byteLength, 2027).ok,
    false,
  );
});

test("default Revit 2027 FIFO registry includes GConditionCut", () => {
  assert.equal(REVIT_2027_GCONDITION_CUT_SOURCE_CLASS_SLOT, 2234);
  assert.equal(
    createRevit2027GRepReplayRegistry().get(
      REVIT_2027_GCONDITION_CUT_SOURCE_CLASS_SLOT,
    )?.id,
    "Revit2027GConditionCut",
  );
});
