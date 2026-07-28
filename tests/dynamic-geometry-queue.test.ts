import assert from "node:assert/strict";
import test from "node:test";

import {
  bindQueuedFacetedTopology8,
  decodeCondInt16QueueCollection,
  decodeTrf201120260,
  locateCondInt16QueueEndingAt,
  REVIT_2026_GPOLYMESH_SOURCE_CLASS,
  REVIT_COMMON_FACETED_TOPOLOGY8_SOURCE_CLASS,
  type RevitTransform3d,
} from "../lib/reviter/dynamic-geometry-queue.ts";
import {
  SurrogateObjectPropertyRegistry,
  type DynamicQueueReplayCertificate,
} from "../lib/reviter/dynamic-object-registry.ts";

function writeTopology8(data: Uint8Array, start: number): number {
  const view = new DataView(data.buffer);
  view.setInt32(start, 2, true);
  view.setInt32(start + 16, 1, true);
  view.setFloat32(start + 28, 1, true);
  view.setInt32(start + 32, 3, true);
  view.setFloat32(start + 48, 2, true);
  view.setFloat32(start + 64, 3, true);
  view.setInt32(start + 72, 1, true);
  view.setUint16(start + 78, 1, true);
  view.setUint16(start + 80, 2, true);
  view.setInt32(start + 82, 1, true);
  data[start + 86] = 7;
  return start + 87;
}

function identityTransform(): RevitTransform3d {
  return {
    byteOffset: 0,
    endOffset: 96,
    xAxis: [1, 0, 0],
    yAxis: [0, 1, 0],
    zAxis: [0, 0, 1],
    origin: [0, 0, 0],
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  };
}

function exactQueueState(
  collectionEndOffset: number,
  replayOffset: number,
  propertyToken = 91,
): DynamicQueueReplayCertificate {
  const registry = new SurrogateObjectPropertyRegistry();
  assert.equal(
    registry.registerObject({
      identity: "outer-object:1/gpolymesh:1",
      sourceClassSlot: REVIT_2026_GPOLYMESH_SOURCE_CLASS,
      parentIdentity: null,
    }).ok,
    true,
  );
  assert.equal(
    registry.registerClassProperty({
      identity: "OdBmGPolyMesh.m_pFacetedTopology",
      declaringSourceClassSlot: REVIT_2026_GPOLYMESH_SOURCE_CLASS,
      name: "m_pFacetedTopology",
    }).ok,
    true,
  );
  assert.equal(
    registry.enqueueDynamicProperty({
      dataKey: {
        objectIdentity: "outer-object:1/gpolymesh:1",
        classPropertyIdentity: "OdBmGPolyMesh.m_pFacetedTopology",
        sequenceIndex: -1,
      },
      propertyToken,
      propertySourceClassSlot:
        REVIT_COMMON_FACETED_TOPOLOGY8_SOURCE_CLASS,
      collectionEndOffset,
    }).ok,
    true,
  );
  assert.equal(
    registry.sealOuterStaticTraversal(
      "outer-object:1/gpolymesh:1",
      replayOffset,
    ).ok,
    true,
  );
  assert.equal(registry.initializeReferences().ok, true);
  const certified = registry.certifySinglePropertyReplay(replayOffset);
  assert.equal(certified.ok, true);
  return certified.value;
}

test("decodes CondInt16 collection tokens and conditional class slots", () => {
  const data = new Uint8Array(22);
  const view = new DataView(data.buffer);
  view.setInt32(2, 3, true);
  view.setInt32(6, 41, true);
  view.setInt16(10, 2248, true);
  view.setInt32(12, 0, true);
  view.setInt32(16, 42, true);
  view.setInt16(20, 2215, true);

  const result = decodeCondInt16QueueCollection(data, 2);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.collection.endOffset, 22);
  assert.deepEqual(
    result.collection.entries.map(({ token, sourceClassSlot }) => ({
      token,
      sourceClassSlot,
    })),
    [
      { token: 41, sourceClassSlot: 2248 },
      { token: 0, sourceClassSlot: null },
      { token: 42, sourceClassSlot: 2215 },
    ],
  );
});

test("locates only a unique collection ending at the supplied boundary", () => {
  const data = new Uint8Array(24);
  const view = new DataView(data.buffer);
  view.setInt32(4, 2, true);
  view.setInt32(8, 62, true);
  view.setInt16(12, 2248, true);
  view.setInt32(14, 63, true);
  view.setInt16(18, 2215, true);

  const result = locateCondInt16QueueEndingAt(data, 20);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.collection.countOffset, 4);
  assert.equal(result.collection.count, 2);
});

