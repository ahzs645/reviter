import assert from "node:assert/strict";
import test from "node:test";

import {
  ELEMENT_HEADER_CLASS,
  walkElementHeaderBlock,
} from "../lib/reviter/element-headers.ts";
import {
  PARTITION_BLOCK_HEADER_BYTES,
  PARTITION_SEQUENCE_ELEMENT_HEADER,
  readPartitionBlockHeader,
} from "../lib/reviter/revit-container.ts";

/** One element-header record: id, body, class, entry count, then the body bytes. */
function headerRecord(elementId: number, body: number[], entryCount = 0, classIndex = ELEMENT_HEADER_CLASS): number[] {
  const out = new Uint8Array(16 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, elementId, true);
  view.setUint32(4, 0, true);
  view.setUint32(8, body.length, true);
  view.setUint16(12, classIndex, true);
  view.setUint16(14, entryCount, true);
  out.set(body, 16);
  return [...out];
}

/** A category value as the file writes it: negative i64 then the ff terminator. */
function categoryBytes(categoryId: number): number[] {
  const out = new Uint8Array(12);
  new DataView(out.buffer).setBigInt64(0, BigInt(categoryId), true);
  out.fill(0xff, 8);
  return [...out];
}

test("a block header is read from the 26 bytes before a gzip member and rejected elsewhere", () => {
  const data = new Uint8Array(64);
  const view = new DataView(data.buffer);
  const at = 10;
  view.setUint16(at, 3939, true);
  view.setUint32(at + 2, 4, true);
  view.setUint32(at + 6, 378, true);
  view.setUint32(at + 10, 16_441, true);
  view.setUint32(at + 14, 124_974, true);
  view.setUint32(at + 18, PARTITION_SEQUENCE_ELEMENT_HEADER, true);
  const header = readPartitionBlockHeader(data, at + PARTITION_BLOCK_HEADER_BYTES);
  assert.deepEqual(header, {
    tag: 3939,
    flags: 4,
    recordsStarting: 378,
    sizeHint: 16_441,
    bodyBytes: 124_974,
    sequence: PARTITION_SEQUENCE_ELEMENT_HEADER,
  });
  // Too close to the start for a header to fit, an unknown sequence, and
  // flags outside 4..7 are each refused rather than read as garbage.
  assert.equal(readPartitionBlockHeader(data, 12), null);
  view.setUint32(at + 18, 7, true);
  assert.equal(readPartitionBlockHeader(data, at + PARTITION_BLOCK_HEADER_BYTES), null);
  view.setUint32(at + 18, PARTITION_SEQUENCE_ELEMENT_HEADER, true);
  view.setUint32(at + 2, 12, true);
  assert.equal(readPartitionBlockHeader(data, at + PARTITION_BLOCK_HEADER_BYTES), null);
});

test("the header walk reads each element's category from its own record, past reference entries and null records", () => {
  const wall = -2_000_011;
  const door = -2_000_023;
  const page = new Uint8Array([
    // Category right at the front, as most records carry it.
    ...headerRecord(1_001, [0, 0, ...categoryBytes(wall), 7, 7]),
    // A null record: id all ones, empty body.
    ...[0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0, 0, 0, 0, 0],
    // Two 22-byte reference entries first, then a field tag, then the category.
    ...headerRecord(1_002, [0, 0, ...new Array(44).fill(0xee), 0xfe, 0x04, 0x6f, 0x06, 0, 0, ...categoryBytes(door)], 2),
    // A record with no category at all.
    ...headerRecord(1_003, [0, 0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 1, 2, 3]),
    // A record of another class is counted but not decoded.
    ...headerRecord(1_004, [0, 0, ...categoryBytes(wall)], 0, ELEMENT_HEADER_CLASS + 1),
  ]);
  const walk = walkElementHeaderBlock(page);
  assert.equal(walk.misalignedAt, null);
  assert.equal(walk.otherClassRecords, 1);
  assert.deepEqual(
    walk.records.map((record) => [record.elementId, record.categoryId, record.entryCount]),
    [[1_001, wall, 0], [1_002, door, 2], [1_003, null, 0]],
  );
});

test("the header walk stops at the first record that does not fit rather than reading past it", () => {
  const page = new Uint8Array([
    ...headerRecord(5, [0, 0, ...categoryBytes(-2_000_032)]),
    // A body length that overruns the page.
    5, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 0, 0, 0, 0, 0, 0,
  ]);
  const walk = walkElementHeaderBlock(page);
  assert.equal(walk.records.length, 1);
  assert.equal(walk.misalignedAt, 16 + 14);
});
