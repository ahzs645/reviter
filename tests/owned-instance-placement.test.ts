import assert from "node:assert/strict";
import test from "node:test";
import { readOwnedInstancePlacement } from "../lib/reviter/owned-instance-placement.ts";
import { instanceCorners, readInstancePlacement } from "../lib/reviter/instanced-geometry.ts";
import { REVIT_2027_GELEMENT_OBJECT_MARKER } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import { REVIT_2027_GINSTANCE_SOURCE_CLASS_SLOT, REVIT_2027_INSTANCE_INFO_SOURCE_CLASS_SLOT } from "../lib/reviter/revit-2027-ginstance.ts";

function fixture() {
  const data = new Uint8Array(320), v = new DataView(data.buffer);
  const elementId = 100, objectLength = 300, classIndex = REVIT_2027_GELEMENT_OBJECT_MARKER;
  v.setBigUint64(0, BigInt(elementId), true);
  v.setUint32(12, objectLength, true); v.setUint16(16, classIndex, true);
  v.setUint32(38, 1, true);
  v.setInt32(42, 3, true); v.setInt16(46, REVIT_2027_GINSTANCE_SOURCE_CLASS_SLOT, true);
  // Local and world extents, followed by owner/type/flags.
  for (const at of [48, 96]) for (let i = 0; i < 6; i++) v.setFloat64(at + i * 8, i < 3 ? -100 : 100, true);
  v.setBigUint64(144, BigInt(elementId), true); v.setInt32(152, 3, true);
  v.setInt32(180, -1, true); v.setInt16(184, REVIT_2027_INSTANCE_INFO_SOURCE_CLASS_SLOT, true);
  v.setBigInt64(190, -1n, true);
  const angle = Math.PI / 5, c = Math.cos(angle), s = Math.sin(angle);
  [c,s,0,-s,c,0,0,0,1,10,20,30].forEach((x,i) => v.setFloat64(204 + i * 8, x, true));
  v.setBigUint64(300, 200n, true); v.setInt32(312, 1, true); v.setUint32(316, objectLength, true);
  return { elementId, objectLength, classIndex, data, firstChunk: 0, lastChunk: 0 };
}

test("owned FIFO placement agrees with the established serialized occurrence reader for an oblique rotation", () => {
  const record = fixture();
  const owned = readOwnedInstancePlacement(record, 2027);
  const legacy = readInstancePlacement(record.data, { offset: 0, elementId: record.elementId, objectLength: record.objectLength, marker: record.classIndex, typeCode: 0 });
  assert.ok(owned); assert.ok(legacy);
  assert.deepEqual(owned.placement, legacy);
  const [corner] = instanceCorners(owned.placement, { elementId: 200, min: [0,2,0], max: [0,2,0] });
  assert.ok(Math.abs(corner![0] - (10 + 2 * Math.sin(Math.PI / 5))) < 1e-12);
  assert.ok(Math.abs(corner![1] - (20 + 2 * Math.cos(Math.PI / 5))) < 1e-12);
  assert.equal(corner![2], 30);
});

test("owned placement retains its unscaled, complete-frame gates", () => {
  const scaled = fixture(); scaled.data[203] = 1;
  assert.equal(readOwnedInstancePlacement(scaled, 2027), null);
  const truncated = fixture(); truncated.data = truncated.data.subarray(0, 310);
  assert.equal(readOwnedInstancePlacement(truncated, 2027), null);
});
