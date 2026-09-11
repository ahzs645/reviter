import assert from "node:assert/strict";
import test from "node:test";

import { auditLevels, planSegments } from "../lib/reviter/rectify-audit.ts";
import type { ConvertResult, ElementBoundsRecord } from "../lib/reviter/types.ts";

const WALL = -2_000_011;

function wall(elementId: number, ax: number, ay: number, bx: number, by: number) {
  return {
    elementId, stream: "Partitions/1", chunkIndex: 0, rawOffset: 1, recordOffset: 1,
    categoryId: WALL, categoryName: "Walls",
    solid: {
      elementId, start: { x: ax, y: ay }, end: { x: bx, y: by },
      baseElevation: 0, topElevation: 9, thickness: 0.5,
    },
    boundsFeet: {
      min: { x: Math.min(ax, bx), y: Math.min(ay, by), z: 0 },
      max: { x: Math.max(ax, bx), y: Math.max(ay, by), z: 9 },
    },
  } as unknown as ElementBoundsRecord;
}

function model(records: ElementBoundsRecord[]): ConvertResult {
  return { elementBounds: records, levels: [], meshes: [] } as unknown as ConvertResult;
}

const drawn = new Map([[311, { elevation: 0, elementIds: [1, 2, 3] }]]);

test("a wall left behind by the neighbour it was joined to is reported", () => {
  // Two walls meeting at (10, 0). One is inside the wing and swings away; the
  // other is not, and the corner they shared no longer exists.
  const before = model([wall(1, 0, 0, 10, 0), wall(2, 10, 0, 10, 20)]);
  const after = model([wall(1, 0, 0, 10, 0), wall(2, 10, 40, 10, 60)]);
  const audit = auditLevels({
    before, after, movedIds: new Set([2]), drawnByLevel: drawn,
  });
  assert.equal(audit.length, 1);
  assert.equal(audit[0]!.moved, 1);
  assert.deepEqual(audit[0]!.brokenJoins.map((f) => f.elementId), [1],
    "the wall that stayed is the finding, not the one that moved");
  assert.equal(audit[0]!.brokenJoins[0]!.count, 1);
});

test("a wall the move drove straight through is reported as a clash", () => {
  // The stationary wall runs east-west at y = 5; the moved wall lands across
  // it. Nothing was joined, so this is the other question entirely.
  const before = model([wall(1, 0, 5, 40, 5), wall(2, 100, -10, 100, 10)]);
  const after = model([wall(1, 0, 5, 40, 5), wall(2, 20, -10, 20, 20)]);
  const audit = auditLevels({
    before, after, movedIds: new Set([2]), drawnByLevel: drawn,
  });
  assert.deepEqual(audit[0]!.clashes.map((f) => f.elementId), [1]);
  assert.equal(audit[0]!.brokenJoins.length, 0,
    "they were 60 ft apart before, so no join was broken");
});

test("touching end to end is a join, not a clash", () => {
  const before = model([wall(1, 0, 0, 10, 0), wall(2, 10, 0, 20, 0)]);
  const after = model([wall(1, 0, 0, 10, 0), wall(2, 10, 0, 20, 0)]);
  const audit = auditLevels({
    before, after, movedIds: new Set([2]), drawnByLevel: drawn,
  });
  assert.equal(audit[0]!.clashes.length, 0);
  assert.equal(audit[0]!.brokenJoins.length, 1,
    "it did not move, and it was joined to one that did");
});

test("a wall is measured on its location line, a column on its footprint", () => {
  assert.deepEqual(planSegments(wall(1, 0, 0, 10, 0)),
    [{ a: [0, 0], b: [10, 0] }]);
  const column = {
    elementId: 9, stream: "s", chunkIndex: 0, rawOffset: 1, recordOffset: 1,
    categoryId: -2_000_100,
    boundsFeet: { min: { x: 1, y: 1, z: 0 }, max: { x: 3, y: 3, z: 9 } },
  } as unknown as ElementBoundsRecord;
  assert.deepEqual(planSegments(column), [{ a: [1, 1], b: [3, 3] }]);
});

test("levels come back in elevation order", () => {
  const before = model([wall(1, 0, 0, 10, 0)]);
  const audit = auditLevels({
    before, after: before, movedIds: new Set(),
    drawnByLevel: new Map([
      [2, { elevation: 30, elementIds: [1] }],
      [1, { elevation: 0, elementIds: [1] }],
    ]),
  });
  assert.deepEqual(audit.map((level) => level.levelId), [1, 2]);
});
