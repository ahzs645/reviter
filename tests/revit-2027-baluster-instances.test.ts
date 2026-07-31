import assert from "node:assert/strict";
import test from "node:test";

import type { ElementObject } from "../lib/reviter/element-objects.ts";
import {
  decodeRevit2027BalusterInstanceDefinition,
  decodeRevit2027TopRailTypeEvidence,
  decodeRevit2027TopRailTypeCurves,
  deduplicateRevit2027BalusterDefinitions,
  REVIT_2027_BASE_RAILING_SYMBOL_MARKER,
  REVIT_2027_CURVE_LOOP_SOURCE_CLASS_SLOT,
  REVIT_2027_RAILING_CURVE_LOOP_DATA_SOURCE_CLASS_SLOT,
  REVIT_2027_TOP_RAIL_TYPE_MARKER,
  validateRevit2027BalusterDefinitionSymbols,
} from "../lib/reviter/revit-2027-baluster-instances.ts";

const DERIVED_OFFSET = 149;
const PARAM_BYTES = 57;
const GINSTANCE_BYTES = 44;
const INSTANCE_INFO_BYTES = 112;

type Fixture = {
  data: Uint8Array;
  frame: ElementObject;
  offsets: {
    paramsCount: number;
    firstParam: number;
    firstInstanceInfo: number;
  };
};

function writeDescriptor(
  view: DataView,
  byteOffset: number,
  token: number,
  sourceClassSlot: number,
): number {
  view.setInt32(byteOffset, token, true);
  view.setInt16(byteOffset + 4, sourceClassSlot, true);
  return byteOffset + 6;
}

function writeTransform(
  view: DataView,
  byteOffset: number,
  origin: readonly [number, number, number],
): void {
  const values = [
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
    ...origin,
  ];
  values.forEach((value, index) =>
    view.setFloat64(byteOffset + index * 8, value, true)
  );
}

function fixture(
  count = 2,
  paramSymbols = Array.from({ length: count }, (_, index) => 500 + index),
  instanceSymbols = Array.from({ length: count }, (_, index) => 500 + index),
): Fixture {
  assert.equal(instanceSymbols.length, count);
  const paramsCountValue = paramSymbols.length;
  const staticBytes =
    DERIVED_OFFSET +
    4 +
    4 +
    count * 6 +
    4 +
    paramsCountValue * PARAM_BYTES +
    4 +
    4 +
    8 +
    8 +
    35;
  const dynamicBytes =
    7 +
    count * GINSTANCE_BYTES +
    5 +
    count * INSTANCE_INFO_BYTES;
  const objectLength = staticBytes + dynamicBytes;
  const data = new Uint8Array(objectLength + 20);
  const view = new DataView(data.buffer);
  const ownerElementId = 200;
  const baseRailingElementId = 100;
  view.setUint32(0, ownerElementId, true);
  view.setUint32(12, objectLength, true);
  view.setUint16(16, REVIT_2027_BASE_RAILING_SYMBOL_MARKER, true);
  view.setUint32(18, 0, true);

  let cursor = DERIVED_OFFSET;
  view.setInt32(cursor, 0, true);
  cursor += 4;
  view.setInt32(cursor, count, true);
  cursor += 4;
  for (let index = 0; index < count; index += 1) {
    cursor = writeDescriptor(view, cursor, index + 3, 2215);
  }
  const paramsCount = cursor;
  view.setInt32(cursor, paramsCountValue, true);
  cursor += 4;
  const firstParam = cursor;
  for (let index = 0; index < paramsCountValue; index += 1) {
    view.setFloat64(cursor, 0, true);
    view.setBigInt64(cursor + 8, BigInt(300 + index), true);
    view.setFloat64(cursor + 16, 3 + index / 10, true);
    view.setBigInt64(cursor + 24, BigInt(400 + index), true);
    view.setFloat64(cursor + 32, 0, true);
    view.setBigInt64(cursor + 40, BigInt(paramSymbols[index]!), true);
    view.setFloat64(cursor + 48, 0, true);
    data[cursor + 56] = 0;
    cursor += PARAM_BYTES;
  }
  view.setInt32(cursor, 0, true);
  cursor += 4;
  view.setInt32(cursor, 0, true);
  cursor += 4;
  view.setFloat64(cursor, 12, true);
  cursor += 8;
  view.setBigInt64(cursor, BigInt(baseRailingElementId), true);
  cursor += 8;
  view.setFloat64(cursor, 0, true);
  view.setFloat64(cursor + 8, 0, true);
  view.setFloat64(cursor + 16, 1, true);
  view.setFloat64(cursor + 24, 0, true);
  data[cursor + 32] = 1;
  data[cursor + 33] = 0;
  data[cursor + 34] = 0;
  cursor += 35;
  cursor += 7;

  for (let index = 0; index < count; index += 1) {
    const start = cursor;
    view.setBigInt64(start, -1n, true);
    view.setInt32(start + 8, index, true);
    view.setInt32(start + 12, 0, true);
    view.setUint32(start + 16, 0x0008_0004, true);
    writeDescriptor(view, start + 20, -1, 2513);
    view.setInt32(start + 26, 0, true);
    view.setBigInt64(start + 30, -1n, true);
    view.setInt32(start + 38, 0, true);
    data[start + 42] = 0;
    data[start + 43] = 0;
    cursor += GINSTANCE_BYTES;
  }
  cursor += 5;
  const firstInstanceInfo = cursor;
  for (let index = 0; index < count; index += 1) {
    writeTransform(view, cursor, [index, index * 2, index * 3]);
    view.setBigInt64(cursor + 96, BigInt(instanceSymbols[index]!), true);
    view.setInt32(cursor + 104, 0, true);
    view.setInt32(cursor + 108, 1, true);
    cursor += INSTANCE_INFO_BYTES;
  }
  assert.equal(cursor, objectLength);
  view.setUint32(objectLength + 16, objectLength, true);
  return {
    data,
    frame: {
      offset: 0,
      elementId: ownerElementId,
      objectLength,
      marker: REVIT_2027_BASE_RAILING_SYMBOL_MARKER,
      typeCode: 0,
    },
    offsets: { paramsCount, firstParam, firstInstanceInfo },
  };
}

