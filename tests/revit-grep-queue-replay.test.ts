import assert from "node:assert/strict";
import test from "node:test";

import type { ElementObject } from "../lib/reviter/element-objects.ts";
import {
  certifyRevitGRepInitialQueue,
  GREP_ALL_SUBNODES_PROPERTY,
  isRevitGRepQueueReplayCertificate,
  replayRevitGRepInitialLeafQueue,
  type RevitGRepChildReader,
} from "../lib/reviter/revit-grep-queue-replay.ts";
import { REVIT_2026_GELEMENT_OBJECT_MARKER } from "../lib/reviter/revit-2026-grep-root.ts";

function queueFrame(
  slots: readonly number[] = [2215, 2248],
  payloadBytes = 12,
): { data: Uint8Array; frame: ElementObject; payloadOffset: number } {
  const staticBytes = 18 + 20 + 4 + slots.length * 6 + 96 + 16;
  const objectLength = staticBytes + payloadBytes;
  const data = new Uint8Array(objectLength + 20);
  const view = new DataView(data.buffer);
  const elementId = 400_237;
  view.setBigUint64(0, BigInt(elementId), true);
  view.setUint32(12, objectLength, true);
  view.setUint16(16, REVIT_2026_GELEMENT_OBJECT_MARKER, true);
  view.setInt32(38, slots.length, true);
  let offset = 42;
  slots.forEach((slot, index) => {
    view.setInt32(offset, index + 3, true);
    view.setInt16(offset + 4, slot, true);
    offset += 6;
  });
  offset += 96;
  view.setBigInt64(offset, BigInt(elementId), true);
  offset += 8;
  view.setInt32(offset, 2, true);
  offset += 4;
  view.setUint32(offset, 0, true);
  offset += 4;
  assert.equal(offset, staticBytes);
  view.setUint32(objectLength + 16, objectLength, true);
  return {
    data,
    frame: {
      offset: 0,
      elementId,
      objectLength,
      marker: REVIT_2026_GELEMENT_OBJECT_MARKER,
      typeCode: 0,
    },
    payloadOffset: staticBytes,
  };
}

test("certifies and replays an append-only multi-property GRep leaf FIFO", () => {
  const { data, frame, payloadOffset } = queueFrame();
  const planned = certifyRevitGRepInitialQueue(data, frame);
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.equal(planned.value.replayOffset, payloadOffset);
  assert.equal(planned.value.entries.length, 2);
  assert.deepEqual(
    planned.value.entries.map((entry) => ({
      queueIndex: entry.queueIndex,
      token: entry.propertyToken,
      slot: entry.propertySourceClassSlot,
      key: entry.dataKey,
    })),
    [
      {
        queueIndex: 0,
        token: 3,
        slot: 2215,
        key: {
          objectIdentity: "revit-grep:400237",
          classPropertyIdentity: GREP_ALL_SUBNODES_PROPERTY,
          sequenceIndex: 0,
        },
      },
      {
        queueIndex: 1,
        token: 4,
        slot: 2248,
        key: {
          objectIdentity: "revit-grep:400237",
          classPropertyIdentity: GREP_ALL_SUBNODES_PROPERTY,
          sequenceIndex: 1,
        },
      },
    ],
  );

  const calls: number[] = [];
  const first: RevitGRepChildReader = (_data, context) => {
    calls.push(context.scopedSourceClassSlot);
    assert.equal(context.byteOffset, payloadOffset);
    assert.equal(context.propertyToken, 3);
    return {
      ok: true,
      endOffset: context.byteOffset + 5,
      queuedPropertyCount: 0,
      value: "flip",
    };
  };
  const second: RevitGRepChildReader = (_data, context) => {
    calls.push(context.scopedSourceClassSlot);
    assert.equal(context.byteOffset, payloadOffset + 5);
    assert.equal(context.propertyToken, 4);
    return {
      ok: true,
      endOffset: context.replayEndOffset,
      queuedPropertyCount: 0,
      value: "style",
    };
  };
  const replayed = replayRevitGRepInitialLeafQueue(
    data,
    planned.value,
    new Map([
      [2215, first],
      [2248, second],
    ]),
  );
  assert.equal(replayed.ok, true);
  if (!replayed.ok) return;
  assert.deepEqual(calls, [2215, 2248]);
  assert.equal(isRevitGRepQueueReplayCertificate(replayed.value), true);
  assert.equal(replayed.value.initialTokenCount, 3);
  assert.equal(replayed.value.finalTokenCount, 5);
  assert.deepEqual(
    replayed.value.spans.map((span) => [
      span.propertyToken,
      span.startOffset,
      span.endOffset,
      span.value,
    ]),
    [
      [3, payloadOffset, payloadOffset + 5, "flip"],
      [4, payloadOffset + 5, payloadOffset + 12, "style"],
    ],
  );

  const reused = replayRevitGRepInitialLeafQueue(
    data,
    planned.value,
    new Map(),
  );
  assert.equal(reused.ok, false);
  if (!reused.ok) assert.match(reused.error, /single-use/);
});

