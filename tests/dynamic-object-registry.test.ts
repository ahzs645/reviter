import assert from "node:assert/strict";
import test from "node:test";

import {
  claimDynamicQueueReplaySpan,
  isDynamicQueueReplayCertificate,
  SurrogateObjectPropertyRegistry,
} from "../lib/reviter/dynamic-object-registry.ts";

const GPOLYMESH_SLOT = 2237;
const TOPOLOGY_SLOT = 5255;
const OBJECT_ID = "outer:0/gpoly:0";
const PROPERTY_ID = "OdBmGPolyMesh.m_pFacetedTopology";

function registerTopologyIdentity(
  registry: SurrogateObjectPropertyRegistry,
): void {
  assert.deepEqual(
    registry.registerObject({
      identity: OBJECT_ID,
      sourceClassSlot: GPOLYMESH_SLOT,
      parentIdentity: null,
    }),
    { ok: true, value: undefined },
  );
  assert.deepEqual(
    registry.registerClassProperty({
      identity: PROPERTY_ID,
      declaringSourceClassSlot: GPOLYMESH_SLOT,
      name: "m_pFacetedTopology",
    }),
    { ok: true, value: undefined },
  );
}

function queueTopology(
  registry: SurrogateObjectPropertyRegistry,
  sequenceIndex = -1,
): void {
  assert.deepEqual(
    registry.enqueueDynamicProperty({
      dataKey: {
        objectIdentity: OBJECT_ID,
        classPropertyIdentity: PROPERTY_ID,
        sequenceIndex,
      },
      propertyToken: 91,
      propertySourceClassSlot: TOPOLOGY_SLOT,
      collectionEndOffset: 40,
    }),
    { ok: true, value: undefined },
  );
}

test("certifies one exact property only after static sealing and reference initialization", () => {
  const registry = new SurrogateObjectPropertyRegistry();
  registerTopologyIdentity(registry);
  queueTopology(registry);

  assert.equal(registry.certifySinglePropertyReplay(96).ok, false);
  assert.deepEqual(registry.sealOuterStaticTraversal(OBJECT_ID, 96), {
    ok: true,
    value: undefined,
  });
  assert.equal(registry.certifySinglePropertyReplay(96).ok, false);
  assert.deepEqual(registry.initializeReferences(), {
    ok: true,
    value: undefined,
  });
  const result = registry.certifySinglePropertyReplay(96);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(isDynamicQueueReplayCertificate(result.value), true);
  assert.equal(result.value.collectionEndOffset, 40);
  assert.equal(result.value.outerStaticEndOffset, 96);
  assert.equal(result.value.replayOffset, 96);
  assert.equal(result.value.objectIdentity, OBJECT_ID);
  assert.equal(result.value.objectSourceClassSlot, GPOLYMESH_SLOT);
  assert.equal(result.value.classPropertyIdentity, PROPERTY_ID);
  assert.equal(result.value.declaringSourceClassSlot, GPOLYMESH_SLOT);
  assert.equal(result.value.propertyToken, 91);
  assert.equal(result.value.propertySourceClassSlot, TOPOLOGY_SLOT);
  assert.equal(result.value.sequenceIndex, -1);
  assert.equal(registry.phase, "replay-certified");
  const wrongSpan = claimDynamicQueueReplaySpan(result.value, 40, 120);
  assert.equal(wrongSpan.ok, false);
  if (!wrongSpan.ok) assert.match(wrongSpan.error, /certified replay offset/);
  assert.deepEqual(claimDynamicQueueReplaySpan(result.value, 96, 120), {
    ok: true,
    value: { startOffset: 96, endOffset: 120 },
  });
  const reused = claimDynamicQueueReplaySpan(result.value, 96, 140);
  assert.equal(reused.ok, false);
  if (!reused.ok) assert.match(reused.error, /already consumed/);
});

