import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027GArray,
  decodeRevit2027GGroupPrefix,
  REVIT_2027_GARRAY_BODY_BYTES,
} from "../lib/reviter/revit-2027-grep-prefixes.ts";

function writeGInfo(view: DataView, offset: number): void {
  view.setBigInt64(offset, 145n, true);
  view.setInt32(offset + 8, -1, true);
  view.setInt32(offset + 12, 0, true);
  view.setUint32(offset + 16, 0x0008_8004, true);
}

function gArrayFixture(): Uint8Array {
  const data = new Uint8Array(REVIT_2027_GARRAY_BODY_BYTES);
  const view = new DataView(data.buffer);
  writeGInfo(view, 0);
  view.setInt32(20, -1, true);
  view.setInt16(24, 2513, true);
  view.setInt32(26, 0, true);
  view.setBigInt64(30, 91n, true);
  view.setInt32(38, 53_246, true);
  data[42] = 1;
  data[43] = 0;
  const transform = [1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 20, 30];
  transform.forEach((value, index) => {
    view.setFloat64(44 + index * 8, value, true);
  });
  return data;
}

test("decodes the exact release-gated Revit 2027 GArray body", () => {
  const data = gArrayFixture();
  const result = decodeRevit2027GArray(data, 0, data.byteLength, 2027);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.instanceInfo.token, -1);
  assert.equal(result.value.instanceInfo.sourceClassSlot, 2513);
  assert.equal(result.value.embeddedSymbolGRep.token, 0);
  assert.equal(result.value.tagElementId, 91n);
  assert.equal(result.value.forbiddenTarget, 53_246);
  assert.equal(result.value.resolveSymbolInView, true);
  assert.equal(result.value.hasScale, false);
  assert.deepEqual(result.value.stepTransform.origin, [10, 20, 30]);
  assert.equal(result.value.endOffset, REVIT_2027_GARRAY_BODY_BYTES);
});

test("GArray rejects another release, another body size, and invalid fields", () => {
  const data = gArrayFixture();
  const wrongRelease = decodeRevit2027GArray(
    data,
    0,
    data.byteLength,
    2026,
  );
  assert.equal(wrongRelease.ok, false);
  if (!wrongRelease.ok) {
    assert.match(wrongRelease.error, /requires release 2027/);
  }
  assert.equal(
    decodeRevit2027GArray(data, 0, data.byteLength - 1, 2027).ok,
    false,
  );

  const invalidDescriptor = gArrayFixture();
  new DataView(invalidDescriptor.buffer).setInt32(26, 4, true);
  assert.equal(
    decodeRevit2027GArray(
      invalidDescriptor,
      0,
      invalidDescriptor.byteLength,
      2027,
    ).ok,
    false,
  );

  const invalidBoolean = gArrayFixture();
  invalidBoolean[42] = 2;
  assert.equal(
    decodeRevit2027GArray(
      invalidBoolean,
      0,
      invalidBoolean.byteLength,
      2027,
    ).ok,
    false,
  );
});

test("decodes a bounded Revit 2027 GGroup prefix and stops at its suffix", () => {
  const data = new Uint8Array(80);
  const view = new DataView(data.buffer);
  writeGInfo(view, 8);
  view.setInt32(28, 3, true);
  view.setInt32(32, 5, true);
  view.setInt16(36, 2248, true);
  view.setInt32(38, 0, true);
  view.setInt32(42, 6, true);
  view.setInt16(46, 2215, true);
  data.fill(0xaa, 48);

  const result = decodeRevit2027GGroupPrefix(data, 8, data.byteLength, 2027);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.firstUnknownSuffixOffset, 48);
  assert.deepEqual(
    result.value.children.map(({ token, sourceClassSlot }) => ({
      token,
      sourceClassSlot,
    })),
    [
      { token: 5, sourceClassSlot: 2248 },
      { token: 0, sourceClassSlot: null },
      { token: 6, sourceClassSlot: 2215 },
    ],
  );
  assert.equal(data[result.value.firstUnknownSuffixOffset], 0xaa);
});

test("GGroup prefix is release-gated and bounded", () => {
  const data = new Uint8Array(32);
  const view = new DataView(data.buffer);
  writeGInfo(view, 0);
  view.setInt32(20, 1, true);
  view.setInt32(24, 3, true);
  view.setInt16(28, 2248, true);

  assert.equal(
    decodeRevit2027GGroupPrefix(data, 0, data.byteLength, 2026).ok,
    false,
  );
  assert.equal(decodeRevit2027GGroupPrefix(data, 0, 29, 2027).ok, false);
  assert.equal(
    decodeRevit2027GGroupPrefix(data, 0, data.byteLength, 2027, {
      maxChildren: 0,
    }).ok,
    false,
  );
});