test("decodes a byte-bounded BaseRailingSym station array", () => {
  const input = fixture();
  const decoded = decodeRevit2027BalusterInstanceDefinition(
    input.data,
    input.frame,
    2027,
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.ownerElementId, 200);
  assert.equal(decoded.value.baseRailingElementId, 100);
  assert.deepEqual(
    decoded.value.nestedInstances.map((instance) => ({
      target: Number(instance.symbolElementId),
      origin: instance.transform.origin,
      tag: instance.tagElementId,
    })),
    [
      { target: 500, origin: [0, 0, 0], tag: -1n },
      { target: 501, origin: [1, 2, 3], tag: -1n },
    ],
  );
  assert.deepEqual([...decoded.value.familySymbolElementIds], [300, 301]);
  assert.deepEqual(
    decoded.value.paramsAndIds.map(({ instanceElementId }) =>
      instanceElementId
    ),
    [400, 401],
  );
});

test("decodes params per referenced symbol rather than per station", () => {
  const input = fixture(3, [500], [500, 500, 500]);
  const decoded = decodeRevit2027BalusterInstanceDefinition(
    input.data,
    input.frame,
    2027,
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.paramsAndIds.length, 1);
  assert.equal(decoded.value.nestedInstances.length, 3);
  assert.deepEqual(
    decoded.value.nestedInstances.map((instance) =>
      Number(instance.symbolElementId)
    ),
    [500, 500, 500],
  );
});

test("rejects truncated framing and inconsistent symbol sets", () => {
  const truncated = fixture();
  const truncatedResult = decodeRevit2027BalusterInstanceDefinition(
    truncated.data.subarray(0, truncated.data.length - 1),
    truncated.frame,
    2027,
  );
  assert.equal(truncatedResult.ok, false);
  if (!truncatedResult.ok) assert.match(truncatedResult.error, /truncated/);

  const mismatch = fixture(2, [500], [500, 501]);
  const mismatchResult = decodeRevit2027BalusterInstanceDefinition(
    mismatch.data,
    mismatch.frame,
    2027,
  );
  assert.equal(mismatchResult.ok, false);
  if (!mismatchResult.ok) assert.match(mismatchResult.error, /InstanceInfo/);
});

