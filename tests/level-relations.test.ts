import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAssociatedLevelRelations,
  REVIT_2027_LEVEL_MARKER,
  scanAssociatedLevelRelationCandidates,
  type AssociatedLevelFieldOffset,
} from "../lib/reviter/level-relations.ts";

function framedElement(
  elementId: number,
  objectLength: number,
  fields: Array<[AssociatedLevelFieldOffset, number]>,
  marker = 0x0f3b,
): Uint8Array {
  const data = new Uint8Array(objectLength + 20);
  const view = new DataView(data.buffer);
  view.setUint32(0, elementId, true);
  view.setUint32(12, objectLength, true);
  view.setUint16(16, marker, true);
  for (const [offset, id] of fields) view.setUint32(offset, id, true);
  view.setUint32(objectLength + 16, objectLength, true);
  return data;
}

test("resolves every persisted Element.m_assocLevelId layout", () => {
  const markerByElement = new Map([[900, REVIT_2027_LEVEL_MARKER]]);
  for (const fieldOffset of [64, 66, 68, 70, 72] as const) {
    const scan = scanAssociatedLevelRelationCandidates(
      framedElement(100 + fieldOffset, 120, [[fieldOffset, 900]]),
      2027,
    );
    assert.deepEqual(
      resolveAssociatedLevelRelations(scan, markerByElement).map(
        ({ elementId, levelId, fieldOffset: resolvedOffset, kind, evidence }) => ({
          elementId,
          levelId,
          fieldOffset: resolvedOffset,
          kind,
          evidence,
        }),
      ),
      [{
        elementId: 100 + fieldOffset,
        levelId: 900,
        fieldOffset,
        kind: "associated-level",
        evidence: "persisted",
      }],
    );
  }
});

test("requires the 2027 format, framing echo, and Level target marker", () => {
  const data = framedElement(7, 120, [[70, 8]]);
  assert.deepEqual(scanAssociatedLevelRelationCandidates(data, 2026), []);

  new DataView(data.buffer).setUint32(136, 119, true);
  assert.deepEqual(scanAssociatedLevelRelationCandidates(data, 2027), []);

  const valid = scanAssociatedLevelRelationCandidates(
    framedElement(7, 120, [[70, 8]]),
    2027,
  );
  assert.deepEqual(resolveAssociatedLevelRelations(valid, new Map([[8, 0x0a18]])), []);
  assert.equal(
    resolveAssociatedLevelRelations(valid, new Map([[8, REVIT_2027_LEVEL_MARKER]]))[0]
      ?.levelId,
    8,
  );
});

test("deduplicates repeated records and fails closed on conflicting Level targets", () => {
  const first = scanAssociatedLevelRelationCandidates(
    framedElement(7, 120, [[66, 8]]),
    2027,
  );
  const second = scanAssociatedLevelRelationCandidates(
    framedElement(7, 120, [[70, 9]]),
    2027,
  );
  const markers = new Map([
    [8, REVIT_2027_LEVEL_MARKER],
    [9, REVIT_2027_LEVEL_MARKER],
  ]);
  assert.equal(resolveAssociatedLevelRelations([...first, ...first], markers).length, 1);
  assert.deepEqual(resolveAssociatedLevelRelations([...first, ...second], markers), []);
});
