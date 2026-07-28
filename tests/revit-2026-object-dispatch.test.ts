import assert from "node:assert/strict";
import test from "node:test";

import { SurrogateObjectPropertyRegistry } from "../lib/reviter/dynamic-object-registry.ts";
import {
  decodeRevit2026GPolyMeshStatic,
  dispatchRevit2026ObjectPtrInit,
  REVIT_2026_GPOLYMESH_SOURCE_CLASS,
} from "../lib/reviter/revit-2026-object-dispatch.ts";

function gPolyMeshBytes(options: {
  includeSelector: boolean;
  topologyToken?: number;
  topologySourceClassSlot?: number;
}): Uint8Array {
  const topologyToken = options.topologyToken ?? 91;
  const hasSourceClass = topologyToken !== 0;
  const selectorBytes = options.includeSelector ? 2 : 0;
  const data = new Uint8Array(
    selectorBytes + 20 + 4 + (hasSourceClass ? 2 : 0) + 20,
  );
  const view = new DataView(data.buffer);
  let offset = 0;
  if (options.includeSelector) {
    view.setInt16(offset, REVIT_2026_GPOLYMESH_SOURCE_CLASS, true);
    offset += 2;
  }
  view.setBigUint64(offset, 1001n, true);
  view.setInt32(offset + 8, 17, true);
  view.setInt32(offset + 12, -4, true);
  view.setUint32(offset + 16, 0x80000001, true);
  view.setInt32(offset + 20, topologyToken, true);
  offset += 24;
  if (hasSourceClass) {
    view.setInt16(offset, options.topologySourceClassSlot ?? 5255, true);
    offset += 2;
  }
  view.setBigUint64(offset, 2002n, true);
  view.setBigUint64(offset + 8, 3003n, true);
  view.setInt32(offset + 16, -7, true);
  return data;
}

test("dispatches a stream-selected Revit 2026 GPolyMesh into the registry", () => {
  const data = gPolyMeshBytes({ includeSelector: true });
  const registry = new SurrogateObjectPropertyRegistry();
  const result = dispatchRevit2026ObjectPtrInit(data, registry, {
    byteOffset: 0,
    objectIdentity: "outer:0/gpoly:0",
    parentIdentity: null,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.selectorOffset, 0);
  assert.equal(result.value.bodyOffset, 2);
  assert.equal(result.value.endOffset, data.byteLength);
  assert.equal(result.value.sourceClassSlot, 2237);
  assert.equal(result.value.selectorReadFromStream, true);
  assert.deepEqual(result.value.value.gInfo, {
    gStyleElementId: 1001n,
    tag: 17,
    controlCommand: -4,
    flags: 0x80000001,
  });
  assert.equal(result.value.value.topologyPropertyToken, 91);
  assert.equal(result.value.value.topologySourceClassSlot, 5255);
  assert.equal(result.value.value.topologyDescriptorEndOffset, 28);
  assert.equal(result.value.value.interiorStyleElementId, 2002n);
  assert.equal(result.value.value.materialElementId, 3003n);
  assert.equal(result.value.value.polyMeshFlags, -7);
  assert.equal(registry.objectCount, 1);
  assert.equal(registry.propertyCount, 1);
  assert.equal(registry.queueLength, 1);

  assert.equal(
    registry.sealOuterStaticTraversal("outer:0/gpoly:0", data.byteLength).ok,
    true,
  );
  assert.equal(registry.initializeReferences().ok, true);
  const certified = registry.certifySinglePropertyReplay(data.byteLength);
  assert.equal(certified.ok, true);
  if (!certified.ok) return;
  assert.equal(certified.value.descriptorOffset, 22);
  assert.equal(certified.value.descriptorEndOffset, 28);
  assert.equal(certified.value.objectSourceClassSlot, 2237);
  assert.equal(certified.value.propertySourceClassSlot, 5255);
});

test("uses an already scoped source class without consuming selector bytes", () => {
  const data = gPolyMeshBytes({ includeSelector: false });
  const registry = new SurrogateObjectPropertyRegistry();
  const result = dispatchRevit2026ObjectPtrInit(data, registry, {
    byteOffset: 0,
    objectIdentity: "outer:0/gpoly:0",
    parentIdentity: null,
    scopedSourceClassSlot: REVIT_2026_GPOLYMESH_SOURCE_CLASS,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.selectorOffset, null);
  assert.equal(result.value.bodyOffset, 0);
  assert.equal(result.value.endOffset, data.byteLength);
  assert.equal(result.value.selectorReadFromStream, false);
  assert.equal(result.value.value.topologyDescriptorEndOffset, 26);
});

test("rejects unregistered release slots without mutating the registry", () => {
  const data = new Uint8Array(48);
  new DataView(data.buffer).setInt16(0, 2210, true);
  const registry = new SurrogateObjectPropertyRegistry();
  const result = dispatchRevit2026ObjectPtrInit(data, registry, {
    byteOffset: 0,
    objectIdentity: "outer:0/fake-brep:0",
    parentIdentity: null,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /has no proven browser static reader/);
  assert.equal(registry.objectCount, 0);
  assert.equal(registry.propertyCount, 0);
  assert.equal(registry.queueLength, 0);
});

test("fails closed on truncated and invalid topology descriptors", () => {
  const truncated = decodeRevit2026GPolyMeshStatic(new Uint8Array(23), 0);
  assert.equal(truncated.ok, false);
  if (!truncated.ok) assert.match(truncated.error, /prefix is truncated/);

  const invalid = gPolyMeshBytes({
    includeSelector: false,
    topologySourceClassSlot: -1,
  });
  const result = decodeRevit2026GPolyMeshStatic(invalid, 0);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /source-class slot is invalid/);
});

test("preserves a null conditional topology without certifying replay", () => {
  const data = gPolyMeshBytes({
    includeSelector: true,
    topologyToken: 0,
  });
  const registry = new SurrogateObjectPropertyRegistry();
  const result = dispatchRevit2026ObjectPtrInit(data, registry, {
    byteOffset: 0,
    objectIdentity: "outer:0/gpoly:0",
    parentIdentity: null,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.value.topologySourceClassSlot, null);
  assert.equal(result.value.value.topologyDescriptorEndOffset, 26);
  assert.equal(registry.queueLength, 0);
  assert.equal(
    registry.sealOuterStaticTraversal("outer:0/gpoly:0", data.byteLength).ok,
    true,
  );
  assert.equal(registry.initializeReferences().ok, true);
  const certified = registry.certifySinglePropertyReplay(data.byteLength);
  assert.equal(certified.ok, false);
  if (!certified.ok) assert.match(certified.error, /single globally queued/);
});
