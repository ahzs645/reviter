import assert from "node:assert/strict";
import test from "node:test";
import { PartitionRecordReader } from "../lib/reviter/partition-records.ts";

function frame(id: number, size = 40): Uint8Array {
  const data = new Uint8Array(size + 20);
  const v = new DataView(data.buffer);
  v.setUint32(0, id, true); v.setUint32(12, size, true);
  v.setUint16(16, 2166, true); v.setUint32(size + 16, size, true);
  return data;
}
const header = (sequence: number, flags: number, recordsStarting: number) => ({ sequence, flags, recordsStarting, tag: 1, sizeHint: 0, bodyBytes: 0 });

test("keeps interleaved sequence tails independent and checks the length echo", () => {
  const objects = new PartitionRecordReader(102), drawables = new PartitionRecordReader(103);
  const a = frame(12), b = frame(13);
  assert.equal(objects.push(header(102, 6, 1), a.subarray(0, 30), 0).length, 0);
  assert.equal(drawables.push(header(103, 4, 1), b, 1)[0]!.elementId, 13);
  const done = objects.push(header(102, 5, 0), a.subarray(30), 2);
  assert.equal(done[0]!.elementId, 12);
  assert.equal(done[0]!.firstChunk, 0);
  assert.equal(done[0]!.lastChunk, 2);
  assert.deepEqual(done[0]!.data, a);
  assert.equal(objects.stats.spanningRecords, 1);
});

test("reassembles a header split across three blocks", () => {
  const r = new PartitionRecordReader(103), f = frame(99);
  assert.deepEqual(r.push(header(103, 6, 1), f.subarray(0, 5), 0), []);
  assert.deepEqual(r.push(header(103, 7, 0), f.subarray(5, 12), 1), []);
  assert.equal(r.push(header(103, 5, 0), f.subarray(12), 2)[0]!.elementId, 99);
});

test("rejects corrupted echoes, count mismatches, oversized and orphan continuation records", () => {
  const r = new PartitionRecordReader(103, 100), bad = frame(1);
  bad[bad.length - 4] = 0;
  assert.deepEqual(r.push(header(103, 4, 1), bad, 0), []);
  assert.deepEqual(r.push(header(103, 4, 2), frame(2), 1), []);
  assert.deepEqual(r.push(header(103, 4, 1), frame(3, 100), 2), []);
  assert.deepEqual(r.push(header(103, 5, 0), frame(4), 3), []);
  assert.equal(r.stats.rejectedBlocks, 4);
  assert.equal(r.push(header(103, 4, 1), frame(5), 4)[0]!.elementId, 5);
});

test("a partition or failed inflate cannot donate its tail to the next record", () => {
  const r = new PartitionRecordReader(103), f = frame(1);
  r.push(header(103, 6, 1), f.subarray(0, 20), 0);
  r.reset();
  assert.deepEqual(r.push(header(103, 5, 0), f.subarray(20), 1), []);
  assert.equal(r.stats.incompleteRecords, 1);
});
