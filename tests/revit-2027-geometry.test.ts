import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027GeometryStatic,
  REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-geometry.ts";

type Entry = { token: number; sourceClassSlot?: number };

function writeCollection(
  view: DataView,
  offset: number,
  entries: readonly Entry[],
): number {
  view.setInt32(offset, entries.length, true);
  let cursor = offset + 4;
  for (const entry of entries) {
    view.setInt32(cursor, entry.token, true);
    cursor += 4;
    if (entry.token !== 0) {
      view.setInt16(cursor, entry.sourceClassSlot!, true);
      cursor += 2;
    }
  }
  return cursor;
}

function fixture(): { data: Uint8Array; endOffset: number } {
  const data = new Uint8Array(128);
  const view = new DataView(data.buffer);
  view.setBigInt64(4, 7201n, true);
  view.setInt32(12, 31, true);
  view.setInt32(16, 9, true);
  view.setUint32(20, 0x010b_1081, true);

  let cursor = writeCollection(view, 24, [
    { token: 8, sourceClassSlot: 1825 },
    { token: 9, sourceClassSlot: 1825 },
  ]);
  view.setInt32(cursor, 7, true);
  view.setInt32(cursor + 4, -1, true);
  view.setInt32(cursor + 8, 0, true);
  view.setInt32(cursor + 12, 1, true);
  cursor += 16;
  cursor = writeCollection(view, cursor, [
    { token: 10, sourceClassSlot: 1423 },
  ]);
  cursor = writeCollection(view, cursor, [
    { token: 0 },
    { token: 11, sourceClassSlot: 1804 },
  ]);
  data.fill(0xaa, cursor);
  return { data, endOffset: cursor };
}

test("decodes the schema-complete Revit 2027 Geometry static body", () => {
  const { data, endOffset } = fixture();
  const decoded = decodeRevit2027GeometryStatic(
    data,
    4,
    data.byteLength,
    2027,
  );

  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT, 2343);
  assert.equal(decoded.value.endOffset, endOffset);
  assert.equal(data[endOffset], 0xaa);
  assert.deepEqual(decoded.value.gInfo, {
    gStyleElementId: 7201n,
    tag: 31,
    controlCommand: 9,
    flags: 0x010b_1081,
  });
  assert.equal(decoded.value.faces.count, 2);
  assert.equal(decoded.value.flags, 7);
  assert.equal(decoded.value.geometryTag, -1);
  assert.deepEqual(decoded.value.tessEpsCntrl, { type: 0, version: 1 });
  assert.equal(decoded.value.edges.count, 1);
  assert.equal(decoded.value.sharedSurfaceInfo.count, 2);
  assert.deepEqual(
    decoded.value.queuedProperties.map((entry) => [
      entry.token,
      entry.sourceClassSlot,
    ]),
    [
      [8, 1825],
      [9, 1825],
      [10, 1423],
      [0, null],
      [11, 1804],
    ],
  );
});

test("Geometry reader is release-gated and respects collection bounds", () => {
  const { data } = fixture();
  assert.equal(
    decodeRevit2027GeometryStatic(data, 4, data.byteLength, 2026).ok,
    false,
  );

  const limited = decodeRevit2027GeometryStatic(
    data,
    4,
    data.byteLength,
    2027,
    { maxFaces: 1 },
  );
  assert.equal(limited.ok, false);
  if (!limited.ok) assert.match(limited.error, /faces.*outside/i);

  const truncated = decodeRevit2027GeometryStatic(
    data,
    4,
    40,
    2027,
  );
  assert.equal(truncated.ok, false);
});

test("Geometry reader rejects an invalid option without touching bytes", () => {
  const { data } = fixture();
  const decoded = decodeRevit2027GeometryStatic(
    data,
    4,
    data.byteLength,
    2027,
    { maxEdges: -1 },
  );
  assert.deepEqual(decoded, {
    ok: false,
    error: "maxEdges must be a non-negative safe integer",
  });
});