test("binding rejects a multi-entry GStyle/GFlipControl replay collision", () => {
  const data = new Uint8Array(120);
  const view = new DataView(data.buffer);
  view.setInt32(0, 2, true);
  view.setInt32(4, 62, true);
  view.setInt16(8, 2248, true);
  view.setInt32(10, 63, true);
  view.setInt16(14, 2215, true);
  writeTopology8(data, 16);

  const result = bindQueuedFacetedTopology8(data, {
    gPolyMeshSourceClassSlot: REVIT_2026_GPOLYMESH_SOURCE_CLASS,
    topologyPropertyToken: 62,
    topologySourceClassSlot: REVIT_COMMON_FACETED_TOPOLOGY8_SOURCE_CLASS,
    dynamicQueueState: exactQueueState(16, 16, 62),
    ownerElementId: 1n,
    styleElementId: 2n,
    materialElementId: 3n,
    polyMeshFlags: 0,
    transform: identityTransform(),
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /multi-entry DynamicQueue/);
    assert.equal(result.queue?.entries[0]?.sourceClassSlot, 2248);
  }
});

test("binding accepts exact outer state even when static fields follow the collection", () => {
  const data = new Uint8Array(104);
  const view = new DataView(data.buffer);
  view.setInt32(0, 1, true);
  view.setInt32(4, 91, true);
  view.setInt16(8, REVIT_COMMON_FACETED_TOPOLOGY8_SOURCE_CLASS, true);
  view.setInt32(10, 0x12345678, true);
  const endOffset = writeTopology8(data, 14);

  const dynamicQueueState = exactQueueState(10, 14);
  const evidence = {
    gPolyMeshSourceClassSlot: REVIT_2026_GPOLYMESH_SOURCE_CLASS,
    topologyPropertyToken: 91,
    topologySourceClassSlot: REVIT_COMMON_FACETED_TOPOLOGY8_SOURCE_CLASS,
    dynamicQueueState,
    ownerElementId: 101n,
    styleElementId: 102n,
    materialElementId: 103n,
    polyMeshFlags: 4,
    transform: identityTransform(),
  };
  const result = bindQueuedFacetedTopology8(data, evidence);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.binding.topology.endOffset, endOffset);
  assert.equal(result.binding.ownerElementId, 101n);
  assert.equal(result.binding.styleElementId, 102n);
  assert.equal(result.binding.materialElementId, 103n);
  const reused = bindQueuedFacetedTopology8(data, evidence);
  assert.equal(reused.ok, false);
  if (!reused.ok) assert.match(reused.error, /already consumed/);
});

test("binding rejects a replay certificate not issued by the registry", () => {
  const data = new Uint8Array(104);
  const view = new DataView(data.buffer);
  view.setInt32(0, 1, true);
  view.setInt32(4, 91, true);
  view.setInt16(8, REVIT_COMMON_FACETED_TOPOLOGY8_SOURCE_CLASS, true);
  writeTopology8(data, 14);

  const result = bindQueuedFacetedTopology8(data, {
    gPolyMeshSourceClassSlot: REVIT_2026_GPOLYMESH_SOURCE_CLASS,
    topologyPropertyToken: 91,
    topologySourceClassSlot: REVIT_COMMON_FACETED_TOPOLOGY8_SOURCE_CLASS,
    dynamicQueueState: {
      collectionEndOffset: 10,
      outerStaticEndOffset: 14,
      replayOffset: 14,
      objectIdentity: "outer-object:1/gpolymesh:1",
      objectSourceClassSlot: REVIT_2026_GPOLYMESH_SOURCE_CLASS,
      classPropertyIdentity: "OdBmGPolyMesh.m_pFacetedTopology",
      declaringSourceClassSlot: REVIT_2026_GPOLYMESH_SOURCE_CLASS,
      sequenceIndex: -1,
      propertyToken: 91,
      propertySourceClassSlot:
        REVIT_COMMON_FACETED_TOPOLOGY8_SOURCE_CLASS,
      retainedValueCount: 0,
      nextUnreadEntryIndex: 0,
      queueLength: 1,
    } as DynamicQueueReplayCertificate,
    ownerElementId: 101n,
    styleElementId: 102n,
    materialElementId: 103n,
    polyMeshFlags: 4,
    transform: identityTransform(),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /was not issued by the registry/);
});

test("decodes Trf201120260 axes and origin to a column-major matrix", () => {
  const data = new Uint8Array(104);
  const view = new DataView(data.buffer);
  const values = [1, 0, 0, 0, 2, 0, 0, 0, 3, 10, 20, 30];
  values.forEach((value, index) => view.setFloat64(8 + index * 8, value, true));
  const result = decodeTrf201120260(data, 8);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.transform.origin, [10, 20, 30]);
  assert.deepEqual(result.transform.matrix, [
    1, 0, 0, 0,
    0, 2, 0, 0,
    0, 0, 3, 0,
    10, 20, 30, 1,
  ]);
});
