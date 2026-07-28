import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027GPolyLine,
  REVIT_2027_GPOLYLINE_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-gpolyline.ts";

function fixture(options: { filled?: number; pointCount?: number } = {}) {
  const pointCount = options.pointCount ?? 3;
  const points = [
    [1, 2, 3],
    [4, 5, 6],
    [1, 2, 3],
  ];
  const bytes = new Uint8Array(73 + pointCount * 24 + 8);
  const view = new DataView(bytes.buffer);
  view.setBigInt64(0, 145n, true);
  view.setInt32(8, -1, true);
  view.setInt32(12, 7, true);
  view.setUint32(16, 9, true);
  view.setInt32(20, pointCount, true);
  let offset = 24;
  for (let index = 0; index < pointCount; index += 1) {
    const point = points[index] ?? [0, 0, 0];
    point.forEach((value, axis) =>
      view.setFloat64(offset + axis * 8, value, true),
    );
    offset += 24;
  }
  const selected = points.slice(0, pointCount);
  for (let axis = 0; axis < 3; axis += 1) {
    const values = selected.map((point) => point[axis]!);
    view.setFloat64(offset + axis * 8, Math.min(...values), true);
    view.setFloat64(offset + 24 + axis * 8, Math.max(...values), true);
  }
  offset += 48;
  bytes[offset] = options.filled ?? 0;
  return { bytes, bodyEndOffset: offset + 1 };
}

test("decodes a count-bounded Revit 2027 GPolyLine FIFO body", () => {
  const { bytes, bodyEndOffset } = fixture();
  const result = decodeRevit2027GPolyLine(bytes, 0, bytes.byteLength, 2027);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(REVIT_2027_GPOLYLINE_SOURCE_CLASS_SLOT, 2276);
  assert.equal(result.value.endOffset, bodyEndOffset);
  assert.deepEqual(result.value.coordinates, [
    [1, 2, 3],
    [4, 5, 6],
    [1, 2, 3],
  ]);
  assert.deepEqual(result.value.extents, {
    minimum: [1, 2, 3],
    maximum: [4, 5, 6],
    valid: true,
  });
  assert.equal(result.value.extentsMatchCoordinates, true);
  assert.equal(result.value.closed, true);
  assert.equal(result.value.filled, false);
  assert.equal(result.value.gInfo.gStyleElementId, 145n);
  assert.equal(result.value.gInfo.tag, -1);
});

test("rejects the wrong release, truncation, excessive counts, and invalid booleans", () => {
  const { bytes, bodyEndOffset } = fixture();
  assert.equal(
    decodeRevit2027GPolyLine(bytes, 0, bytes.byteLength, 2026).ok,
    false,
  );
  assert.equal(
    decodeRevit2027GPolyLine(bytes, 0, bodyEndOffset - 1, 2027).ok,
    false,
  );
  assert.equal(
    decodeRevit2027GPolyLine(bytes, 0, bytes.byteLength, 2027, {
      maxPoints: 2,
    }).ok,
    false,
  );

  const invalidBoolean = fixture({ filled: 2 });
  assert.equal(
    decodeRevit2027GPolyLine(
      invalidBoolean.bytes,
      0,
      invalidBoolean.bytes.byteLength,
      2027,
    ).ok,
    false,
  );
});

test("rejects non-finite coordinates and extents that exclude coordinates", () => {
  const nonFinite = fixture();
  new DataView(nonFinite.bytes.buffer).setFloat64(24, Number.NaN, true);
  assert.equal(
    decodeRevit2027GPolyLine(
      nonFinite.bytes,
      0,
      nonFinite.bytes.byteLength,
      2027,
    ).ok,
    false,
  );

  const excluded = fixture();
  const extentsOffset = 24 + 3 * 24;
  new DataView(excluded.bytes.buffer).setFloat64(extentsOffset + 24, 2, true);
  assert.equal(
    decodeRevit2027GPolyLine(
      excluded.bytes,
      0,
      excluded.bytes.byteLength,
      2027,
    ).ok,
    false,
  );
});
