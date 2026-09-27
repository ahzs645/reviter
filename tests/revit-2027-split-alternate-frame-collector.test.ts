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

test("reassembles a GElement frame only when it crosses a page", () => {
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
