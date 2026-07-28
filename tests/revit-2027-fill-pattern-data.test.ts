import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027FillPatternData,
  REVIT_2027_FILL_PATTERN_DATA_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-fill-pattern-data.ts";

test("exports the exact Revit 2027 FillPatternData source slot", () => {
  assert.equal(REVIT_2027_FILL_PATTERN_DATA_SOURCE_CLASS_SLOT, 2087);
});

test("decodes four statistics and the CondInt16 grid collection", () => {
  const data = new Uint8Array(52);
  const view = new DataView(data.buffer);
  view.setFloat64(0, 12.5, true);
  view.setFloat64(8, 3.25, true);
  view.setFloat64(16, 9.5, true);
  view.setFloat64(24, 2.75, true);
  view.setInt32(32, 3, true);
  view.setInt32(36, 0, true);
  view.setInt32(40, -1, true);
  view.setInt16(44, 3100, true);
  view.setInt32(46, 7, true);
  view.setInt16(50, 3101, true);

  const decoded = decodeRevit2027FillPatternData(
    data,
    0,
    data.byteLength,
    2027,
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual(
    {
      windowSize: decoded.value.windowSize,
      lengthPerArea: decoded.value.lengthPerArea,
      strokesPerArea: decoded.value.strokesPerArea,
      linesPerLength: decoded.value.linesPerLength,
      endOffset: decoded.value.endOffset,
    },
    {
      windowSize: 12.5,
      lengthPerArea: 3.25,
      strokesPerArea: 9.5,
      linesPerLength: 2.75,
      endOffset: 52,
    },
  );
  assert.deepEqual(
    decoded.value.fillGrids.map(({ token, sourceClassSlot }) => ({
      token,
      sourceClassSlot,
    })),
    [
      { token: 0, sourceClassSlot: null },
      { token: -1, sourceClassSlot: 3100 },
      { token: 7, sourceClassSlot: 3101 },
    ],
  );
  assert.deepEqual(
    decoded.value.queuedProperties.map(({ token, sourceClassSlot }) => ({
      token,
      sourceClassSlot,
    })),
    [
      { token: -1, sourceClassSlot: 3100 },
      { token: 7, sourceClassSlot: 3101 },
    ],
  );
});

test("fails closed on release, bounds, count, scalar, and descriptors", () => {
  const data = new Uint8Array(40);
  const view = new DataView(data.buffer);
  view.setFloat64(0, 1, true);
  view.setFloat64(8, 2, true);
  view.setFloat64(16, 3, true);
  view.setFloat64(24, 4, true);
  view.setInt32(32, 1, true);
  view.setInt32(36, 0, true);

  assert.equal(
    decodeRevit2027FillPatternData(data, 0, data.length, 2026).ok,
    false,
  );
  assert.equal(
    decodeRevit2027FillPatternData(data, 0, 35, 2027).ok,
    false,
  );
  assert.equal(
    decodeRevit2027FillPatternData(data, 0, data.length, 2027, {
      maxFillGrids: -1,
    }).ok,
    false,
  );
  view.setInt32(32, 2, true);
  assert.equal(
    decodeRevit2027FillPatternData(data, 0, data.length, 2027).ok,
    false,
  );
  view.setInt32(32, -1, true);
  assert.equal(
    decodeRevit2027FillPatternData(data, 0, data.length, 2027).ok,
    false,
  );
  view.setInt32(32, 1, true);
  view.setFloat64(0, Number.NaN, true);
  assert.equal(
    decodeRevit2027FillPatternData(data, 0, data.length, 2027).ok,
    false,
  );
});
