import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027GBiFlipControl,
  REVIT_2027_GBI_FLIP_CONTROL_BODY_BYTES,
  REVIT_2027_GBI_FLIP_CONTROL_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-gbi-flip-control.ts";
import {
  createRevit2027GRepReplayRegistry,
} from "../lib/reviter/revit-2027-grep-replay.ts";

function fixture(): Uint8Array {
  const data = new Uint8Array(REVIT_2027_GBI_FLIP_CONTROL_BODY_BYTES);
  const view = new DataView(data.buffer);
  view.setBigInt64(0, 42n, true);
  view.setInt32(8, 9, true);
  view.setInt32(12, -3, true);
  view.setUint32(16, 0x8000_0001, true);
  [1, 2, 3].forEach((value, index) => {
    view.setFloat64(20 + index * 8, value, true);
  });
  [4, 5, 6].forEach((value, index) => {
    view.setFloat64(44 + index * 8, value, true);
  });
  view.setFloat64(68, 7.5, true);
  return data;
}

test("decodes the exact Revit 2027 GBiFlipControl body", () => {
  const decoded = decodeRevit2027GBiFlipControl(
    fixture(),
    0,
    REVIT_2027_GBI_FLIP_CONTROL_BODY_BYTES,
    2027,
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual(decoded.value.gInfo, {
    gStyleElementId: 42n,
    tag: 9,
    controlCommand: -3,
    flags: 0x8000_0001,
  });
  assert.deepEqual(decoded.value.origin, [1, 2, 3]);
  assert.deepEqual(decoded.value.base, [4, 5, 6]);
  assert.equal(decoded.value.length, 7.5);
  assert.equal(decoded.value.endOffset, 76);
});

test("GBiFlipControl decoder fails closed", () => {
  const data = fixture();
  assert.equal(
    decodeRevit2027GBiFlipControl(data, 0, data.byteLength - 1, 2027).ok,
    false,
  );
  assert.equal(
    decodeRevit2027GBiFlipControl(data, 0, data.byteLength, 2026).ok,
    false,
  );

  new DataView(data.buffer).setFloat64(68, Number.NaN, true);
  assert.equal(
    decodeRevit2027GBiFlipControl(data, 0, data.byteLength, 2027).ok,
    false,
  );
});

test("default Revit 2027 FIFO registry includes GBiFlipControl", () => {
  assert.equal(REVIT_2027_GBI_FLIP_CONTROL_SOURCE_CLASS_SLOT, 2219);
  assert.equal(
    createRevit2027GRepReplayRegistry().get(
      REVIT_2027_GBI_FLIP_CONTROL_SOURCE_CLASS_SLOT,
    )?.id,
    "Revit2027GBiFlipControl",
  );
});
