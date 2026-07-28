import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveHostRelations,
  scanHostRelationCandidates,
} from "../lib/reviter/host-relations.ts";

function instance(
  elementId: number,
  objectLength: number,
  fields: Array<[151 | 153, number]>,
): Uint8Array {
  const data = new Uint8Array(objectLength + 20);
  const view = new DataView(data.buffer);
  view.setUint32(0, elementId, true);
  view.setUint32(12, objectLength, true);
  view.setUint16(16, 0x07ef, true);
  for (const [offset, id] of fields) view.setUint32(offset, id, true);
  view.setUint32(objectLength + 16, objectLength, true);
  return data;
}

test("resolves the primary persisted InsertableInst host id", () => {
  const scan = scanHostRelationCandidates(instance(293_248, 537, [[151, 2_486_677]]), 2027);
  assert.deepEqual(
    resolveHostRelations(scan, new Set([293_248, 2_486_677]))
      .map(({ elementId, hostId, fieldOffset, kind, evidence }) => ({
        elementId,
        hostId,
        fieldOffset,
        kind,
        evidence,
      })),
    [{
      elementId: 293_248,
      hostId: 2_486_677,
      fieldOffset: 151,
      kind: "host",
      evidence: "persisted",
    }],
  );
});

test("uses the alternate field only when the overlapping primary does not resolve", () => {
  const scan = scanHostRelationCandidates(
    instance(717_383, 551, [[151, 99_999_999], [153, 401_851]]),
    2027,
  );
  assert.equal(resolveHostRelations(scan, new Set([717_383, 401_851]))[0]?.hostId, 401_851);

  const bothResolve = [
    {
      elementId: 7,
      hostId: 8,
      fieldOffset: 151 as const,
      recordOffset: 0,
      objectLength: 551,
      objectMarker: 0x07ef as const,
    },
    {
      elementId: 7,
      hostId: 9,
      fieldOffset: 153 as const,
      recordOffset: 0,
      objectLength: 551,
      objectMarker: 0x07ef as const,
    },
  ];
  assert.equal(resolveHostRelations(bothResolve, new Set([7, 8, 9]))[0]?.hostId, 8);
});

test("requires the 2027 class marker, length echo, and a framed target", () => {
  const data = instance(7, 551, [[151, 8]]);
  assert.deepEqual(scanHostRelationCandidates(data, 2026), []);
  new DataView(data.buffer).setUint16(16, 0x08c6, true);
  assert.deepEqual(scanHostRelationCandidates(data, 2027), []);
  new DataView(data.buffer).setUint16(16, 0x07ef, true);
  new DataView(data.buffer).setUint32(567, 550, true);
  assert.deepEqual(scanHostRelationCandidates(data, 2027), []);

  const valid = instance(7, 551, [[151, 8]]);
  assert.deepEqual(resolveHostRelations(
    scanHostRelationCandidates(valid, 2027),
    new Set([7]),
  ), []);
});
