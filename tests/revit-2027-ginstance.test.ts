import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027GInstanceStatic,
  decodeRevit2027InstanceInfo,
  REVIT_2027_GINSTANCE_BODY_BYTES,
  REVIT_2027_GINSTANCE_EMBEDDED_BODY_BYTES,
  REVIT_2027_INSTANCE_INFO_BODY_BYTES,
  REVIT_2027_INSTANCE_INFO_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-ginstance.ts";
import {
  REVIT_2027_GELEMENT_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-gelement.ts";

function writeGInstance(data: Uint8Array): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  view.setBigInt64(0, -1n, true);
  view.setInt32(8, 2, true);
  view.setInt32(12, 0, true);
  view.setUint32(16, 0x0008_8024, true);
  view.setInt32(20, -1, true);
  view.setInt16(24, REVIT_2027_INSTANCE_INFO_SOURCE_CLASS_SLOT, true);
  view.setInt32(26, 0, true);
  view.setBigInt64(30, -1n, true);
  view.setInt32(38, 53_246, true);
  data[42] = 0;
  data[43] = 0;
}

function writeInstanceInfo(data: Uint8Array): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const transform = [1, 0, 0, 0, 1, 0, 0, 0, 1, 12.5, -3, 144];
  transform.forEach((value, index) => {
    view.setFloat64(index * 8, value, true);
  });
  view.setBigInt64(96, 1_031_707n, true);
  view.setInt32(104, 0, true);
  view.setInt32(108, 1, true);
}

test("decodes the exact 44-byte Revit 2027 GInstance static body", () => {
  const data = new Uint8Array(REVIT_2027_GINSTANCE_BODY_BYTES);
  writeGInstance(data);

  const decoded = decodeRevit2027GInstanceStatic(
    data,
    0,
    data.byteLength,
    2027,
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.endOffset, 44);
  assert.equal(decoded.value.gInfo.tag, 2);
  assert.equal(decoded.value.gInfo.flags, 0x0008_8024);
  assert.equal(decoded.value.instanceInfo.token, -1);
  assert.equal(
    decoded.value.instanceInfo.sourceClassSlot,
    REVIT_2027_INSTANCE_INFO_SOURCE_CLASS_SLOT,
  );
  assert.equal(decoded.value.embeddedSymbolGRep.token, 0);
  assert.equal(decoded.value.tagElementId, -1n);
  assert.equal(decoded.value.forbiddenTarget, 53_246);
  assert.equal(decoded.value.resolveSymbolInView, false);
  assert.equal(decoded.value.hasScale, false);
});

test("GInstance rejects a non-certified InstanceInfo descriptor", () => {
  const data = new Uint8Array(REVIT_2027_GINSTANCE_BODY_BYTES);
  writeGInstance(data);
  new DataView(data.buffer).setInt16(24, 2_512, true);

  const decoded = decodeRevit2027GInstanceStatic(
    data,
    0,
    data.byteLength,
    2027,
  );
  assert.equal(decoded.ok, false);
  if (decoded.ok) return;
  assert.match(decoded.error, /token -1\/source-slot 2513/);
});

test("decodes the exact 46-byte embedded-GElement GInstance form", () => {
  const data = new Uint8Array(REVIT_2027_GINSTANCE_EMBEDDED_BODY_BYTES);
  const view = new DataView(data.buffer);
  view.setBigInt64(0, -1n, true);
  view.setInt32(8, 2, true);
  view.setUint32(16, 0x0008_8004, true);
  view.setInt32(20, -1, true);
  view.setInt16(24, REVIT_2027_INSTANCE_INFO_SOURCE_CLASS_SLOT, true);
  view.setInt32(26, 6, true);
  view.setInt16(30, REVIT_2027_GELEMENT_SOURCE_CLASS_SLOT, true);
  view.setBigInt64(32, -1n, true);
  view.setInt32(40, 0, true);
  data[44] = 0;
  data[45] = 0;

  const decoded = decodeRevit2027GInstanceStatic(
    data,
    0,
    data.byteLength,
    2027,
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.endOffset, 46);
  assert.equal(decoded.value.embeddedSymbolGRep.token, 6);
  assert.equal(
    decoded.value.embeddedSymbolGRep.sourceClassSlot,
    REVIT_2027_GELEMENT_SOURCE_CLASS_SLOT,
  );
  assert.equal(decoded.value.tagElementId, -1n);
  assert.equal(decoded.value.forbiddenTarget, 0);
});

