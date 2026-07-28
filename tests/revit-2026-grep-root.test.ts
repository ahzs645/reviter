import assert from "node:assert/strict";
import test from "node:test";

import type { ElementObject } from "../lib/reviter/element-objects.ts";
import {
  decodeRevit2026GRepRoot,
  REVIT_2026_GELEMENT_OBJECT_MARKER,
} from "../lib/reviter/revit-2026-grep-root.ts";

function writeExtents(
  view: DataView,
  offset: number,
  minimum: readonly [number, number, number],
  maximum: readonly [number, number, number],
): void {
  [...minimum, ...maximum].forEach((value, index) => {
    view.setFloat64(offset + index * 8, value, true);
  });
}

function fixture(options: {
  elementId?: number;
  children?: readonly { token: number; sourceClassSlot?: number }[];
  objectLength?: number;
} = {}): { data: Uint8Array; frame: ElementObject } {
  const elementId = options.elementId ?? 400_237;
  const children = options.children ?? [
    { token: 3, sourceClassSlot: 2248 },
    { token: 0 },
    { token: 4, sourceClassSlot: 1973 },
  ];
  const objectLength = options.objectLength ?? 360;
  const data = new Uint8Array(objectLength + 20);
  const view = new DataView(data.buffer);
  view.setBigUint64(0, BigInt(elementId), true);
  view.setUint32(12, objectLength, true);
  view.setUint16(16, REVIT_2026_GELEMENT_OBJECT_MARKER, true);

  let offset = 18;
  view.setBigUint64(offset, 91n, true);
  view.setInt32(offset + 8, 7, true);
  view.setInt32(offset + 12, -2, true);
  view.setUint32(offset + 16, 0x20, true);
  offset += 20;
  view.setInt32(offset, children.length, true);
  offset += 4;
  for (const child of children) {
    view.setInt32(offset, child.token, true);
    offset += 4;
    if (child.token !== 0) {
      view.setInt16(offset, child.sourceClassSlot ?? 1, true);
      offset += 2;
    }
  }
  writeExtents(view, offset, [1, 2, 3], [4, 5, 6]);
  offset += 48;
  writeExtents(view, offset, [-2, -1, 0], [7, 8, 9]);
  offset += 48;
  view.setBigInt64(offset, BigInt(elementId), true);
  view.setInt32(offset + 8, 2, true);
  view.setUint32(offset + 12, 0x20, true);
  view.setUint32(objectLength + 16, objectLength, true);

  return {
    data,
    frame: {
      offset: 0,
      elementId,
      objectLength,
      marker: REVIT_2026_GELEMENT_OBJECT_MARKER,
      typeCode: 91,
    },
  };
}

test("decodes a complete framed GElement/GRep static root", () => {
  const { data, frame } = fixture();
  const result = decodeRevit2026GRepRoot(data, frame);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.ownerElementId, 400_237n);
  assert.deepEqual(result.value.gInfo, {
    gStyleElementId: 91n,
    tag: 7,
    controlCommand: -2,
    flags: 0x20,
  });
  assert.deepEqual(
    result.value.children.map(({ token, sourceClassSlot }) => ({
      token,
      sourceClassSlot,
    })),
    [
      { token: 3, sourceClassSlot: 2248 },
      { token: 0, sourceClassSlot: null },
      { token: 4, sourceClassSlot: 1973 },
    ],
  );
  assert.deepEqual(result.value.localExtents, {
    minimum: [1, 2, 3],
    maximum: [4, 5, 6],
    valid: true,
  });
  assert.deepEqual(result.value.worldExtents, {
    minimum: [-2, -1, 0],
    maximum: [7, 8, 9],
    valid: true,
  });
  assert.equal(result.value.objectType, 2);
  assert.equal(result.value.flags, 0x20);
  assert.equal(result.value.dynamicPayloadEndOffset, frame.objectLength);
  assert.ok(result.value.dynamicPayloadOffset < result.value.dynamicPayloadEndOffset);
});

test("retains sentinel/invalid extents without treating them as certified bounds", () => {
  const { data, frame } = fixture();
  const view = new DataView(data.buffer);
  // 18-byte frame prefix + 20-byte GInfo + 4-byte count + 16-byte entries.
  view.setFloat64(58, Number.POSITIVE_INFINITY, true);
  const result = decodeRevit2026GRepRoot(data, frame);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.localExtents.valid, false);
});

test("rejects an owner-id conflict", () => {
  const { data, frame } = fixture();
  const result = decodeRevit2026GRepRoot(data, frame);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  new DataView(data.buffer).setBigInt64(
    result.value.dynamicPayloadOffset - 16,
    999n,
    true,
  );
  assert.deepEqual(decodeRevit2026GRepRoot(data, frame), {
    ok: false,
    error: "GRep owner id does not match its framed element",
  });
});

test("rejects a broken frame echo and a non-GElement marker", () => {
  const brokenEcho = fixture();
  new DataView(brokenEcho.data.buffer).setUint32(
    brokenEcho.frame.objectLength + 16,
    1,
    true,
  );
  assert.equal(decodeRevit2026GRepRoot(brokenEcho.data, brokenEcho.frame).ok, false);

  const wrongMarker = fixture();
  wrongMarker.frame.marker = 2215;
  assert.equal(decodeRevit2026GRepRoot(wrongMarker.data, wrongMarker.frame).ok, false);
});

test("rejects a child collection that overruns the frame", () => {
  const { data, frame } = fixture();
  new DataView(data.buffer).setInt32(38, 10_001, true);
  assert.deepEqual(decodeRevit2026GRepRoot(data, frame), {
    ok: false,
    error: "GGroup child count is outside the allowed range",
  });
});
