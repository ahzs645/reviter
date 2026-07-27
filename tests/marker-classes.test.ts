import assert from "node:assert/strict";
import test from "node:test";

import {
  markerCategoryConsensus,
  scanFramedObjectClasses,
} from "../lib/reviter/element-objects.ts";

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

test("reads a class key from every framed object, not only the common markers", () => {
  // The chain is seeded from the markers a sample of pages says are common, so
  // a twelve-member class — `0x0d7b` heads 12 objects in the supplied model —
  // is only ever reached by chaining off a neighbour. The class key has to come
  // from the page itself.
  const data = new Uint8Array(512);
  const view = new DataView(data.buffer);
  let cursor = 0;
  cursor = writeObject(view, cursor, 5_000, 0x08c6, 64);
  cursor = writeObject(view, cursor, 5_001, 0x0d7b, 48);
  writeObject(view, cursor, 5_002, 0x0d40, 56);

  const classes = scanFramedObjectClasses(data);
  assert.equal(classes.get(5_000), 0x08c6);
  assert.equal(classes.get(5_001), 0x0d7b);
  assert.equal(classes.get(5_002), 0x0d40);
});

test("an object whose trailer does not echo its length is not a class key", () => {
  const data = new Uint8Array(256);
  const view = new DataView(data.buffer);
  writeObject(view, 0, 7_100, 0x0d7b, 64);
  view.setUint32(64 + 16, 999, true); // the echo, broken

  assert.equal(scanFramedObjectClasses(data).has(7_100), false);
});

test("the first framed object claims the id", () => {
  // An element written twice — a small class object and a `0x08c6` object —
  // must not have its class key overwritten by whichever copy comes last.
  const data = new Uint8Array(512);
  const view = new DataView(data.buffer);
  const next = writeObject(view, 0, 8_200, 0x0d7b, 64);
  writeObject(view, next, 8_200, 0x08c6, 48);

  assert.equal(scanFramedObjectClasses(data).get(8_200), 0x0d7b);
});

test("a marker's members speak for the member that carries no category token", () => {
  // The supplied project writes 8 `Ramps` tokens against 12 ramps. The ramps
  // with a token and the ramps without share an object marker, which is the
  // only key the token-less ones have.
  const markers = new Map([
    [1, 0x0d7b], [2, 0x0d7b], [3, 0x0d7b], [4, 0x0d7b],
  ]);
  const categories = new Map([[1, -2000180], [2, -2000180], [3, -2000180]]);

  const consensus = markerCategoryConsensus(markers, categories);
  assert.equal(consensus.get(0x0d7b), -2000180);
});

test("a marker whose members disagree publishes nothing", () => {
  // Purity is the whole gate: used as a general category decoder, marker
  // consensus disagrees with the paired export 265 times, so a marker that is
  // merely dominant must not speak for its members here.
  const markers = new Map([[1, 0x07ef], [2, 0x07ef], [3, 0x07ef], [4, 0x07ef]]);
  const categories = new Map([[1, -2000180], [2, -2000180], [3, -2000180], [4, -2000023]]);

  assert.equal(markerCategoryConsensus(markers, categories).has(0x07ef), false);
  // Two of three agreeing is not evidence either.
  assert.equal(
    markerCategoryConsensus(markers, categories, { minSupport: 3, minPurity: 0.7 }).get(0x07ef),
    -2000180,
    "loosening purity is what admits it, which is why the shipped floor is 1.0",
  );
});

test("a marker with too few tokened members publishes nothing", () => {
  const markers = new Map([[1, 0x0d40], [2, 0x0d40], [3, 0x0d40]]);
  const categories = new Map([[1, -2000032], [2, -2000032]]);

  assert.equal(markerCategoryConsensus(markers, categories).has(0x0d40), false);
  assert.equal(markerCategoryConsensus(markers, categories, { minSupport: 2 }).get(0x0d40), -2000032);
});

test("an element with a category and no object contributes to no marker", () => {
  const consensus = markerCategoryConsensus(new Map(), new Map([[1, -2000180]]));
  assert.equal(consensus.size, 0);
});
