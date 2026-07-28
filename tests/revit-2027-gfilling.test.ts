import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027GFilling,
  REVIT_2027_GFILLING_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-gfilling.ts";

function writePoint2d(
  view: DataView,
  byteOffset: number,
  value: readonly [number, number],
): number {
  view.setFloat64(byteOffset, value[0], true);
  view.setFloat64(byteOffset + 8, value[1], true);
  return byteOffset + 16;
}

function fixture(dataToken: number): Uint8Array {
  const data = new Uint8Array(dataToken === 0 ? 102 : 104);
  const view = new DataView(data.buffer);
  view.setBigInt64(0, 25n, true);
  view.setInt32(8, 19, true);
  view.setInt32(12, 4, true);
  view.setUint32(16, 6, true);
  view.setInt32(20, 812, true);

  let cursor = 24;
  view.setFloat64(cursor, 2.5, true);
  cursor += 8;
  cursor = writePoint2d(view, cursor, [10, 20]);
  cursor = writePoint2d(view, cursor, [0, 1]);
  cursor = writePoint2d(view, cursor, [3, 4]);
  view.setUint8(cursor, 1);
  view.setUint8(cursor + 1, 0);
  cursor += 2;

  view.setInt32(cursor, dataToken, true);
  cursor += 4;
  if (dataToken !== 0) {
    view.setInt16(cursor, 3099, true);
    cursor += 2;
  }
  view.setBigInt64(cursor, 182549n, true);
  cursor += 8;
  view.setUint32(cursor, 0xff336699, true);
  cursor += 4;
  view.setInt32(cursor, -7, true);
  cursor += 4;
  assert.equal(cursor, data.byteLength);
  return data;
}

test("decodes the exact Revit 2027 GFilling body and inline placer", () => {
  const data = fixture(11);
  const decoded = decodeRevit2027GFilling(data, 0, data.byteLength, 2027);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(REVIT_2027_GFILLING_SOURCE_CLASS_SLOT, 2253);
  assert.deepEqual(decoded.value.gInfo, {
    gStyleElementId: 25n,
    tag: 19,
    controlCommand: 4,
    flags: 6,
  });
  assert.equal(decoded.value.faceIdReference, 812);
  assert.deepEqual(decoded.value.placer, {
    byteOffset: 24,
    endOffset: 82,
    scale: 2.5,
    origin: [10, 20],
    direction: [0, 1],
    uvScale: [3, 4],
    mirrored: true,
    placedDraft: false,
  });
  assert.deepEqual(
    decoded.value.queuedProperties.map(({ token, sourceClassSlot }) => ({
      token,
      sourceClassSlot,
    })),
    [{ token: 11, sourceClassSlot: 3099 }],
  );
  assert.equal(decoded.value.patternElementId, 182549n);
  assert.equal(decoded.value.fillColor, 0xff336699);
  assert.equal(decoded.value.flags, -7);
  assert.equal(decoded.value.endOffset, 104);
});

test("retains the native negative-one Data sentinel", () => {
  const data = fixture(-1);
  const decoded = decodeRevit2027GFilling(data, 0, data.byteLength, 2027);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.data.token, -1);
  assert.equal(decoded.value.data.sourceClassSlot, 3099);
  assert.equal(decoded.value.queuedProperties.length, 1);
});

test("does not enqueue a null Data descriptor", () => {
  const data = fixture(0);
  const decoded = decodeRevit2027GFilling(data, 0, data.byteLength, 2027);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.data.sourceClassSlot, null);
  assert.deepEqual(decoded.value.queuedProperties, []);
  assert.equal(decoded.value.endOffset, 102);
});

test("fails closed on release, bounds, booleans, finite values, and slots", () => {
  const data = fixture(11);
  assert.equal(
    decodeRevit2027GFilling(data, 0, data.byteLength, 2026).ok,
    false,
  );
  assert.equal(
    decodeRevit2027GFilling(data, 0, data.byteLength - 1, 2027).ok,
    false,
  );

  data[80] = 2;
  assert.equal(
    decodeRevit2027GFilling(data, 0, data.byteLength, 2027).ok,
    false,
  );
  data[80] = 1;

  const view = new DataView(data.buffer);
  view.setFloat64(24, Number.NaN, true);
  assert.equal(
    decodeRevit2027GFilling(data, 0, data.byteLength, 2027).ok,
    false,
  );
  view.setFloat64(24, 2.5, true);

  view.setInt16(86, -5, true);
  assert.equal(
    decodeRevit2027GFilling(data, 0, data.byteLength, 2027).ok,
    false,
  );
});
