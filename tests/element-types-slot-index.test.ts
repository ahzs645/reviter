/**
 * The slot index behind `collectTypeLinks`.
 *
 * Records no longer search their own 1,200-byte window for a field slot; the
 * page is indexed once and each record head reads the first slot at or after
 * its own offset. These pin the edges of that substitution — the window bound,
 * a slot shared by consecutive heads, a slot that lies behind a head, and the
 * cheap rejections that let most pages be dropped without being walked.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { collectTypeLinks } from "../lib/reviter/element-types.ts";

/** Bytes of a record searched for a field slot, mirroring the module. */
const RECORD_SEARCH_BYTES = 1_200;

/** Write the framing that makes `at` a record head owning `elementId`. */
function writeRecordHead(view: DataView, at: number, elementId: number): void {
  view.setUint32(at, elementId, true);
  view.setUint32(at + 4, 0, true);
  view.setUint32(at + 8, 0x1234_5678, true); // stamp: neither all-zero nor all-ones
  view.setUint32(at + 12, 0x9abc_def0, true);
  view.setUint16(at + 16, 0x0f3b, true);
  view.setUint32(at + 18, 0xffff_ffff, true);
  view.setUint16(at + 22, 0x0c93, true);
}

/** Write `ff ff ff ff 04 11` and the length-prefixed UTF-16 name at `at`. */
function writeNameSlot(data: Uint8Array, view: DataView, at: number, name: string): void {
  data.set([0xff, 0xff, 0xff, 0xff, 0x04, 0x11], at);
  view.setUint32(at + 6, name.length, true);
  for (let index = 0; index < name.length; index += 1) {
    view.setUint16(at + 10 + index * 2, name.charCodeAt(index), true);
  }
}

test("a name slot past the record's search window is not its name", () => {
  const name = "Generic - 200mm";
  const build = (slotAt: number): Uint8Array => {
    const data = new Uint8Array(slotAt + 10 + name.length * 2 + 64);
    const view = new DataView(data.buffer);
    writeRecordHead(view, 0, 609157);
    writeNameSlot(data, view, slotAt, name);
    return data;
  };

  // The window is inclusive of its last starting offset and exclusive beyond it.
  assert.deepEqual(collectTypeLinks(build(RECORD_SEARCH_BYTES)).names, [
    { typeId: 609157, name },
  ]);
  assert.deepEqual(collectTypeLinks(build(RECORD_SEARCH_BYTES + 1)).names, []);
});

test("one slot names every record head still within reach of it", () => {
  // Two heads 32 bytes apart, both inside the window of a single later slot.
  // Reading the index must not consume the slot on behalf of the first head.
  const name = "Curtain Wall";
  const slotAt = 512;
  const data = new Uint8Array(slotAt + 10 + name.length * 2 + 64);
  const view = new DataView(data.buffer);
  writeRecordHead(view, 0, 700_001);
  writeRecordHead(view, 32, 700_002);
  writeNameSlot(data, view, slotAt, name);

  assert.deepEqual(collectTypeLinks(data).names, [
    { typeId: 700_001, name },
    { typeId: 700_002, name },
  ]);
});

test("a slot behind a record head belongs to no later record", () => {
  const name = "Exterior Brick";
  const data = new Uint8Array(1_024);
  const view = new DataView(data.buffer);
  writeNameSlot(data, view, 0, name);
  // The head sits after the slot, so scanning forward from it finds nothing.
  writeRecordHead(view, 256, 811_000);

  assert.deepEqual(collectTypeLinks(data).names, []);
});

test("a 0x11 byte without the null-field marker in front of it is not a slot", () => {
  const name = "Interior Partition";
  const data = new Uint8Array(1_024);
  const view = new DataView(data.buffer);
  writeRecordHead(view, 0, 900_123);
  writeNameSlot(data, view, 64, name);
  assert.deepEqual(collectTypeLinks(data).names, [{ typeId: 900_123, name }]);

  // Break one byte of the marker: the field id still reads 0x1104, but the
  // slot no longer opens with ff ff ff ff, so it is not a slot at all.
  data[65] = 0xfe;
  assert.deepEqual(collectTypeLinks(data).names, []);

  // Restore the marker and change the field id instead.
  data[65] = 0xff;
  data[68] = 0x05;
  assert.deepEqual(collectTypeLinks(data).names, []);
});

test("a page framing records but holding no field slot yields nothing", () => {
  const data = new Uint8Array(4_096);
  const view = new DataView(data.buffer);
  for (let at = 0; at + 64 <= data.byteLength; at += 64) {
    writeRecordHead(view, at, 500_000 + at);
  }
  assert.deepEqual(collectTypeLinks(data), { references: [], names: [] });
});

test("a page too short to frame a record is rejected before it is indexed", () => {
  const data = new Uint8Array(63);
  data.fill(0xff);
  assert.deepEqual(collectTypeLinks(data), { references: [], names: [] });
});

test("a type reference is read from a page that carries no name slot", () => {
  // Exercises the index when only one of the two slot kinds is present.
  const data = new Uint8Array(256);
  const view = new DataView(data.buffer);
  writeRecordHead(view, 0, 350_100);
  data.set([0xff, 0xff, 0xff, 0xff, 0x6f, 0x11], 28);
  view.setUint32(34, 0, true); // no index entries
  view.setUint32(50, 192_162, true); // the id where the zero run ends
  view.setUint32(54, 0, true);

  assert.deepEqual(collectTypeLinks(data), {
    references: [{ elementId: 350_100, typeId: 192_162 }],
    names: [],
  });
});
