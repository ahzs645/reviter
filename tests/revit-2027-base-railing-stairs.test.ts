import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027BaseRailingStairsRelation,
  REVIT_2027_BASE_RAILING_MARKER,
} from "../lib/reviter/revit-2027-base-railing-stairs.ts";

const OBJECT_LENGTH = 321;
const STAIRS_ID_OFFSET = OBJECT_LENGTH - 58;

function writeId(view: DataView, offset: number, id: number | null): void {
  if (id == null) {
    view.setUint32(offset, 0xffff_ffff, true);
    view.setUint32(offset + 4, 0xffff_ffff, true);
    return;
  }
  view.setUint32(offset, id, true);
  view.setUint32(offset + 4, 0, true);
}

function fixture(stairsId: number | null = 100): Uint8Array {
  const data = new Uint8Array(OBJECT_LENGTH + 20);
  const view = new DataView(data.buffer);
  view.setUint32(0, 200, true);
  view.setUint32(12, OBJECT_LENGTH, true);
  view.setUint16(16, REVIT_2027_BASE_RAILING_MARKER, true);
  view.setUint32(18, 0xffff_ffff, true);
  view.setUint32(OBJECT_LENGTH + 16, OBJECT_LENGTH, true);

  writeId(view, STAIRS_ID_OFFSET, stairsId);
  view.setFloat64(STAIRS_ID_OFFSET + 8, 1.25, true);
  writeId(view, STAIRS_ID_OFFSET + 16, 101);
  writeId(view, STAIRS_ID_OFFSET + 24, null);
  writeId(view, STAIRS_ID_OFFSET + 32, 102);
  view.setInt32(STAIRS_ID_OFFSET + 40, -1, true);
  view.setInt32(STAIRS_ID_OFFSET + 44, 0, true);
  view.setInt32(STAIRS_ID_OFFSET + 52, 9, true);
  data[STAIRS_ID_OFFSET + 56] = 1;
  data[STAIRS_ID_OFFSET + 57] = 0;
  return data;
}

test("decodes the boundary-anchored BaseRailing stairs relation", () => {
  const decoded = decodeRevit2027BaseRailingStairsRelation(
    fixture(),
    0,
    OBJECT_LENGTH,
    2027,
    { knownStairsElementIds: new Set([100]) },
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.railingId, 200);
  assert.equal(decoded.value.stairsId, 100);
  assert.equal(decoded.value.placementOffset, 1.25);
  assert.equal(decoded.value.sketchId, 101);
  assert.equal(decoded.value.stairsComponentId, null);
  assert.equal(decoded.value.stairsRailingAttributeId, 102);
  assert.equal(decoded.value.registeredLocation, -1);
  assert.equal(decoded.value.version, 9);
  assert.equal(decoded.value.flipped, true);
  assert.equal(decoded.value.stairsIdOffset, STAIRS_ID_OFFSET);
  assert.deepEqual(decoded.value.relation, {
    childId: 200,
    parentId: 100,
    source: "BaseRailing.m_stairsId",
    evidence: "persisted-revit-2027-base-railing-suffix",
  });
});

test("preserves a null stairs id without publishing a relation", () => {
  const decoded = decodeRevit2027BaseRailingStairsRelation(
    fixture(null),
    0,
    OBJECT_LENGTH,
    2027,
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.stairsId, null);
  assert.equal(decoded.value.relation, null);
});

test("fails closed on release, frame, target, and suffix violations", () => {
  assert.equal(
    decodeRevit2027BaseRailingStairsRelation(
      fixture(),
      0,
      OBJECT_LENGTH,
      2026,
    ).ok,
    false,
  );

  const brokenEcho = fixture();
  new DataView(brokenEcho.buffer).setUint32(OBJECT_LENGTH + 16, 0, true);
  assert.equal(
    decodeRevit2027BaseRailingStairsRelation(
      brokenEcho,
      0,
      OBJECT_LENGTH,
      2027,
    ).ok,
    false,
  );

  assert.equal(
    decodeRevit2027BaseRailingStairsRelation(
      fixture(),
      0,
      OBJECT_LENGTH,
      2027,
      { knownStairsElementIds: new Set([999]) },
    ).ok,
    false,
  );

  const invalidBoolean = fixture();
  invalidBoolean[STAIRS_ID_OFFSET + 56] = 2;
  assert.equal(
    decodeRevit2027BaseRailingStairsRelation(
      invalidBoolean,
      0,
      OBJECT_LENGTH,
      2027,
    ).ok,
    false,
  );
});
