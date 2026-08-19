import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAssociatedLevelRelations,
  REVIT_2027_LEVEL_MARKER,
  scanAssociatedLevelRelationCandidates,
  type AssociatedLevelFieldOffset,
} from "../lib/reviter/level-relations.ts";

/** Smallest offset `m_assocLevelId` can take: every pointer before it null. */
const NARROWEST_FIELD_OFFSET = 62;

/**
 * One framed element whose `m_assocLevelId` lands at `fieldOffset`.
 *
 * The offset is not free: it is `62 + 2n` where `n` of the seven pointers
 * `Element` declares before the field are live, since a live pointer carries a
 * class index and a null one does not. The fixture writes exactly that many.
 */
function framedElement(
  elementId: number,
  objectLength: number,
  fieldOffset: AssociatedLevelFieldOffset,
  levelId: number,
  marker = 0x0f3b,
): Uint8Array {
  const data = new Uint8Array(objectLength + 20);
  const view = new DataView(data.buffer);
  view.setUint32(0, elementId, true);
  view.setUint32(12, objectLength, true);
  view.setUint16(16, marker, true);

  const live = (fieldOffset - NARROWEST_FIELD_OFFSET) / 2;
  let cursor = 18;
  for (let pointer = 0; pointer < 6; pointer += 1) {
    if (pointer < live) {
      view.setInt32(cursor, -1, true);
      view.setUint16(cursor + 4, 0x0c93, true);
      cursor += 6;
    } else cursor += 4;
  }
  // `m_constrInfo`, an empty collection.
  view.setUint32(cursor, 0, true);
  cursor += 4;
  // `m_cellList`, live only when a seventh pointer is needed to reach the offset.
  if (live > 6) {
    view.setInt32(cursor, -1, true);
    view.setUint16(cursor + 4, 0x0310, true);
    cursor += 6;
  } else cursor += 4;
  // `m_docAccess.m_pDoc` and `m_id`, then the field itself.
  cursor += 12;
  assert.equal(cursor, fieldOffset, "fixture did not reach the intended offset");
  view.setUint32(fieldOffset, levelId, true);
  view.setUint32(objectLength + 16, objectLength, true);
  return data;
}

test("resolves every persisted Element.m_assocLevelId layout", () => {
  const markerByElement = new Map([[900, REVIT_2027_LEVEL_MARKER]]);
  for (const fieldOffset of [62, 64, 66, 68, 70, 72, 74, 76] as const) {
    const scan = scanAssociatedLevelRelationCandidates(
      framedElement(100 + fieldOffset, 120, fieldOffset, 900),
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
  const data = framedElement(7, 120, 70, 8);
  assert.deepEqual(scanAssociatedLevelRelationCandidates(data, 2026), []);

  new DataView(data.buffer).setUint32(136, 119, true);
  assert.deepEqual(scanAssociatedLevelRelationCandidates(data, 2027), []);

  const valid = scanAssociatedLevelRelationCandidates(
    framedElement(7, 120, 70, 8),
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
    framedElement(7, 120, 66, 8),
    2027,
  );
  const second = scanAssociatedLevelRelationCandidates(
    framedElement(7, 120, 70, 9),
    2027,
  );
  const markers = new Map([
    [8, REVIT_2027_LEVEL_MARKER],
    [9, REVIT_2027_LEVEL_MARKER],
  ]);
  assert.equal(resolveAssociatedLevelRelations([...first, ...first], markers).length, 1);
  assert.deepEqual(resolveAssociatedLevelRelations([...first, ...second], markers), []);
});
