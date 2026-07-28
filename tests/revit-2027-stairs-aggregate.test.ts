import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027StairsElementAggregate,
  decodeRevit2027StairsRunAndLandingAggregate,
  REVIT_2027_STAIRS_ELEMENT_MARKER,
  REVIT_2027_STAIRS_RUN_MARKER,
} from "../lib/reviter/revit-2027-stairs-aggregate.ts";

function frame(
  marker: number,
  elementId: number,
  objectLength = 400,
): Uint8Array {
  const data = new Uint8Array(objectLength + 20);
  const view = new DataView(data.buffer);
  view.setUint32(0, elementId, true);
  view.setUint32(12, objectLength, true);
  view.setUint16(16, marker, true);
  view.setUint32(objectLength + 16, objectLength, true);
  return data;
}

function writeId(view: DataView, offset: number, id: number): number {
  view.setUint32(offset, id, true);
  view.setUint32(offset + 4, 0, true);
  return offset + 8;
}

function writeIds(
  view: DataView,
  offset: number,
  ids: readonly number[],
): number {
  view.setInt32(offset, ids.length, true);
  let cursor = offset + 4;
  for (const id of ids) cursor = writeId(view, cursor, id);
  return cursor;
}

function writeQueue(
  view: DataView,
  offset: number,
  entries: readonly { token: number; source: number }[],
): number {
  view.setInt32(offset, entries.length, true);
  let cursor = offset + 4;
  for (const entry of entries) {
    view.setInt32(cursor, entry.token, true);
    cursor += 4;
    if (entry.token !== 0) {
      view.setInt16(cursor, entry.source, true);
      cursor += 2;
    }
  }
  return cursor;
}

test("decodes exact Revit 2027 StairsElement aggregate collections", () => {
  const data = frame(REVIT_2027_STAIRS_ELEMENT_MARKER, 100);
  const view = new DataView(data.buffer);
  let cursor = 127;
  cursor = writeIds(view, cursor, [11, 12]);
  cursor = writeIds(view, cursor, [21]);
  cursor = writeQueue(view, cursor, [{ token: -1, source: 901 }]);
  cursor = writeQueue(view, cursor, []);
  cursor = writeIds(view, cursor, [31]);
  for (const offset of [cursor, cursor + 8, cursor + 24, cursor + 40, cursor + 56]) {
    view.setFloat64(offset, 1, true);
  }

  const decoded = decodeRevit2027StairsElementAggregate(
    data,
    0,
    400,
    2027,
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual(decoded.value.registeredRailingIds, [11, 12]);
  assert.deepEqual(decoded.value.runAndLandingIds, [21]);
  assert.deepEqual(decoded.value.supportIds, [31]);
  assert.equal(decoded.value.stairsBoundaryCurves2d.count, 1);
  assert.equal(decoded.value.stairsRailingPaths.count, 0);
  assert.equal(decoded.value.staticEndOffset, cursor + 84);
});

function writeRunSuffix(
  view: DataView,
  offset: number,
  stairsId: number,
): number {
  let cursor = writeId(view, offset, stairsId);
  cursor = writeId(view, cursor, 0);
  view.setInt32(cursor, 3, true);
  cursor += 4;
  view.setUint8(cursor, 1);
  cursor += 1;
  cursor = writeIds(view, cursor, [31, 32]);
  cursor = writeQueue(view, cursor, [{ token: -1, source: 4075 }]);
  view.setInt32(cursor, 2, true);
  cursor += 4;
  view.setInt32(cursor, 10, true);
  view.setInt32(cursor + 4, 1, true);
  view.setInt32(cursor + 8, 11, true);
  view.setInt32(cursor + 12, 0, true);
  return cursor + 16;
}

test("decodes the reciprocal StairsRunAndLanding suffix and stringers", () => {
  const data = frame(REVIT_2027_STAIRS_RUN_MARKER, 21);
  const view = new DataView(data.buffer);
  const suffixEnd = writeRunSuffix(view, 200, 100);

  const decoded = decodeRevit2027StairsRunAndLandingAggregate(
    data,
    0,
    400,
    2027,
    { knownStairsElementIds: new Set([100]) },
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.elementId, 21);
  assert.equal(decoded.value.stairsId, 100);
  assert.equal(decoded.value.triserSymbolId, null);
  assert.equal(decoded.value.baseRiserIndex, 3);
  assert.equal(decoded.value.isMirrored, true);
  assert.deepEqual(decoded.value.stringerIds, [31, 32]);
  assert.deepEqual(decoded.value.supportExistenceStatus, [
    { key: 10, value: 1 },
    { key: 11, value: 0 },
  ]);
  assert.equal(decoded.value.staticSuffixEndOffset, suffixEnd);
});

test("stairs aggregate readers are release, frame, and ambiguity gated", () => {
  const stairs = frame(REVIT_2027_STAIRS_ELEMENT_MARKER, 100);
  assert.equal(
    decodeRevit2027StairsElementAggregate(stairs, 0, 400, 2026).ok,
    false,
  );
  stairs[16] = 0;
  assert.equal(
    decodeRevit2027StairsElementAggregate(stairs, 0, 400, 2027).ok,
    false,
  );

  const run = frame(REVIT_2027_STAIRS_RUN_MARKER, 21);
  const view = new DataView(run.buffer);
  writeRunSuffix(view, 160, 100);
  writeRunSuffix(view, 260, 100);
  const ambiguous = decodeRevit2027StairsRunAndLandingAggregate(
    run,
    0,
    400,
    2027,
    { knownStairsElementIds: new Set([100]) },
  );
  assert.equal(ambiguous.ok, false);
  if (!ambiguous.ok) assert.match(ambiguous.error, /ambiguous/u);
});
