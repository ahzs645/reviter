import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027GEdgeStatic,
  revit2027GEdgeLoopDirection,
} from "../lib/reviter/revit-2027-edge-1423.ts";

const GINFO_BYTES = 20;
const REFERENCE_BYTES = 24;
const EDGE_POINT_BYTES = 32;
const ENDPOINT_BYTES = 64;

function writeEdgePoint(
  view: DataView,
  byteOffset: number,
  values: readonly [number, number, number, number],
): void {
  values.forEach((value, index) => {
    view.setFloat64(byteOffset + index * 8, value, true);
  });
}

function fixture(interiorCount = 1): {
  data: Uint8Array;
  bodyEndOffset: number;
} {
  const bodyBytes =
    GINFO_BYTES +
    REFERENCE_BYTES +
    4 +
    interiorCount * EDGE_POINT_BYTES +
    ENDPOINT_BYTES +
    1;
  const data = new Uint8Array(bodyBytes + 3);
  const view = new DataView(data.buffer);
  view.setBigInt64(0, 145n, true);
  view.setInt32(8, 7, true);
  view.setInt32(12, -2, true);
  view.setUint32(16, 0x20, true);

  [91, 92, 101, -1, 201, 202].forEach((value, index) => {
    view.setInt32(GINFO_BYTES + index * 4, value, true);
  });
  const countOffset = GINFO_BYTES + REFERENCE_BYTES;
  view.setInt32(countOffset, interiorCount, true);
  let cursor = countOffset + 4;
  for (let index = 0; index < interiorCount; index += 1) {
    writeEdgePoint(
      view,
      cursor,
      [index + 0.1, index + 0.2, index + 0.3, index + 0.4],
    );
    cursor += EDGE_POINT_BYTES;
  }
  writeEdgePoint(view, cursor, [1, 2, 3, 4]);
  cursor += EDGE_POINT_BYTES;
  writeEdgePoint(view, cursor, [5, 6, 7, 8]);
  cursor += EDGE_POINT_BYTES;
  data[cursor] = 0xa5;
  cursor += 1;
  data.fill(0xcc, cursor);
  return { data, bodyEndOffset: cursor };
}

test("decodes the complete variable-length Revit 2027 GEdge body", () => {
  const { data, bodyEndOffset } = fixture();
  const decoded = decodeRevit2027GEdgeStatic(
    data,
    0,
    data.byteLength,
    2027,
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;

  assert.equal(decoded.value.endOffset, bodyEndOffset);
  assert.deepEqual(decoded.value.faceReferences, [91, 92]);
  assert.deepEqual(decoded.value.nextReferences, [101, -1]);
  assert.deepEqual(decoded.value.previousReferences, [201, 202]);
  assert.deepEqual(decoded.value.interiorEdgePoints, [
    {
      firstFaceUv: [0.1, 0.2],
      secondFaceUv: [0.3, 0.4],
    },
  ]);
  assert.deepEqual(decoded.value.firstAndLastEdgePoints, [
    {
      firstFaceUv: [1, 2],
      secondFaceUv: [3, 4],
    },
    {
      firstFaceUv: [5, 6],
      secondFaceUv: [7, 8],
    },
  ]);
  assert.equal(decoded.value.flags, 0xa5);
  assert.equal(decoded.value.queuedPropertyCount, 0);
  assert.equal(data[decoded.value.endOffset], 0xcc);
});

test("accepts the schema-minimum GEdge with no interior points", () => {
  const { data, bodyEndOffset } = fixture(0);
  const decoded = decodeRevit2027GEdgeStatic(
    data,
    0,
    data.byteLength,
    2027,
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual(decoded.value.interiorEdgePoints, []);
  assert.equal(decoded.value.endOffset, bodyEndOffset);
  assert.equal(bodyEndOffset, 113);
});

test("derives native coedge direction from face side and flip bit", () => {
  assert.equal(revit2027GEdgeLoopDirection({ flags: 0x6 }, 0), 1);
  assert.equal(revit2027GEdgeLoopDirection({ flags: 0xe }, 0), 1);
  assert.equal(revit2027GEdgeLoopDirection({ flags: 0x6 }, 1), -1);
  assert.equal(revit2027GEdgeLoopDirection({ flags: 0x7 }, 0), -1);
  assert.equal(revit2027GEdgeLoopDirection({ flags: 0x7 }, 1), 1);
});

test("GEdge reader is release-gated, bounded, and count-limited", () => {
  const { data, bodyEndOffset } = fixture(2);
  assert.equal(
    decodeRevit2027GEdgeStatic(data, 0, data.byteLength, 2026).ok,
    false,
  );
  assert.equal(
    decodeRevit2027GEdgeStatic(data, 0, bodyEndOffset - 1, 2027).ok,
    false,
  );
  const limited = decodeRevit2027GEdgeStatic(
    data,
    0,
    data.byteLength,
    2027,
    { maxInteriorEdgePoints: 1 },
  );
  assert.equal(limited.ok, false);
  if (!limited.ok) assert.match(limited.error, /safety bound/);
});
