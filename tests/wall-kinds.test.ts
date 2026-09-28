import assert from "node:assert/strict";
import test from "node:test";

import { resolveWallKinds, REVIT_2027_WALL_TYPE_KINDS } from "../lib/reviter/wall-kinds.ts";
import { selectDisplayBounds } from "../lib/reviter/scene.ts";
import type { ElementBoundsRecord } from "../lib/reviter/types.ts";

test("a wall's kind is the kind of the one wall type it references", () => {
  const typeKinds = new Map([
    [428955, REVIT_2027_WALL_TYPE_KINDS.get(624)!], // BasicWallType
    [500001, REVIT_2027_WALL_TYPE_KINDS.get(1060)!], // CurtainWallType
  ]);
  const kinds = resolveWallKinds(new Map([
    // The walls it joins and its level are referenced too.
    [428588, [198694, 530178, 428955, 311]],
    [428600, [500001, 311]],
    [428700, [311]],
    [428800, [428955, 500001]],
  ]), typeKinds);
  assert.deepEqual([...kinds], [[428588, "basic"], [428600, "curtain"]]);
});

function wallRecord(elementId: number, wallKind?: "basic" | "curtain"): ElementBoundsRecord {
  return {
    elementId,
    stream: "Partitions/14",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    recordCode: 30,
    recordCount: 8,
    categoryId: -2_000_011,
    boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 20, y: 0.66, z: 10 } },
    ...(wallKind ? { wallKind } : {}),
  } as ElementBoundsRecord;
}

function panel(elementId: number, x: number): ElementBoundsRecord {
  return {
    ...wallRecord(elementId),
    recordCode: 114,
    recordCount: 1,
    categoryId: -2_000_170,
    boundsFeet: { min: { x, y: 0.2, z: 1 }, max: { x: x + 2, y: 0.4, z: 8 } },
  } as ElementBoundsRecord;
}

test("a basic wall is never held back as a curtain wall's container", () => {
  const records = [wallRecord(1, "basic"), wallRecord(2), panel(3, 4), panel(4, 10)];
  const selection = selectDisplayBounds(records);
  assert.deepEqual(selection.openingWrappers.map((record) => record.elementId), [2]);
  assert.ok(selection.records.some((record) => record.elementId === 1));
});