test("GInstance rejects an unproven embedded source slot and descriptor-length mismatch", () => {
  const data = new Uint8Array(REVIT_2027_GINSTANCE_EMBEDDED_BODY_BYTES);
  const view = new DataView(data.buffer);
  view.setInt32(20, -1, true);
  view.setInt16(24, REVIT_2027_INSTANCE_INFO_SOURCE_CLASS_SLOT, true);
  view.setInt32(26, 6, true);
  view.setInt16(30, REVIT_2027_GELEMENT_SOURCE_CLASS_SLOT + 1, true);

  const wrongSlot = decodeRevit2027GInstanceStatic(
    data,
    0,
    data.byteLength,
    2027,
  );
  assert.equal(wrongSlot.ok, false);
  if (!wrongSlot.ok) assert.match(wrongSlot.error, /source-slot 2246/);

  view.setInt16(30, REVIT_2027_GELEMENT_SOURCE_CLASS_SLOT, true);
  assert.equal(
    decodeRevit2027GInstanceStatic(data, 0, data.byteLength - 2, 2027).ok,
    false,
  );
});

test("decodes the exact 112-byte Revit 2027 InstanceInfo body", () => {
  const data = new Uint8Array(REVIT_2027_INSTANCE_INFO_BODY_BYTES);
  writeInstanceInfo(data);

  const decoded = decodeRevit2027InstanceInfo(data, 0, data.byteLength, 2027);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.endOffset, 112);
  assert.deepEqual(decoded.value.transform.xAxis, [1, 0, 0]);
  assert.deepEqual(decoded.value.transform.origin, [12.5, -3, 144]);
  assert.equal(decoded.value.symbolElementId, 1_031_707n);
  assert.equal(decoded.value.gRepId, 0);
  assert.equal(decoded.value.cda, 1);
});

test("InstanceInfo keeps transform validation fail closed", () => {
  const data = new Uint8Array(REVIT_2027_INSTANCE_INFO_BODY_BYTES);
  writeInstanceInfo(data);
  new DataView(data.buffer).setFloat64(16, Number.NaN, true);

  const decoded = decodeRevit2027InstanceInfo(data, 0, data.byteLength, 2027);
  assert.equal(decoded.ok, false);
  if (decoded.ok) return;
  assert.equal(decoded.error, "Trf201120260 contains a non-finite scalar");
});

test("GInstance and InstanceInfo reject wrong releases and body sizes", () => {
  const gInstance = new Uint8Array(REVIT_2027_GINSTANCE_BODY_BYTES);
  writeGInstance(gInstance);
  assert.equal(
    decodeRevit2027GInstanceStatic(
      gInstance,
      0,
      gInstance.byteLength,
      2026,
    ).ok,
    false,
  );
  assert.equal(
    decodeRevit2027GInstanceStatic(
      gInstance,
      0,
      gInstance.byteLength - 1,
      2027,
    ).ok,
    false,
  );

  const instanceInfo = new Uint8Array(REVIT_2027_INSTANCE_INFO_BODY_BYTES);
  writeInstanceInfo(instanceInfo);
  assert.equal(
    decodeRevit2027InstanceInfo(
      instanceInfo,
      0,
      instanceInfo.byteLength,
      2026,
    ).ok,
    false,
  );
  assert.equal(
    decodeRevit2027InstanceInfo(
      instanceInfo,
      0,
      instanceInfo.byteLength - 1,
      2027,
    ).ok,
    false,
  );
});