test("rejects unknown object/property identities and duplicate identities", () => {
  const registry = new SurrogateObjectPropertyRegistry();
  const missing = registry.enqueueDynamicProperty({
    dataKey: {
      objectIdentity: OBJECT_ID,
      classPropertyIdentity: PROPERTY_ID,
      sequenceIndex: -1,
    },
    propertyToken: 91,
    propertySourceClassSlot: TOPOLOGY_SLOT,
    collectionEndOffset: 40,
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /unregistered object/);

  registerTopologyIdentity(registry);
  const duplicateObject = registry.registerObject({
    identity: OBJECT_ID,
    sourceClassSlot: GPOLYMESH_SLOT,
    parentIdentity: null,
  });
  assert.equal(duplicateObject.ok, false);
  if (!duplicateObject.ok) assert.match(duplicateObject.error, /already registered/);
  const duplicateProperty = registry.registerClassProperty({
    identity: PROPERTY_ID,
    declaringSourceClassSlot: GPOLYMESH_SLOT,
    name: "m_pFacetedTopology",
  });
  assert.equal(duplicateProperty.ok, false);
  if (!duplicateProperty.ok) {
    assert.match(duplicateProperty.error, /already registered/);
  }
});

test("fails reference initialization when a parent surrogate is unresolved", () => {
  const registry = new SurrogateObjectPropertyRegistry();
  assert.equal(
    registry.registerObject({
      identity: OBJECT_ID,
      sourceClassSlot: GPOLYMESH_SLOT,
      parentIdentity: "outer:0",
    }).ok,
    true,
  );
  assert.equal(
    registry.registerClassProperty({
      identity: PROPERTY_ID,
      declaringSourceClassSlot: GPOLYMESH_SLOT,
      name: "m_pFacetedTopology",
    }).ok,
    true,
  );
  queueTopology(registry);
  assert.equal(registry.sealOuterStaticTraversal(OBJECT_ID, 96).ok, true);
  const result = registry.initializeReferences();
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /unresolved parent identity/);
});

test("fails closed on retained values, multiple queue entries, and sequences", () => {
  const retained = new SurrogateObjectPropertyRegistry();
  registerTopologyIdentity(retained);
  queueTopology(retained);
  assert.equal(
    retained.noteRetainedValue({
      objectIdentity: OBJECT_ID,
      classPropertyIdentity: PROPERTY_ID,
      sequenceIndex: -1,
    }).ok,
    true,
  );
  assert.equal(retained.sealOuterStaticTraversal(OBJECT_ID, 96).ok, true);
  assert.equal(retained.initializeReferences().ok, true);
  const retainedResult = retained.certifySinglePropertyReplay(96);
  assert.equal(retainedResult.ok, false);
  if (!retainedResult.ok) assert.match(retainedResult.error, /merge semantics/);

  const multiple = new SurrogateObjectPropertyRegistry();
  registerTopologyIdentity(multiple);
  queueTopology(multiple);
  queueTopology(multiple);
  assert.equal(multiple.sealOuterStaticTraversal(OBJECT_ID, 96).ok, true);
  assert.equal(multiple.initializeReferences().ok, true);
  const multipleResult = multiple.certifySinglePropertyReplay(96);
  assert.equal(multipleResult.ok, false);
  if (!multipleResult.ok) assert.match(multipleResult.error, /single globally queued/);

  const sequence = new SurrogateObjectPropertyRegistry();
  registerTopologyIdentity(sequence);
  queueTopology(sequence, 0);
  assert.equal(sequence.sealOuterStaticTraversal(OBJECT_ID, 96).ok, true);
  assert.equal(sequence.initializeReferences().ok, true);
  const sequenceResult = sequence.certifySinglePropertyReplay(96);
  assert.equal(sequenceResult.ok, false);
  if (!sequenceResult.ok) assert.match(sequenceResult.error, /sequence replay/);
});

test("rejects a replay offset different from the complete outer static end", () => {
  const registry = new SurrogateObjectPropertyRegistry();
  registerTopologyIdentity(registry);
  queueTopology(registry);
  assert.equal(registry.sealOuterStaticTraversal(OBJECT_ID, 96).ok, true);
  assert.equal(registry.initializeReferences().ok, true);
  const result = registry.certifySinglePropertyReplay(40);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /sealed outer static boundary/);
});

test("issued-certificate check rejects structurally identical plain objects", () => {
  assert.equal(
    isDynamicQueueReplayCertificate({
      collectionEndOffset: 40,
      outerStaticEndOffset: 96,
      replayOffset: 96,
      objectIdentity: OBJECT_ID,
      objectSourceClassSlot: GPOLYMESH_SLOT,
      classPropertyIdentity: PROPERTY_ID,
      declaringSourceClassSlot: GPOLYMESH_SLOT,
      sequenceIndex: -1,
      propertyToken: 91,
      propertySourceClassSlot: TOPOLOGY_SLOT,
      retainedValueCount: 0,
      nextUnreadEntryIndex: 0,
      queueLength: 1,
    }),
    false,
  );
});