test("rejects sparse or reused object tokens before replay", () => {
  const { data, frame, payloadOffset } = queueFrame();
  new DataView(data.buffer).setInt32(48, 6, true);
  const result = certifyRevitGRepInitialQueue(data, frame);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /not append-only index 4/);
  assert.equal(payloadOffset > 0, true);
});

test("fails closed on missing readers and nested dynamic properties", () => {
  const missingFixture = queueFrame([2215], 4);
  const missingPlan = certifyRevitGRepInitialQueue(
    missingFixture.data,
    missingFixture.frame,
  );
  assert.equal(missingPlan.ok, true);
  if (!missingPlan.ok) return;
  const missing = replayRevitGRepInitialLeafQueue(
    missingFixture.data,
    missingPlan.value,
    new Map(),
  );
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /no proven leaf reader/);

  const nestedFixture = queueFrame([2215], 4);
  const nestedPlan = certifyRevitGRepInitialQueue(
    nestedFixture.data,
    nestedFixture.frame,
  );
  assert.equal(nestedPlan.ok, true);
  if (!nestedPlan.ok) return;
  const nested = replayRevitGRepInitialLeafQueue(
    nestedFixture.data,
    nestedPlan.value,
    new Map([
      [
        2215,
        (_data, context) =>
          ({
            ok: true,
            endOffset: context.replayEndOffset,
            queuedPropertyCount: 1,
          }),
      ],
    ]),
  );
  assert.equal(nested.ok, false);
  if (!nested.ok) assert.match(nested.error, /general FIFO replay path/);
});

test("requires monotonic and complete stream advancement", () => {
  const stalledFixture = queueFrame([2215], 4);
  const stalledPlan = certifyRevitGRepInitialQueue(
    stalledFixture.data,
    stalledFixture.frame,
  );
  assert.equal(stalledPlan.ok, true);
  if (!stalledPlan.ok) return;
  const stalled = replayRevitGRepInitialLeafQueue(
    stalledFixture.data,
    stalledPlan.value,
    new Map([
      [
        2215,
        (_data, context) => ({
          ok: true,
          endOffset: context.byteOffset,
          queuedPropertyCount: 0,
        }),
      ],
    ]),
  );
  assert.equal(stalled.ok, false);
  if (!stalled.ok) assert.match(stalled.error, /invalid stream advancement/);

  const shortFixture = queueFrame([2215], 4);
  const shortPlan = certifyRevitGRepInitialQueue(
    shortFixture.data,
    shortFixture.frame,
  );
  assert.equal(shortPlan.ok, true);
  if (!shortPlan.ok) return;
  const short = replayRevitGRepInitialLeafQueue(
    shortFixture.data,
    shortPlan.value,
    new Map([
      [
        2215,
        (_data, context) => ({
          ok: true,
          endOffset: context.byteOffset + 2,
          queuedPropertyCount: 0,
        }),
      ],
    ]),
  );
  assert.equal(short.ok, false);
  if (!short.ok) assert.match(short.error, /complete GRep dynamic payload/);
});

test("rejects a structurally similar plan not issued for the byte buffer", () => {
  const { data, frame } = queueFrame([2215], 4);
  const planned = certifyRevitGRepInitialQueue(data, frame);
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  const forged = { ...planned.value };
  const result = replayRevitGRepInitialLeafQueue(
    data,
    forged,
    new Map(),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /was not issued/);
});
