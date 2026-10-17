import assert from "node:assert/strict";
import test from "node:test";
import { createSplitFrameStream } from "../lib/reviter/split-frame-stream.ts";
import { createRevit2027SplitGElementCollector } from "../lib/reviter/revit-2027-split-alternate-frame-collector.ts";
import { activeElementIdBytes, setActiveElementIdBytes } from "../lib/reviter/element-id-width.ts";
import { activeClassTagTranslation, buildClassTagTranslation, fileClassTag, setActiveClassTagTranslation } from "../lib/reviter/revit-class-tags.ts";
import { REVIT_2027_CLASS_NAMES, REVIT_2027_FIRST_CLASS_INDEX } from "../lib/reviter/revit-2027-class-names.data.ts";

const marker = 2246;
function layout(width: 4 | 8, translated: boolean, run: () => void) {
  const oldWidth = activeElementIdBytes(), oldTranslation = activeClassTagTranslation();
  setActiveElementIdBytes(width);
  setActiveClassTagTranslation(translated ? buildClassTagTranslation(REVIT_2027_CLASS_NAMES.map((name, i) => ({ name, tag: REVIT_2027_FIRST_CLASS_INDEX + i + 37 }))) : null);
  try { run(); } finally { setActiveClassTagTranslation(oldTranslation); setActiveElementIdBytes(oldWidth); }
}
function frame(width: 4 | 8, length: number, owner = 3456) {
  const header = width === 4 ? 12 : 16, bytes = new Uint8Array(header + length + 4), view = new DataView(bytes.buffer);
  view.setUint32(0, owner, true); view.setUint32(header - 4, length, true);
  view.setUint16(header, fileClassTag(marker), true);
  view.setUint32(width === 4 ? 14 : 26, owner, true);
  view.setUint32(header + length, length, true);
  let a = 1, b = 0;
  for (let i = header; i < header + length; i++) { a = (a + bytes[i]!) % 65521; b = (b + a) % 65521; }
  view.setUint32(header - 8, (b * 65536 + a) >>> 0, true);
  return bytes;
}

for (const width of [4, 8] as const) for (const translated of [false, true]) {
  const label = `${width * 8}-bit IDs and ${translated ? "translated" : "canonical"} classes`;
  test(`GElement recovery retains every split through the repeated owner with ${label}`, () => layout(width, translated, () => {
    for (const length of [120, 65536]) for (let split = 1; split <= (width === 4 ? 22 : 34); split++) {
      const expected = frame(width, length), first = new Uint8Array(37 + split); first.fill(0xcc); first.set(expected.subarray(0, split), 37);
      const collector = createRevit2027SplitGElementCollector(width === 4 ? 2023 : 2027);
      assert.equal(collector.pushPageFrames(first).length, 0, `premature admission at ${split}/${length}`);
      const actual = collector.pushPageFrames(expected.subarray(split));
      assert.equal(actual.length, 1, `lost split ${split}/${length}`);
      assert.deepEqual(actual[0]!.data, expected); assert.equal(actual[0]!.elementId, 3456);
      assert.equal(actual[0]!.crossedPage, true); assert.equal(actual[0]!.pageOffset, null);
      assert.equal(collector.pushPageFrames(new Uint8Array([0xcc])).length, 0, "no duplicate completion");
    }
  }));
  test(`repeated-owner verification still rejects foreign ownership at every header split with ${label}`, () => layout(width, translated, () => {
    const invalid = frame(width, 120); new DataView(invalid.buffer).setUint32(width === 4 ? 14 : 26, 3457, true);
    for (let split = 1; split <= (width === 4 ? 22 : 34); split++) {
      const collector = createRevit2027SplitGElementCollector(width === 4 ? 2023 : 2027);
      assert.equal(collector.pushPageFrames(invalid.subarray(0, split)).length, 0);
      assert.equal(collector.pushPageFrames(invalid.subarray(split)).length, 0, `foreign owner split ${split}`);
    }
  }));
  test(`one-byte chunks and partition reset retain bounded header state with ${label}`, () => layout(width, translated, () => {
    const expected = frame(width, 120), collector = createRevit2027SplitGElementCollector(width === 4 ? 2023 : 2027);
    for (let i = 0; i < 30; i++) assert.equal(collector.pushPageFrames(expected.subarray(i, i + 1)).length, 0);
    const complete = collector.pushPageFrames(expected.subarray(30)); assert.equal(complete.length, 1); assert.deepEqual(complete[0]!.data, expected);
    collector.finishPartition(); collector.pushPageFrames(expected.subarray(0, 26)); collector.finishPartition();
    assert.equal(collector.pushPageFrames(expected.subarray(26)).length, 0, "partitions cannot supply each other's missing header");
  }));
}

test("generic split-frame lookahead delays callbacks until all requested bytes exist", () => layout(8, false, () => {
  const expected = frame(8, 120); let calls = 0;
  const stream = createSplitFrameStream({ markers: [marker], minObjectLength: 40, maxFrameBytes: 1024, minimumHeaderBytes: 44, acceptHeader(view, offset) { calls++; assert.ok(view.byteLength - offset >= 44); return true; } });
  for (let i = 0; i < 44; i++) assert.equal(stream.push(expected.subarray(i, i + 1)).length, 0);
  assert.equal(calls, 1); assert.deepEqual(stream.push(expected.subarray(44))[0]!.data, expected);
  for (const minimumHeaderBytes of [-1, NaN, 1025]) assert.throws(() => createSplitFrameStream({ markers: [marker], minObjectLength: 40, maxFrameBytes: 1024, minimumHeaderBytes }).push(expected), /lookahead/);
}));
