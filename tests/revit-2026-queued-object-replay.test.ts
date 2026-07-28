import assert from "node:assert/strict";
import test from "node:test";

import {
  claimDynamicQueueReplaySpan,
  SurrogateObjectPropertyRegistry,
  type DynamicQueueReplayCertificate,
} from "../lib/reviter/dynamic-object-registry.ts";
import { replayCertifiedRevit2026QueuedGPolyMesh } from "../lib/reviter/revit-2026-queued-object-replay.ts";

const GPOLY_SLOT = 2237;
const TOPOLOGY_SLOT = 5255;
const PARENT_ID = "outer-grep:1";
const PARENT_PROPERTY = "OdBmGGroup.children[0]";

function queuedGPolyBytes(options: {
  parentToken?: number;
  parentSlot?: number;
  topologyToken?: number;
} = {}): Uint8Array {
  const parentToken = options.parentToken ?? 7;
  const parentSlot = options.parentSlot ?? GPOLY_SLOT;
  const topologyToken = options.topologyToken ?? 91;
  const replayOffset = 12;
  const topologySlotBytes = topologyToken === 0 ? 0 : 2;
  const data = new Uint8Array(replayOffset + 24 + topologySlotBytes + 20);
  const view = new DataView(data.buffer);
  view.setInt32(0, parentToken, true);
  view.setInt16(4, parentSlot, true);

  view.setBigUint64(replayOffset, 1001n, true);
  view.setInt32(replayOffset + 8, 17, true);
  view.setInt32(replayOffset + 12, -4, true);
  view.setUint32(replayOffset + 16, 0x80000001, true);
  view.setInt32(replayOffset + 20, topologyToken, true);
  let offset = replayOffset + 24;
  if (topologyToken !== 0) {
    view.setInt16(offset, TOPOLOGY_SLOT, true);
    offset += 2;
  }
  view.setBigUint64(offset, 2002n, true);
  view.setBigUint64(offset + 8, 3003n, true);
  view.setInt32(offset + 16, -7, true);
  return data;
}

function parentCertificate(
  data: Uint8Array,
  options: { propertySlot?: number; propertyToken?: number } = {},
): DynamicQueueReplayCertificate {
  const registry = new SurrogateObjectPropertyRegistry();
  assert.equal(
    registry.registerObject({
      identity: PARENT_ID,
      sourceClassSlot: 2207,
      parentIdentity: null,
    }).ok,
    true,
  );
  assert.equal(
    registry.registerClassProperty({
      identity: PARENT_PROPERTY,
      declaringSourceClassSlot: 2208,
      name: "m_children",
    }).ok,
    true,
  );
  assert.equal(
    registry.enqueueDynamicProperty({
      dataKey: {
        objectIdentity: PARENT_ID,
        classPropertyIdentity: PARENT_PROPERTY,
        sequenceIndex: -1,
      },
      propertyToken: options.propertyToken ?? 7,
      propertySourceClassSlot: options.propertySlot ?? GPOLY_SLOT,
      descriptorOffset: 0,
      descriptorEndOffset: 6,
    }).ok,
    true,
  );
  assert.equal(registry.sealOuterStaticTraversal(PARENT_ID, 12).ok, true);
  assert.equal(registry.initializeReferences().ok, true);
  const certified = registry.certifySinglePropertyReplay(12);
  assert.equal(certified.ok, true);
  assert.equal(data.byteLength >= certified.value.replayOffset, true);
  return certified.value;
}

test("replays a certified parent GPolyMesh with scoped class and certifies its topology", () => {
  const data = queuedGPolyBytes();
  const outerCertificate = parentCertificate(data);
  const result = replayCertifiedRevit2026QueuedGPolyMesh(
    data,
    outerCertificate,
    "outer-grep:1/gpoly:7",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.parentObjectIdentity, PARENT_ID);
  assert.equal(result.value.propertyDescriptor.token, 7);
  assert.equal(result.value.propertyDescriptor.sourceClassSlot, GPOLY_SLOT);
  assert.equal(result.value.dispatch.selectorReadFromStream, false);
  assert.equal(result.value.dispatch.bodyOffset, 12);
  assert.deepEqual(result.value.outerReplaySpan, {
    startOffset: 12,
    endOffset: data.byteLength,
  });

  const topologyCertificate = result.value.topologyReplayCertificate;
  assert.notEqual(topologyCertificate, null);
  if (!topologyCertificate) return;
  assert.equal(topologyCertificate.objectSourceClassSlot, GPOLY_SLOT);
  assert.equal(topologyCertificate.propertySourceClassSlot, TOPOLOGY_SLOT);
  assert.equal(topologyCertificate.descriptorOffset, 32);
  assert.equal(topologyCertificate.descriptorEndOffset, 38);
  assert.equal(topologyCertificate.replayOffset, data.byteLength);

  const reused = claimDynamicQueueReplaySpan(
    outerCertificate,
    outerCertificate.replayOffset,
    data.byteLength,
  );
  assert.equal(reused.ok, false);
  if (!reused.ok) assert.match(reused.error, /already consumed/);
});

test("preserves a null nested topology without minting a second certificate", () => {
  const data = queuedGPolyBytes({ topologyToken: 0 });
  const result = replayCertifiedRevit2026QueuedGPolyMesh(
    data,
    parentCertificate(data),
    "outer-grep:1/gpoly:7",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.dispatch.value.topologySourceClassSlot, null);
  assert.equal(result.value.topologyReplayCertificate, null);
});

test("rejects a parent certificate whose dynamic class is not GPolyMesh", () => {
  const data = queuedGPolyBytes();
  const result = replayCertifiedRevit2026QueuedGPolyMesh(
    data,
    parentCertificate(data, { propertySlot: 2215 }),
    "outer-grep:1/gpoly:7",
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /is not a Revit 2026 GPolyMesh/);
});

test("rejects a certified descriptor that does not match the stream", () => {
  const data = queuedGPolyBytes({ parentToken: 8 });
  const result = replayCertifiedRevit2026QueuedGPolyMesh(
    data,
    parentCertificate(data),
    "outer-grep:1/gpoly:7",
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /does not match the stream/);
});
