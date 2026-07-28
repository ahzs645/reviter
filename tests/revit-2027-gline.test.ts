import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027GLine,
  REVIT_2027_GLINE_BODY_BYTES,
  REVIT_2027_GLINE_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-gline.ts";

function fixture(): Uint8Array {
  const data = new Uint8Array(REVIT_2027_GLINE_BODY_BYTES);
  const view = new DataView(data.buffer);
  view.setBigInt64(0, -1n, true);
  view.setInt32(8, -1, true);
  view.setInt32(12, 0, true);
  view.setUint32(16, 0x0108_8004, true);
  [0, 4.5].forEach((value, index) =>
    view.setFloat64(20 + index * 8, value, true),
  );
  [-27, 56, 0].forEach((value, index) =>
    view.setFloat64(36 + index * 8, value, true),
  );
  [-1, 0, 0].forEach((value, index) =>
    view.setFloat64(60 + index * 8, value, true),
  );
  return data;
}

test("decodes the exact release-gated Revit 2027 GLine body", () => {
  const data = fixture();
  const decoded = decodeRevit2027GLine(data, 0, data.byteLength, 2027);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;

  assert.equal(REVIT_2027_GLINE_SOURCE_CLASS_SLOT, 1973);
  assert.equal(decoded.value.endOffset, REVIT_2027_GLINE_BODY_BYTES);
  assert.deepEqual(decoded.value.endParameters, [0, 4.5]);
  assert.deepEqual(decoded.value.origin, [-27, 56, 0]);
  assert.deepEqual(decoded.value.direction, [-1, 0, 0]);
});

test("rejects another release, another body size, and invalid geometry", () => {
  const data = fixture();
  assert.equal(
    decodeRevit2027GLine(data, 0, data.byteLength, 2026).ok,
    false,
  );
  assert.equal(
    decodeRevit2027GLine(data, 0, data.byteLength - 1, 2027).ok,
    false,
  );

  const nonFinite = fixture();
  new DataView(nonFinite.buffer).setFloat64(36, Number.NaN, true);
  assert.equal(
    decodeRevit2027GLine(nonFinite, 0, nonFinite.byteLength, 2027).ok,
    false,
  );

  const degenerate = fixture();
  const degenerateView = new DataView(degenerate.buffer);
  [0, 0, 0].forEach((value, index) =>
    degenerateView.setFloat64(60 + index * 8, value, true),
  );
  assert.equal(
    decodeRevit2027GLine(degenerate, 0, degenerate.byteLength, 2027).ok,
    false,
  );
});