test("rejects non-finite params and transforms", () => {
  const params = fixture();
  new DataView(params.data.buffer).setFloat64(
    params.offsets.firstParam + 16,
    Number.NaN,
    true,
  );
  const paramsResult = decodeRevit2027BalusterInstanceDefinition(
    params.data,
    params.frame,
    2027,
  );
  assert.equal(paramsResult.ok, false);
  if (!paramsResult.ok) assert.match(paramsResult.error, /non-finite/);

  const transform = fixture();
  new DataView(transform.data.buffer).setFloat64(
    transform.offsets.firstInstanceInfo,
    Number.POSITIVE_INFINITY,
    true,
  );
  const transformResult = decodeRevit2027BalusterInstanceDefinition(
    transform.data,
    transform.frame,
    2027,
  );
  assert.equal(transformResult.ok, false);
  if (!transformResult.ok) {
    assert.match(transformResult.error, /InstanceInfo body block/);
  }
});

test("fails unresolved family symbols and the decoder link cap closed", () => {
  const input = fixture();
  const decoded = decodeRevit2027BalusterInstanceDefinition(
    input.data,
    input.frame,
    2027,
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  const unresolved = validateRevit2027BalusterDefinitionSymbols(
    decoded.value,
    (ownerElementId) => ownerElementId !== 301,
  );
  assert.equal(unresolved.ok, false);
  if (!unresolved.ok) assert.match(unresolved.error, /family symbol 301/);

  const exhausted = decodeRevit2027BalusterInstanceDefinition(
    input.data,
    input.frame,
    2027,
    { maxInstances: 1 },
  );
  assert.equal(exhausted.ok, false);
  if (!exhausted.ok) assert.match(exhausted.error, /link cap/);
});

test("duplicate owner inputs are byte-structure equivalent only when their decoded arrays agree", () => {
  const first = fixture();
  const second = fixture();
  const firstResult = decodeRevit2027BalusterInstanceDefinition(
    first.data,
    first.frame,
    2027,
  );
  const secondResult = decodeRevit2027BalusterInstanceDefinition(
    second.data,
    second.frame,
    2027,
  );
  assert.equal(firstResult.ok, true);
  assert.equal(secondResult.ok, true);
  if (!firstResult.ok || !secondResult.ok) return;
  assert.deepEqual(
    firstResult.value.nestedInstances,
    secondResult.value.nestedInstances,
  );
  const equivalent = deduplicateRevit2027BalusterDefinitions([
    firstResult.value,
    secondResult.value,
  ]);
  assert.equal(equivalent.ok, true);

  new DataView(second.data.buffer).setFloat64(
    second.offsets.firstInstanceInfo + 72,
    9,
    true,
  );
  const conflicting = decodeRevit2027BalusterInstanceDefinition(
    second.data,
    second.frame,
    2027,
  );
  assert.equal(conflicting.ok, true);
  if (!conflicting.ok) return;
  assert.notDeepEqual(
    firstResult.value.nestedInstances,
    conflicting.value.nestedInstances,
  );
  const duplicate = deduplicateRevit2027BalusterDefinitions([
    firstResult.value,
    conflicting.value,
  ]);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.match(duplicate.error, /duplicate.*not byte/);
});

test("identifies the bounded TopRailType prefix without promoting it to geometry", () => {
  const objectLength = 180;
  const data = new Uint8Array(objectLength + 20);
  const view = new DataView(data.buffer);
  view.setUint32(0, 1834274, true);
  view.setUint32(12, objectLength, true);
  view.setUint16(16, REVIT_2027_TOP_RAIL_TYPE_MARKER, true);
  view.setUint32(18, 0, true);
  view.setInt32(DERIVED_OFFSET, 2, true);
  let cursor = DERIVED_OFFSET + 4;
  cursor = writeDescriptor(
    view,
    cursor,
    -1,
    REVIT_2027_RAILING_CURVE_LOOP_DATA_SOURCE_CLASS_SLOT,
  );
  cursor = writeDescriptor(
    view,
    cursor,
    -1,
    REVIT_2027_RAILING_CURVE_LOOP_DATA_SOURCE_CLASS_SLOT,
  );
  view.setBigInt64(cursor, 1834273n, true);
  view.setUint32(objectLength + 16, objectLength, true);
  const decoded = decodeRevit2027TopRailTypeEvidence(
    data,
    {
      offset: 0,
      elementId: 1834274,
      objectLength,
      marker: REVIT_2027_TOP_RAIL_TYPE_MARKER,
      typeCode: 0,
    },
    2027,
  );
  assert.deepEqual(decoded, {
    ok: true,
    value: {
      ownerElementId: 1834274,
      owningTopRailElementId: 1834273,
      curveLoopCount: 2,
      curveLoopSourceClassSlot: 3444,
      frameOffset: 0,
      frameEndOffset: objectLength + 20,
      objectLength,
      source: "TopRailType.m_curveLoopData",
    },
  });
});

test("decodes an exact two-loop TopRailType GLine tail", () => {
  const objectLength = 474;
  const data = new Uint8Array(objectLength + 20);
  const view = new DataView(data.buffer);
  view.setUint32(0, 1834274, true);
  view.setUint32(12, objectLength, true);
  view.setUint16(16, REVIT_2027_TOP_RAIL_TYPE_MARKER, true);
  view.setUint32(18, 0, true);
  view.setInt32(DERIVED_OFFSET, 2, true);
  let cursor = DERIVED_OFFSET + 4;
  cursor = writeDescriptor(
    view,
    cursor,
    -1,
    REVIT_2027_RAILING_CURVE_LOOP_DATA_SOURCE_CLASS_SLOT,
  );
  cursor = writeDescriptor(
    view,
    cursor,
    -1,
    REVIT_2027_RAILING_CURVE_LOOP_DATA_SOURCE_CLASS_SLOT,
  );
  view.setBigInt64(cursor, 1834273n, true);

  cursor = 220;
  cursor = writeDescriptor(
    view,
    cursor,
    -1,
    REVIT_2027_CURVE_LOOP_SOURCE_CLASS_SLOT,
  );
  view.setInt32(cursor, 2, true);
  view.setFloat64(cursor + 4, 10, true);
  view.setFloat64(cursor + 12, 11, true);
  cursor += 20;
  cursor = writeDescriptor(
    view,
    cursor,
    -1,
    REVIT_2027_CURVE_LOOP_SOURCE_CLASS_SLOT,
  );
  view.setInt32(cursor, 2, true);
  view.setFloat64(cursor + 4, 12, true);
  view.setFloat64(cursor + 12, 13, true);

  data[300] = 1;
  view.setInt32(301, 1, true);
  writeDescriptor(view, 305, 3, 1973);
  data[311] = 0;
  view.setInt32(312, 1, true);
  writeDescriptor(view, 316, 4, 1973);

  const writeLine = (
    offset: number,
    tag: number,
    origin: readonly [number, number, number],
    direction: readonly [number, number, number],
  ): void => {
    view.setBigInt64(offset, -1n, true);
    view.setInt32(offset + 8, tag, true);
    view.setInt32(offset + 12, 0, true);
    view.setUint32(offset + 16, 0x0108_0004, true);
    view.setFloat64(offset + 20, 0, true);
    view.setFloat64(offset + 28, 2, true);
    origin.forEach((value, index) =>
      view.setFloat64(offset + 36 + index * 8, value, true)
    );
    direction.forEach((value, index) =>
      view.setFloat64(offset + 60 + index * 8, value, true)
    );
  };
  writeLine(322, 825, [1, 2, 0], [1, 0, 0]);
  writeLine(406, 826, [4, 5, 0], [0, 1, 0]);
  view.setUint32(objectLength + 16, objectLength, true);
  const decoded = decodeRevit2027TopRailTypeCurves(
    data,
    {
      offset: 0,
      elementId: 1834274,
      objectLength,
      marker: REVIT_2027_TOP_RAIL_TYPE_MARKER,
      typeCode: 0,
    },
    2027,
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.curveCount, 2);
  assert.deepEqual(
    decoded.value.loops.map((loop) => ({
      persistedBoolean: loop.persistedBoolean,
      start: loop.segments[0]!.start,
      end: loop.segments[0]!.end,
    })),
    [
      { persistedBoolean: true, start: [1, 2, 10], end: [3, 2, 11] },
      { persistedBoolean: false, start: [4, 5, 12], end: [4, 7, 13] },
    ],
  );
  view.setFloat64(322 + 36, Number.NaN, true);
  const corrupted = decodeRevit2027TopRailTypeCurves(
    data,
    {
      offset: 0,
      elementId: 1834274,
      objectLength,
      marker: REVIT_2027_TOP_RAIL_TYPE_MARKER,
      typeCode: 0,
    },
    2027,
  );
  assert.equal(corrupted.ok, false);
  if (!corrupted.ok) assert.match(corrupted.error, /curve descriptor|non-finite/);
});
