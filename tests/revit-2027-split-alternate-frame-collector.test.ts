import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIT_2027_TOP_RAIL_TYPE_MARKER,
} from "../lib/reviter/revit-2027-baluster-instances.ts";
import {
  createRevit2027SplitAlternateFrameCollector,
  createRevit2027SplitGElementCollector,
} from "../lib/reviter/revit-2027-split-alternate-frame-collector.ts";

const FRAME_SUFFIX_BYTES = 20;

function frame(elementId: number, objectLength = 96): Uint8Array {
  const bytes = new Uint8Array(objectLength + FRAME_SUFFIX_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, elementId, true);
  view.setUint32(4, 0, true);
  view.setUint32(12, objectLength, true);
  view.setUint16(16, REVIT_2027_TOP_RAIL_TYPE_MARKER, true);
  view.setUint32(18, 0, true);
  for (let index = 22; index < objectLength; index += 1) {
    bytes[index] = index & 0xff;
  }
  view.setUint32(objectLength + 16, objectLength, true);
  return bytes;
}

test("reassembles only a TopRailType frame split across partition pages", () => {
  const expected = frame(1_857_538);
  const collector = createRevit2027SplitAlternateFrameCollector(2027);
  assert.deepEqual(collector.pushPage(expected.subarray(0, 11)), []);
  assert.deepEqual(collector.pushPage(expected.subarray(11, 73)), []);
  const completed = collector.pushPage(expected.subarray(73));
  assert.equal(completed.length, 1);
  assert.deepEqual(completed[0], expected);

  const completeOnOnePage = frame(1_834_274);
  assert.deepEqual(collector.pushPage(completeOnOnePage), []);

  const oversizedOnOnePage = frame(1_857_538, 70_000);
  const oversized = collector.pushPage(oversizedOnOnePage);
  assert.equal(oversized.length, 1);
  assert.deepEqual(oversized[0], oversizedOnOnePage);
});

test("fails closed across releases, partition boundaries, echoes, and limits", () => {
  const expected = frame(1234);
  const wrongRelease = createRevit2027SplitAlternateFrameCollector(2023);
  assert.deepEqual(wrongRelease.pushPage(expected.subarray(0, 50)), []);
  assert.deepEqual(wrongRelease.pushPage(expected.subarray(50)), []);

  const partitioned = createRevit2027SplitAlternateFrameCollector(2027);
  assert.deepEqual(partitioned.pushPage(expected.subarray(0, 50)), []);
  partitioned.finishPartition();
  assert.deepEqual(partitioned.pushPage(expected.subarray(50)), []);

  const brokenEcho = expected.slice();
  new DataView(brokenEcho.buffer).setUint32(96 + 16, 95, true);
  const invalid = createRevit2027SplitAlternateFrameCollector(2027);
  assert.deepEqual(invalid.pushPage(brokenEcho.subarray(0, 50)), []);
  assert.deepEqual(invalid.pushPage(brokenEcho.subarray(50)), []);

  const bounded = createRevit2027SplitAlternateFrameCollector(2027, 100);
  assert.deepEqual(bounded.pushPage(expected.subarray(0, 50)), []);
  assert.deepEqual(bounded.pushPage(expected.subarray(50)), []);
});

/** A GElement frame: its id, the id restated at +26, and a length echo. */
function geometryFrame(elementId: number, objectLength = 120): Uint8Array {
  const bytes = new Uint8Array(objectLength + FRAME_SUFFIX_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, elementId, true);
  view.setUint32(12, objectLength, true);
  view.setUint16(16, 0x08c6, true);
  view.setUint32(26, elementId, true);
  view.setUint32(objectLength + 16, objectLength, true);
  return bytes;
}

