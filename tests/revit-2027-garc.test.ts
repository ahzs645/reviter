import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027GArc,
  REVIT_2027_GARC_BODY_BYTES,
  REVIT_2027_GARC_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-garc.ts";

function fixture(): Uint8Array {
  const data = new Uint8Array(REVIT_2027_GARC_BODY_BYTES);
  const view = new DataView(data.buffer);
  view.setBigInt64(0, -1n, true);
  view.setInt32(8, 12, true);
  view.setInt32(12, 3, true);
  view.setUint32(16, 0x01080004, true);
  view.setFloat64(20, 0, true);
  view.setFloat64(28, Math.PI, true);
  view.setFloat64(36, 1, true);
  view.setFloat64(44, 0, true);
  view.setFloat64(52, 0, true);
  view.setFloat64(60, 0, true);
  view.setFloat64(68, 1, true);
  view.setFloat64(76, 0, true);
  view.setFloat64(84, 2.5, true);
  view.setFloat64(92, 10, true);
  view.setFloat64(100, -4, true);
  view.setFloat64(108, 7, true);
  data[116] = 1;
  return data;
}

test("exports the exact Revit 2027 GArc source slot and width", () => {
  assert.equal(REVIT_2027_GARC_SOURCE_CLASS_SLOT, 2213);
  assert.equal(REVIT_2027_GARC_BODY_BYTES, 117);
});

test("decodes the inherited curve and complete GArc body", () => {
  const data = fixture();
  const decoded = decodeRevit2027GArc(data, 0, data.length, 2027);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual(decoded.value, {
    byteOffset: 0,
    endOffset: 117,
    gInfo: {
      gStyleElementId: -1n,
      tag: 12,
      controlCommand: 3,
      flags: 0x01080004,
    },
    endParameters: [0, Math.PI],
    xDirection: [1, 0, 0],
    yDirection: [0, 1, 0],
    radius: 2.5,
    center: [10, -4, 7],
    isFilled: true,
  });
});

test("decodes from a bounded offset without claiming owner padding", () => {
  const body = fixture();
  const data = new Uint8Array(body.length + 19);
  data.set(body, 7);
  const decoded = decodeRevit2027GArc(data, 7, data.length, 2027);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.byteOffset, 7);
  assert.equal(decoded.value.endOffset, 124);
});

test("fails closed on release, bounds, scalars, basis, radius, and flag", () => {
  const data = fixture();
  assert.equal(decodeRevit2027GArc(data, 0, data.length, 2026).ok, false);
  assert.equal(decodeRevit2027GArc(data, 0, 116, 2027).ok, false);

  const view = new DataView(data.buffer);
  view.setFloat64(20, Number.NaN, true);
  assert.equal(decodeRevit2027GArc(data, 0, data.length, 2027).ok, false);
  view.setFloat64(20, 0, true);

  view.setFloat64(36, 0, true);
  assert.equal(decodeRevit2027GArc(data, 0, data.length, 2027).ok, false);
  view.setFloat64(36, 1, true);

  view.setFloat64(84, -1, true);
  assert.equal(decodeRevit2027GArc(data, 0, data.length, 2027).ok, false);
  view.setFloat64(84, 2.5, true);

  data[116] = 2;
  assert.equal(decodeRevit2027GArc(data, 0, data.length, 2027).ok, false);
});
