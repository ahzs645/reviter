import assert from "node:assert/strict";
import test from "node:test";

import { scanFramedObjectClassEvidence } from "../lib/reviter/element-objects.ts";
import {
  framedObjectClassEvidence,
  indexPageFrames,
} from "../lib/reviter/page-frame-index.ts";

/** One framed object: id, length, marker, and the trailer echoing the length. */
function writeObject(
  view: DataView,
  offset: number,
  elementId: number,
  marker: number,
  objectLength: number,
): number {
  view.setUint32(offset, elementId, true);
  view.setUint32(offset + 12, objectLength, true);
  view.setUint16(offset + 16, marker, true);
  view.setUint32(offset + objectLength + 16, objectLength, true);
  return offset + objectLength + 20;
}

/** A page holding one object per supplied `[id, marker]`, plus a broken echo. */
function framedPage(objects: readonly (readonly [number, number])[]): Uint8Array {
  const data = new Uint8Array(1_024);
  const view = new DataView(data.buffer);
  let cursor = 0;
  for (const [elementId, marker] of objects) {
    cursor = writeObject(view, cursor, elementId, marker, 48);
  }
  // An unframed candidate, so the two implementations have something to reject.
  writeObject(view, cursor, 9_999, 0x0d40, 64);
  view.setUint32(cursor + 64 + 16, 7, true);
  return data;
}

test("the shared page index answers exactly what the standalone evidence pass does", () => {
  // The page walk reads its class evidence off the shared framing index rather
  // than walking the page a second time. The two must not drift apart.
  const data = framedPage([
    [5_000, 0x08c6],
    [5_001, 0x0d7b],
    [5_000, 0x0810],
    [5_002, 0x0810],
  ]);
  const tracked = new Set([0x0810]);
  const seeds = new Set([0x08c6, 0x0810]);

  const derived = framedObjectClassEvidence(indexPageFrames(data), tracked, seeds);
  const direct = scanFramedObjectClassEvidence(data, tracked, seeds);

  assert.deepEqual([...derived.classes], [...direct.classes]);
  assert.deepEqual(derived.seedOffsets, direct.seedOffsets);
  assert.deepEqual(
    [...derived.trackedByElement].map(([id, markers]) => [id, [...markers]]),
    [...direct.trackedByElement].map(([id, markers]) => [id, [...markers]]),
  );
});

test("an empty page yields the same empty evidence either way", () => {
  const data = new Uint8Array(32);
  const derived = framedObjectClassEvidence(
    indexPageFrames(data),
    new Set([0x0810]),
    new Set([0x08c6]),
  );

  assert.equal(derived.classes.size, 0);
  assert.equal(derived.trackedByElement.size, 0);
  assert.deepEqual(derived.seedOffsets, []);
});

test("the marker gate reports a marker only when a frame is actually headed by it", () => {
  // Every decoder skipped on `hasMarker` being false relies on this: the index
  // does not step over a decoded frame, so its frames are a superset of any
  // walk that does, and a marker missing here is missing from all of them.
  const data = framedPage([[6_100, 0x0ad3], [6_101, 0x08c6]]);
  const index = indexPageFrames(data);

  assert.equal(index.hasMarker(0x0ad3), true);
  assert.equal(index.hasMarker(0x08c6), true);
  // Present in the page's bytes as a broken candidate, but heads no frame.
  assert.equal(index.hasMarker(0x0d40), false);
  assert.equal(index.hasMarker(0x0270), false);
});