test("ordinary GElement frames are reassembled only when crossing a page", () => {
  const collector = createRevit2027SplitGElementCollector(2025);
  // Whole on one page, the page scan already has it.
  assert.deepEqual(collector.pushPage(geometryFrame(988_018)), []);
  const split = geometryFrame(800_280);
  assert.deepEqual(collector.pushPage(split.subarray(0, 50)), []);
  const completed = collector.pushPage(split.subarray(50));
  assert.equal(completed.length, 1);
  assert.deepEqual(completed[0], split);
  // A header without the restated id is not a GElement's.
  const forged = geometryFrame(7);
  new DataView(forged.buffer).setUint32(26, 8, true);
  collector.finishPartition();
  assert.deepEqual(collector.pushPage(forged.subarray(0, 50)), []);
  assert.deepEqual(collector.pushPage(forged.subarray(50)), []);
});

function checksummedGeometryFrame(id: number, length: number): Uint8Array {
  const data = geometryFrame(id, length), view = new DataView(data.buffer);
  let a = 1, b = 0;
  for (let i = 16; i < 16 + length; i++) { a = (a + data[i]!) % 65521; b = (b + a) % 65521; }
  view.setUint32(8, (b * 65536 + a) >>> 0, true);
  return data;
}

test("checksum-verified GElements above the page-scan ceiling are not lost on a whole page", () => {
  const collector = createRevit2027SplitGElementCollector(2027);
  const ordinary = checksummedGeometryFrame(10, 0xffff);
  assert.deepEqual(collector.pushPage(ordinary), [], "ordinary ceiling is still handled by the page scan");
  const large = checksummedGeometryFrame(11, 0x10000);
  const whole = new Uint8Array(large.length + 90); whole.set(large, 40);
  const frames = collector.pushPageFrames(whole);
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0]!.data, large);
  assert.equal(frames[0]!.pageOffset, 40, "retain the original page location for source identity evidence");
  assert.equal(frames[0]!.crossedPage, false);
  assert.equal(frames[0]!.objectLength, 0x10000);
  assert.equal(collector.largeWholeFrameDiagnostics.admitted, 1);
  assert.equal(collector.largeWholeFrameDiagnostics.checksumBytes, 0x10000);
});

test("large whole GElements reject damaged payload, false ownership and bad echoes", () => {
  const source = checksummedGeometryFrame(118, 70_000);
  const damaged = source.slice(); damaged[1000] = 1;
  const collector = createRevit2027SplitGElementCollector(2027);
  assert.deepEqual(collector.pushPage(damaged), []);
  assert.equal(collector.largeWholeFrameDiagnostics.rejectedChecksum, 1);
  const wrongOwner = source.slice(); new DataView(wrongOwner.buffer).setUint32(26, 119, true);
  assert.deepEqual(collector.pushPage(wrongOwner), []);
  const wrongEcho = source.slice(); new DataView(wrongEcho.buffer).setUint32(70_016, 69_999, true);
  assert.deepEqual(collector.pushPage(wrongEcho), []);
  assert.equal(collector.largeWholeFrameDiagnostics.admitted, 0);
});

test("large whole checksum work is bounded per partition without blocking crossing frames", () => {
  const large = checksummedGeometryFrame(10, 70_000);
  const collector = createRevit2027SplitGElementCollector(2027, 70_000);
  assert.deepEqual(collector.pushPage(large), [large]);
  assert.deepEqual(collector.pushPage(large), []);
  assert.equal(collector.largeWholeFrameDiagnostics.skippedChecksumBudget, 1);
  assert.equal(collector.largeWholeFrameDiagnostics.checksumBytes, 70_000);
  const small = geometryFrame(11);
  assert.deepEqual(collector.pushPage(small.subarray(0, 50)), []);
  const crossed = collector.pushPageFrames(small.subarray(50));
  assert.deepEqual(crossed.map(frame => frame.data), [small]);
  assert.equal(crossed[0]!.pageOffset, null, "a split frame must not invent a same-page identity location");
  collector.finishPartition();
  assert.deepEqual(collector.pushPage(large), [large]);
  assert.equal(collector.largeWholeFrameDiagnostics.admitted, 2);
});
