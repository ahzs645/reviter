import assert from "node:assert/strict";
import test from "node:test";
import { createRevit2027SplitGElementCollector } from "../lib/reviter/revit-2027-split-alternate-frame-collector.ts";
import { setActiveElementIdBytes, activeElementIdBytes } from "../lib/reviter/element-id-width.ts";
import { buildClassTagTranslation, setActiveClassTagTranslation, fileClassTag } from "../lib/reviter/revit-class-tags.ts";
import { REVIT_2027_CLASS_NAMES, REVIT_2027_FIRST_CLASS_INDEX } from "../lib/reviter/revit-2027-class-names.data.ts";
const GELEMENT = 2246;

function withLayout(width: 4 | 8, translated: boolean, body: () => void) {
  setActiveElementIdBytes(width);
  setActiveClassTagTranslation(translated ? buildClassTagTranslation(
    REVIT_2027_CLASS_NAMES.map((name: string, index: number) => ({
      name, tag: REVIT_2027_FIRST_CLASS_INDEX + index + 37,
    })),
  ) : null);
  try { body(); }
  finally {
    setActiveClassTagTranslation(null);
    setActiveElementIdBytes(null);
  }
}

/** Frame container only: independent serialization of both source ID widths.
 * The collector must validate exact owner/class/echo/checksum before returning
 * it; a returned frame still needs the independent FIFO/body gates downstream.
 */
function sourceFrame(width: 4 | 8, owner: number, length: number) {
  const header = width === 4 ? 12 : 16;
  const bytes = new Uint8Array(header + length + 4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, owner, true);
  view.setUint32(header - 4, length, true);
  view.setUint16(header, fileClassTag(GELEMENT), true);
  view.setUint32(width === 4 ? 14 : 26, owner, true);
  for (let index = header + 22; index < header + length; index++) bytes[index] = (index * 29 + 7) & 0xff;
  view.setUint32(header + length, length, true);
  let a = 1, b = 0;
  for (let index = header; index < header + length; index++) {
    a = (a + bytes[index]!) % 65521;
    b = (b + a) % 65521;
  }
  view.setUint32(header - 8, ((b << 16) | a) >>> 0, true);
  return bytes;
}

for (const width of [4, 8] as const) for (const translated of [false, true]) {
  const name = `${width * 8}-bit IDs, ${translated ? "translated" : "canonical"} classes`;
  test(`large same-page admission preserves source identity and page offset with ${name}`, () => withLayout(width, translated, () => {
    const collector = createRevit2027SplitGElementCollector(width === 4 ? 2023 : 2027);
    assert.equal(collector.pushPage(sourceFrame(width, 701, 65535)).length, 0);
    const exact = sourceFrame(width, 702, 65536);
    const page = new Uint8Array(59 + exact.length + 13); page.set(exact, 59);
    const frames = collector.pushPageFrames(page);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].elementId, 702);
    assert.equal(frames[0].marker, GELEMENT);
    assert.equal(frames[0].pageOffset, 59);
    assert.equal(frames[0].crossedPage, false);
    assert.deepEqual(frames[0].data, exact);
    assert.equal(collector.largeWholeFrameDiagnostics.admitted, 1);
  }));

  test(`damaged same-page bytes cannot pass admission with ${name}`, () => withLayout(width, translated, () => {
    const header = width === 4 ? 12 : 16;
    const original = sourceFrame(width, 801, 70000);
    const corrupt = original.slice(); corrupt[1000] ^= 0x80;
    const foreignOwner = original.slice(); new DataView(foreignOwner.buffer).setUint32(width === 4 ? 14 : 26, 802, true);
    const wrongEcho = original.slice(); new DataView(wrongEcho.buffer).setUint32(header + 70000, 69999, true);
    for (const damaged of [corrupt, foreignOwner, wrongEcho]) {
      const collector = createRevit2027SplitGElementCollector(width === 4 ? 2023 : 2027);
      assert.equal(collector.pushPageFrames(damaged).length, 0);
      assert.equal(collector.largeWholeFrameDiagnostics.admitted, 0);
    }
  }));

  test(`bounded whole-frame checks preserve crossing frames and reset per partition with ${name}`, () => withLayout(width, translated, () => {
    const collector = createRevit2027SplitGElementCollector(width === 4 ? 2023 : 2027, 70000);
    const whole = sourceFrame(width, 901, 70000);
    assert.equal(collector.pushPageFrames(whole).length, 1);
    assert.equal(collector.pushPageFrames(whole).length, 0);
    assert.equal(collector.largeWholeFrameDiagnostics.skippedChecksumBudget, 1);
    const crossing = sourceFrame(width, 902, 70000);
    assert.equal(collector.pushPageFrames(crossing.subarray(0, 100)).length, 0);
    const frames = collector.pushPageFrames(crossing.subarray(100));
    assert.equal(frames.length, 1);
    assert.equal(frames[0].elementId, 902);
    assert.equal(frames[0].pageOffset, null);
    assert.equal(frames[0].crossedPage, true);
    assert.deepEqual(frames[0].data, crossing);
    collector.finishPartition();
    assert.equal(collector.pushPageFrames(whole).length, 1);
    assert.equal(collector.largeWholeFrameDiagnostics.admitted, 2);
  }));
}

test("layout fixtures restore conversion globals after every test", () => {
  assert.equal(activeElementIdBytes(), 8);
  assert.equal(fileClassTag(GELEMENT), GELEMENT);
});
