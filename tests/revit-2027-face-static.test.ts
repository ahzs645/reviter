import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027FaceStatic,
  REVIT_2027_FACE_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-face-static.ts";

type Descriptor = {
  token: number;
  sourceClassSlot?: number;
};

function writeDescriptor(
  view: DataView,
  byteOffset: number,
  descriptor: Descriptor,
): number {
  view.setInt32(byteOffset, descriptor.token, true);
  if (descriptor.token === 0) return byteOffset + 4;
  view.setInt16(byteOffset + 4, descriptor.sourceClassSlot!, true);
  return byteOffset + 6;
}

function faceBody(): Uint8Array {
  const bytes = new Uint8Array(72);
  const view = new DataView(bytes.buffer);
  view.setBigInt64(0, 701n, true);
  view.setInt32(8, 17, true);
  view.setInt32(12, 23, true);
  view.setUint32(16, 29, true);

  let cursor = writeDescriptor(view, 20, {
    token: 40,
    sourceClassSlot: 3100,
  });
  view.setInt32(cursor, 2, true);
  cursor += 4;
  cursor = writeDescriptor(view, cursor, {
    token: 41,
    sourceClassSlot: 3101,
  });
  cursor = writeDescriptor(view, cursor, { token: 0 });
  cursor = writeDescriptor(view, cursor, {
    token: 42,
    sourceClassSlot: 3102,
  });
  cursor = writeDescriptor(view, cursor, { token: 0 });
  view.setBigInt64(cursor, 9001n, true);
  cursor += 8;
  view.setInt32(cursor, -3, true);
  cursor += 4;
  view.setUint32(cursor, 0x8000_0005, true);
  cursor += 4;
  cursor = writeDescriptor(view, cursor, {
    token: 43,
    sourceClassSlot: 3103,
  });
  assert.equal(cursor, bytes.byteLength);
  return bytes;
}

test("decodes the complete Revit 2027 Face static body", () => {
  const bytes = faceBody();
  const decoded = decodeRevit2027FaceStatic(
    bytes,
    0,
    bytes.byteLength,
    2027,
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;

  assert.equal(REVIT_2027_FACE_SOURCE_CLASS_SLOT, 1825);
  assert.equal(decoded.value.endOffset, bytes.byteLength);
  assert.deepEqual(decoded.value.gInfo, {
    gStyleElementId: 701n,
    tag: 17,
    controlCommand: 23,
    flags: 29,
  });
  assert.equal(decoded.value.firstLoop.sourceClassSlot, 3100);
  assert.equal(decoded.value.faceRegions.count, 2);
  assert.deepEqual(
    decoded.value.faceRegions.entries.map((entry) => [
      entry.token,
      entry.sourceClassSlot,
    ]),
    [
      [41, 3101],
      [0, null],
    ],
  );
  assert.equal(decoded.value.foregroundFilling.sourceClassSlot, 3102);
  assert.equal(decoded.value.backgroundFilling.sourceClassSlot, null);
  assert.equal(decoded.value.renderStyleElementId, 9001n);
  assert.equal(decoded.value.cutType, -3);
  assert.equal(decoded.value.faceFlags, 0x8000_0005);
  assert.equal(decoded.value.surface.sourceClassSlot, 3103);
  assert.deepEqual(
    decoded.value.queuedProperties.map((entry) => entry.token),
    [40, 41, 42, 43],
  );
});

test("Face reader is release-gated and respects the enclosing boundary", () => {
  const bytes = faceBody();
  assert.deepEqual(
    decodeRevit2027FaceStatic(bytes, 0, bytes.byteLength, 2026),
    {
      ok: false,
      error: "Revit 2027 Face decoding requires release 2027",
    },
  );
  const truncated = decodeRevit2027FaceStatic(
    bytes,
    0,
    bytes.byteLength - 1,
    2027,
  );
  assert.equal(truncated.ok, false);
  if (!truncated.ok) {
    assert.match(truncated.error, /surface.*truncated/i);
  }
});

test("Face reader enforces the face-region collection bound", () => {
  const bytes = faceBody();
  const decoded = decodeRevit2027FaceStatic(
    bytes,
    0,
    bytes.byteLength,
    2027,
    { maxFaceRegions: 1 },
  );
  assert.deepEqual(decoded, {
    ok: false,
    error: "Face regions: CondInt16 collection count is outside the allowed range",
  });
  assert.deepEqual(
    decodeRevit2027FaceStatic(bytes, 0, bytes.byteLength, 2027, {
      maxFaceRegions: -1,
    }),
    {
      ok: false,
      error: "maxFaceRegions must be a non-negative safe integer",
    },
  );
});

test("Face reader retains the native negative-one queued-property sentinel", () => {
  const bytes = faceBody();
  const view = new DataView(bytes.buffer);
  view.setInt32(20, -1, true);
  const decoded = decodeRevit2027FaceStatic(
    bytes,
    0,
    bytes.byteLength,
    2027,
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.firstLoop.token, -1);
  assert.equal(decoded.value.firstLoop.sourceClassSlot, 3100);
  assert.equal(decoded.value.queuedProperties[0]?.token, -1);
});
