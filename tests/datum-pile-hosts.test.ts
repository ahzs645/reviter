import assert from "node:assert/strict";
import test from "node:test";

import type { ElementHeader } from "../lib/reviter/element-headers.ts";
import { removeDatumPileRecords } from "../lib/reviter/convert-synthesised-records.ts";
import type { ElementBoundsRecord } from "../lib/reviter/types.ts";

function record(elementId: number, min: [number, number, number], max: [number, number, number]): ElementBoundsRecord {
  return {
    elementId,
    stream: "Partitions/14",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    boundsFeet: { min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] } },
  };
}

const header = (elementId: number, categoryId: number | null, familyId: number | null = null): ElementHeader =>
  ({ elementId, categoryId, familyId, ownerViewId: null, designOptionId: null });

test("a project's own walls and ceilings survive the datum pile", () => {
  // A building spread over 200 ft, as the pile rule requires...
  const building = Array.from({ length: 600 }, (_, index) =>
    record(10_000 + index, [index / 3, 20, 0], [index / 3 + 1, 21, 10]));
  // ...a family-local pile on the origin...
  const pile = Array.from({ length: 30 }, (_, index) =>
    record(50_000 + index, [-0.5, -0.5, 0], [0.5, 0.5, 3]));
  // ...and, as in the 2025 RAC sample, a wall and a ceiling that are centred on
  // the origin because the building stands on its own datum.
  const wall = record(497_540, [-3.8, -0.2, 9], [3.8, 0.2, 28.2]);
  const ceiling = record(697_612, [-21.8, -10.3, -1.6], [21.8, 10.3, -1.4]);
  // A wall inside a loaded family's own definition is still part of the pile.
  const familyWall = record(295_447, [-2, -0.2, 0], [2, 0.2, 10]);
  const records = [...building, ...pile, wall, ceiling, familyWall];
  const headers = new Map<number, ElementHeader>([
    [497_540, header(497_540, -2_000_011)],
    [697_612, header(697_612, -2_000_038)],
    [295_447, header(295_447, -2_000_011, 295_427)],
    ...pile.map((entry) => [entry.elementId, header(entry.elementId, -2_000_127)] as [number, ElementHeader]),
  ]);
  assert.equal(removeDatumPileRecords(records, headers), 31);
  const kept = new Set(records.map((entry) => entry.elementId));
  assert.ok(kept.has(497_540) && kept.has(697_612));
  assert.ok(!kept.has(295_447) && !kept.has(50_000));
});
