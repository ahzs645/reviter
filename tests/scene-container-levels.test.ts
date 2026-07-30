import assert from "node:assert/strict";
import test from "node:test";

import { displayRole, levelsForBounds, levelsFromRelations } from "../lib/reviter/scene.ts";
import type { ElementBoundsRecord } from "../lib/reviter/types.ts";

function record(overrides: Partial<ElementBoundsRecord> = {}): ElementBoundsRecord {
  return {
    elementId: 1,
    recordOffset: 0,
    boundsOffset: 0,
    recordCode: 30,
    recordCount: 9,
    duplicated: true,
    boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } },
    ...overrides,
  } as ElementBoundsRecord;
}

test("the wrapper fingerprint still stands alone when nothing decoded a category", () => {
  // The record-code shape is measured on one building, but where no category
  // token decoded it is the only container evidence there is, so it is kept.
  assert.equal(displayRole(record({ categoryId: undefined })), "wrapper");
});

test("a category that can host confirms the wrapper fingerprint", () => {
  // A curtain wall is category Walls in Revit, and 1,809 of the supplied
  // model's 1,840 fingerprint matches are exactly that.
  assert.equal(displayRole(record({ categoryId: -2000011 })), "wrapper");
});

test("a curtain panel or mullion is never a container, whatever its record code", () => {
  // The defect this rule had: the fingerprint ran ahead of the decoded category
  // and won, so a byte pattern from one building hid 31 elements the file had
  // named — the very facade children a wrapper exists to reveal.
  assert.equal(displayRole(record({ categoryId: -2000171 })), "frame"); // mullion
  assert.equal(displayRole(record({ categoryId: -2000170 })), "glazing"); // panel
  assert.notEqual(displayRole(record({ categoryId: -2000321 })), "wrapper"); // curtain grid
});

test("storeys come from the file's own level relations, not from a z histogram", () => {
  const records = [
    record({ elementId: 10, boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } } }),
    record({ elementId: 11, boundsFeet: { min: { x: 0, y: 0, z: 0.2 }, max: { x: 1, y: 1, z: 1 } } }),
    record({ elementId: 12, boundsFeet: { min: { x: 0, y: 0, z: 12 }, max: { x: 1, y: 1, z: 13 } } }),
  ];
  const relations = [
    ...Array.from({ length: 20 }, (_, index) => ({ elementId: index < 10 ? 10 : 11, levelId: 500 })),
    ...Array.from({ length: 20 }, () => ({ elementId: 12, levelId: 501 })),
  ];
  const levels = levelsFromRelations(records, relations);
  assert.deepEqual(levels.map((level) => level.levelId), [500, 501]);
  assert.equal(levels[0]!.source, "assoc-level-id");
  assert.equal(levels[1]!.elevation, 12);
});

test("a level too small to be a storey is dropped, and levels sort by elevation", () => {
  // Revit keeps levels nothing refers to — a datum, a leftover from a deleted
  // storey. Six of the supplied model's 18 hold fewer than 20 elements.
  const records = [
    record({ elementId: 1, boundsFeet: { min: { x: 0, y: 0, z: 40 }, max: { x: 1, y: 1, z: 41 } } }),
    record({ elementId: 2, boundsFeet: { min: { x: 0, y: 0, z: 4 }, max: { x: 1, y: 1, z: 5 } } }),
    record({ elementId: 3, boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } } }),
  ];
  const relations = [
    ...Array.from({ length: 25 }, () => ({ elementId: 1, levelId: 900 })),
    ...Array.from({ length: 25 }, () => ({ elementId: 2, levelId: 901 })),
    { elementId: 3, levelId: 902 },
  ];
  const levels = levelsFromRelations(records, relations);
  assert.deepEqual(levels.map((level) => level.levelId), [901, 900]);
});

test("a level's elevation is the median member, so one stray envelope cannot move it", () => {
  const records = [
    record({ elementId: 1, boundsFeet: { min: { x: 0, y: 0, z: 10 }, max: { x: 1, y: 1, z: 11 } } }),
    // The kind of misparse `framingBoundsOfRecords` exists for.
    record({ elementId: 2, boundsFeet: { min: { x: 0, y: 0, z: -9000 }, max: { x: 1, y: 1, z: 1 } } }),
  ];
  const relations = [
    ...Array.from({ length: 30 }, () => ({ elementId: 1, levelId: 700 })),
    { elementId: 2, levelId: 700 },
  ];
  assert.equal(levelsFromRelations(records, relations)[0]!.elevation, 10);
});

test("inferred elevation bands are no longer capped at eight", () => {
  // The old cap was sized to one building and returned exactly 8 on it, so a
  // taller model lost storeys silently. A fallback band count is the model's
  // to state, not this module's.
  const records = Array.from({ length: 12 }, (_, index) =>
    record({
      elementId: index,
      boundsFeet: { min: { x: 0, y: 0, z: index * 10 }, max: { x: 1, y: 1, z: index * 10 + 1 } },
    }),
  );
  const bands = levelsForBounds(records);
  assert.equal(bands.length, 12);
  assert.equal(bands[0]!.source, "elevation-band");
  assert.deepEqual([...bands].sort((a, b) => a.elevation - b.elevation), bands);
});
