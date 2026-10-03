import test from "node:test";
import assert from "node:assert/strict";
import { recoverReviewedNativeCirculation } from "../lib/reviter/reviewed-native-circulation.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
const rect = (
  a: number,
  b: number,
  c: number,
  d: number,
): [number, number][] => [
  [a, b],
  [c, b],
  [c, d],
  [a, d],
];
const fixture = () => ({
  model: {
    elementBounds: [
      {
        elementId: 100,
        categoryId: -2000032,
        boundsFeet: { min: { x: 0, y: 0, z: -1 }, max: { x: 20, y: 10, z: 0 } },
        loops: [
          rect(0, 0, 20, 10).map((p) => [...p, 0]),
          rect(8, 4, 12, 6).map((p) => [...p, 0]),
        ],
      },
    ],
    levels: [{ levelId: 1, elevation: 0 }],
  } as unknown as ConvertResult,
  data: {
    source: { modelSha256: "a".repeat(64) },
    nativeLevels: [{ id: 1, name: "Ground", elevationFeet: 0 }],
    records: [],
    walls: [],
    doors: [],
    nodes: [],
    edges: [],
  } as unknown as IndoorDataset,
});
test("review seeds recover exact bounded native material without creating routes or filling holes", () => {
  const { model, data } = fixture();
  const before = JSON.stringify([model, data]);
  const get = (pointFeet: [number, number], maximumAreaFeet = 300) =>
    recoverReviewedNativeCirculation(model, data, {
      pinId: "review",
      levelId: 1,
      pointFeet,
      maximumAreaFeet,
    });
  const result = get([2, 5]);
  assert.ok(result.cell);
  assert.deepEqual(result.cell.nativeFloorIds, [100]);
  assert.deepEqual(result.cell.roomKeys, []);
  assert.equal(result.areaFeet, 192);
  assert.match(get([10, 5]).reason!, /no flat native/);
  assert.match(get([2, 5], 50).reason!, /unbounded wing/);
  assert.equal(JSON.stringify([model, data]), before);
});
test("a user pin cannot promote a staff room or a native stair projection", () => {
  const { model, data } = fixture();
  data.records.push({
    key: "private",
    levelId: 1,
    elevationFeet: 0,
    circulation: false,
    walkable: true,
    stair: false,
    access: "staff",
    ringsFeet: [rect(0, 0, 5, 10)],
    properties: {},
  } as never);
  assert.match(
    recoverReviewedNativeCirculation(model, data, {
      pinId: "review",
      levelId: 1,
      pointFeet: [2, 5],
      maximumAreaFeet: 300,
    }).reason!,
    /blocked/,
  );
  model.elementBounds.push({
    elementId: 101,
    stairTreads: [rect(14, 2, 18, 8).map((p) => [...p, 2])],
  } as never);
  assert.match(
    recoverReviewedNativeCirculation(model, data, {
      pinId: "review",
      levelId: 1,
      pointFeet: [16, 5],
      maximumAreaFeet: 300,
    }).reason!,
    /blocked/,
  );
});
