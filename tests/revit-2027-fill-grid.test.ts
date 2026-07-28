import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027FillGrid,
  REVIT_2027_FILL_GRID_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-fill-grid.ts";

test("exports the exact Revit 2027 FillGrid source slot", () => {
  assert.equal(REVIT_2027_FILL_GRID_SOURCE_CLASS_SLOT, 2085);
});

test("decodes angle, origin, deltas, and counted segments", () => {
  const data = new Uint8Array(68);
  const view = new DataView(data.buffer);
  view.setFloat64(0, Math.PI / 3, true);
  view.setFloat64(8, 12.5, true);
  view.setFloat64(16, -4.25, true);
  view.setFloat64(24, 2.5, true);
  view.setFloat64(32, 7.75, true);
  view.setInt32(40, 3, true);
  view.setFloat64(44, 1.25, true);
  view.setFloat64(52, -0.5, true);
  view.setFloat64(60, 9, true);

  const decoded = decodeRevit2027FillGrid(
    data,
    0,
    data.byteLength,
    2027,
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual(decoded.value, {
    byteOffset: 0,
    endOffset: 68,
    angle: Math.PI / 3,
    origin: [12.5, -4.25],
    deltas: [2.5, 7.75],
    segments: [1.25, -0.5, 9],
  });
});

test("accepts an empty segment array", () => {
  const data = new Uint8Array(44);
  const view = new DataView(data.buffer);
  view.setFloat64(0, 1, true);
  view.setFloat64(8, 2, true);
  view.setFloat64(16, 3, true);
  view.setFloat64(24, 4, true);
  view.setFloat64(32, 5, true);
  view.setInt32(40, 0, true);

  const decoded = decodeRevit2027FillGrid(
    data,
    0,
    data.byteLength,
    2027,
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual(decoded.value.segments, []);
  assert.equal(decoded.value.endOffset, 44);
});

test("fails closed on release, bounds, count, and non-finite values", () => {
  const data = new Uint8Array(52);
  const view = new DataView(data.buffer);
  for (let index = 0; index < 5; index += 1) {
    view.setFloat64(index * 8, index + 1, true);
  }
  view.setInt32(40, 1, true);
  view.setFloat64(44, 6, true);

  assert.equal(
    decodeRevit2027FillGrid(data, 0, data.length, 2026).ok,
    false,
  );
  assert.equal(
    decodeRevit2027FillGrid(data, 0, 43, 2027).ok,
    false,
  );
  assert.equal(
    decodeRevit2027FillGrid(data, 0, data.length, 2027, {
      maxSegments: -1,
    }).ok,
    false,
  );

  view.setInt32(40, 2, true);
  assert.equal(
    decodeRevit2027FillGrid(data, 0, data.length, 2027).ok,
    false,
  );
  view.setInt32(40, -1, true);
  assert.equal(
    decodeRevit2027FillGrid(data, 0, data.length, 2027).ok,
    false,
  );

  view.setInt32(40, 1, true);
  view.setFloat64(8, Number.NaN, true);
  assert.equal(
    decodeRevit2027FillGrid(data, 0, data.length, 2027).ok,
    false,
  );
  view.setFloat64(8, 2, true);
  view.setFloat64(44, Number.POSITIVE_INFINITY, true);
  assert.equal(
    decodeRevit2027FillGrid(data, 0, data.length, 2027).ok,
    false,
  );
});
